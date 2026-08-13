/**
 * Debounce + latest-wins helper for keystroke-driven work (issue #49).
 *
 * While the user types, completions must be delayed (debounce) and any
 * in-flight request cancelled so a stale ghost text never renders.
 */

export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private pendingRun: ((signal: AbortSignal) => void | Promise<void>) | undefined;
  private _delayMs: number;

  constructor(delayMs: number) {
    this._delayMs = delayMs;
  }

  /**
   * Current debounce window. Assigning a new value applies immediately:
   * a pending (not yet fired) run is rescheduled with the new delay, so a
   * config change is honored on the very next keystroke.
   */
  get delayMs(): number {
    return this._delayMs;
  }

  set delayMs(value: number) {
    if (value === this._delayMs) {
      return;
    }
    this._delayMs = value;
    if (this.timer !== undefined && this.pendingRun && this.controller) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.schedule(this.pendingRun, this.controller);
    }
  }

  /**
   * Schedule `run` after the debounce window. A previous scheduled run is
   * cancelled, and the AbortSignal handed to `run` aborts the PREVIOUS
   * invocation (if it already started) plus this one when superseded.
   *
   * @returns a signal that is aborted if a newer call supersedes this one.
   */
  debounce(run: (signal: AbortSignal) => void | Promise<void>): AbortSignal {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    this.pendingRun = run;
    this.schedule(run, controller);
    return controller.signal;
  }

  private schedule(run: (signal: AbortSignal) => void | Promise<void>, controller: AbortController): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pendingRun = undefined;
      if (!controller.signal.aborted) {
        void run(controller.signal);
      }
    }, this._delayMs);
  }

  /** Cancel any scheduled run and abort the active one. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pendingRun = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }

  dispose(): void {
    this.cancel();
  }
}
