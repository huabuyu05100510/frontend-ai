/**
 * StreamBuffer —— 模拟 A2UI `streamAppend` 协议的累积缓冲。
 * 渲染层通过 useSyncExternalStore 订阅，token 级增量到达即触发渲染。
 */
type Listener = () => void;

class StreamBuffer {
  private text = '';
  private listeners = new Set<Listener>();
  private version = 0;

  /** 对应协议消息：{ kind:'streamAppend', delta } */
  append(delta: string) {
    this.text += delta;
    this.version++;
    this.emit();
  }

  reset() {
    this.text = '';
    this.version++;
    this.emit();
  }

  get(): string {
    return this.text;
  }

  /** useSyncExternalStore 需要稳定快照；用 version 做廉价标识 */
  getVersion = (): number => this.version;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private emit() {
    this.listeners.forEach((l) => l());
  }
}

export const streamBuffer = new StreamBuffer();
