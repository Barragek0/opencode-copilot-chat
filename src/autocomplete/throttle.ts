/**
 * Debounce + latest-wins helper for keystroke-driven work (issue #49).
 *
 * While the user types, completions must be delayed (debounce) and any
 * in-flight request cancelled so a stale ghost text never renders.
 */

export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;

  /** Current debounce window; may be updated at runtime (config-driven). */
  delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
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
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!controller.signal.aborted) {
        void run(controller.signal);
      }
    }, this.delayMs);
    return controller.signal;
  }

  /** Cancel any scheduled run and abort the active one. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.controller?.abort();
    this.controller = undefined;
  }

  dispose(): void {
    this.cancel();
  }
}
