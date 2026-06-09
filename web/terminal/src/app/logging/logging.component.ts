import {AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild} from '@angular/core';
import {Terminal} from "xterm";
import {FitAddon} from "xterm-addon-fit";
import {debounce} from "lodash";
import {LoggingService} from "./logging.service";
import {ActivatedRoute} from "@angular/router";

declare let SockJS: any;


@Component({
  selector: 'app-logging',
  templateUrl: './logging.component.html',
  styleUrls: ['./logging.component.css']
})
export class LoggingComponent implements AfterViewInit, OnDestroy {

  constructor(private readonly cdr_: ChangeDetectorRef,
              private loggingService: LoggingService, private activatedRoute_: ActivatedRoute) {
    this.clusterName = this.activatedRoute_.snapshot.queryParams["cluster"]
    this.namespace = this.activatedRoute_.snapshot.queryParams["namespace"]
    this.podName = this.activatedRoute_.snapshot.queryParams["pod"]
    this.container = this.activatedRoute_.snapshot.queryParams["container"]
    this.tailLines = this.activatedRoute_.snapshot.queryParams["tailLines"]
    this.follow = this.activatedRoute_.snapshot.queryParams["follow"]
    this.previous = this.activatedRoute_.snapshot.queryParams["previous"]
    this.timestamps = this.activatedRoute_.snapshot.queryParams["timestamps"]
  }

  @ViewChild('anchor', {static: true}) anchorRef: ElementRef;
  term: Terminal;
  namespace: string;
  podName: string;
  clusterName: string;
  container: string;
  tailLines: number;
  follow: boolean;
  previous: boolean;
  timestamps: boolean;

  private conn_: WebSocket


  private debouncedFit_: Function


  private onCopy_ = (event: ClipboardEvent): void => {
    if (!this.term || !this.term.hasSelection() || !event.clipboardData) {
      return;
    }

    event.clipboardData.setData('text/plain', this.term.getSelection());
    event.preventDefault();
  }

  private onContextMenu_ = (event: MouseEvent): void => {
    if (!this.term || !this.term.hasSelection()) {
      return;
    }

    event.preventDefault();
    this.copySelection_();
  }

  private copySelection_(): void {
    if (!this.term || !this.term.hasSelection()) {
      return;
    }

    const selection = this.term.getSelection();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(selection).catch(() => this.copyText_(selection));
      return;
    }

    this.copyText_(selection);
  }

  private copyText_(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }


  ngAfterViewInit(): void {
    if (this.clusterName && this.namespace && this.podName) {
      this.setupConnection()
      this.initTerm()
    } else {
      alert("please set param: namespace,pod  and container name ")
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('copy', this.onCopy_)
    if (this.anchorRef?.nativeElement) {
      this.anchorRef.nativeElement.removeEventListener('contextmenu', this.onContextMenu_)
    }
    if (this.conn_) {
      this.conn_.close()
    }
    if (this.term) {
      this.term.dispose()
    }
  }

  initTerm() {
    this.term = new Terminal({
      fontSize: 12,
      fontFamily: 'Consolas, "Courier New", monospace',
      bellStyle: 'sound',
      cursorBlink: true,
      disableStdin: true,
    })
    const fitAddon = new FitAddon();
    this.term.loadAddon(fitAddon);
    this.term.open(this.anchorRef.nativeElement)
    this.term.attachCustomKeyEventHandler(event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && this.term.hasSelection()) {
        event.preventDefault();
        this.copySelection_();
        return false;
      }
      return true;
    })
    document.addEventListener('copy', this.onCopy_)
    this.anchorRef.nativeElement.addEventListener('contextmenu', this.onContextMenu_)
    this.debouncedFit_ = debounce(() => {
      fitAddon.fit()
      this.cdr_.markForCheck();
    }, 100)
    this.debouncedFit_();
  }

  async setupConnection() {
    try {
      const {data} = await this.loggingService.createLoggingSession(this.clusterName, this.namespace, this.podName, this.container, this.tailLines, this.follow, this.previous,this.timestamps).toPromise()
      const id = data.id
      this.conn_ = new SockJS(`/kubepi/api/v1/ws/logging/sockjs?${id}`)
      this.conn_.onopen = () => {
        this.conn_.send(JSON.stringify({SessionID: id}))
        this.conn_.onmessage = (msg) => {
          this.term.write(msg.data)
        }
        this.conn_.onclose = () => {
          this.term.write("\n\n******** The connection failed. Unsupported, interrupted or timed out. ********")
        }
        this.term.focus();
        this.cdr_.markForCheck()
      }
    } catch (e:any) {
      this.term.write(e.error.message)
    }

  }

}
