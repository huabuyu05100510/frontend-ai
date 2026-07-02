/**
 * SlidingWindow — fixed-capacity ring buffer with O(1) push.
 * Used for latency sampling and frame timing.
 */
export class SlidingWindow<T> {
  private readonly buf: T[];
  private head = 0;
  private len = 0;
  private totalPushed = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array<T>(capacity);
  }

  push(value: T): void {
    if (this.len < this.capacity) {
      this.buf[(this.head + this.len) % this.capacity] = value;
      this.len++;
    } else {
      this.buf[this.head] = value;
      this.head = (this.head + 1) % this.capacity;
    }
    this.totalPushed++;
  }

  /** Snapshot as array (oldest → newest). O(n). */
  values(): T[] {
    const out = new Array<T>(this.len);
    for (let i = 0; i < this.len; i++) {
      out[i] = this.buf[(this.head + i) % this.capacity];
    }
    return out;
  }

  get size(): number {
    return this.len;
  }

  get total(): number {
    return this.totalPushed;
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }
}
