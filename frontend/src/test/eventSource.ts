import type { Change } from '../live/changes'

/** A stand-in for the server's change stream: tests open it and send changes. */
export class FakeEventSource {
  static last: FakeEventSource | undefined
  url: string
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.last = this
  }

  open() {
    this.onopen?.()
  }

  send(change: Partial<Change>) {
    const data = JSON.stringify({ items: [], boards: {}, tab: '', by: '', ...change })
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  close() {
    this.closed = true
  }
}
