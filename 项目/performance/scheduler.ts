/**
 * 前端性能调度工具
 *
 * 设计原则：
 *   - 优先用原生 API，只补原生 API 做不到的能力（任务组取消、分片迭代）
 *   - 不重复造 min-heap，不重复造 React Scheduler
 *   - 适用于 React 项目（补充 startTransition）和 Vanilla JS 项目
 */

// ─── 类型 ──────────────────────────────────────────────────────────────────

export type Priority = 'user-blocking' | 'user-visible' | 'background';

export interface TaskHandle {
  cancel: () => void;
}

export interface ScheduleOptions {
  /** 延迟 ms 后才进入调度队列 */
  delay?: number;
  signal?: AbortSignal;
}

export interface ChunkOptions {
  priority?: Priority;
  /** 每批处理多少条，处理完一批后让出主线程，默认 50 */
  chunkSize?: number;
  signal?: AbortSignal;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────

/**
 * 让出主线程，给浏览器处理输入和渲染的机会
 * 优先用 scheduler.yield()，降级到 MessageChannel（比 setTimeout 快，无 4ms 限制）
 */
function yieldToMain(): Promise<void> {
  if (typeof scheduler !== 'undefined' && 'yield' in scheduler) {
    return (scheduler as any).yield();
  }
  return new Promise<void>(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

/**
 * 调度单个函数，优先用 scheduler.postTask，降级到 setTimeout
 *
 * 降级优先级映射：
 *   user-blocking → delay 0   （最快，下一个 task）
 *   user-visible  → delay 0   （同上，优先级靠 postTask 区分）
 *   background    → delay 200 （人为延后，避免阻塞可见渲染）
 */
function scheduleNative(
  priority: Priority,
  fn: () => void,
  opts: ScheduleOptions = {}
): TaskHandle {
  if (typeof scheduler !== 'undefined' && 'postTask' in scheduler) {
    const controller = new AbortController();
    const merged = opts.signal
      ? AbortSignal.any([controller.signal, opts.signal])
      : controller.signal;

    (scheduler as any)
      .postTask(fn, { priority, signal: merged, delay: opts.delay ?? 0 })
      .catch(() => {}); // AbortError 是预期行为，不需要处理

    return { cancel: () => controller.abort() };
  }

  // 降级
  const fallbackDelay =
    (opts.delay ?? 0) + (priority === 'background' ? 200 : 0);
  const id = setTimeout(fn, fallbackDelay);
  return { cancel: () => clearTimeout(id) };
}

// ─── 公共 API ─────────────────────────────────────────────────────────────

/**
 * 调度单个任务
 *
 * 适合：单次异步任务，需要指定优先级
 *
 * @example
 * // 非紧急的 UI 更新
 * const task = schedule('user-visible', () => renderSidebar());
 * // 用户切换路由时取消
 * task.cancel();
 *
 * @example
 * // 页面隐藏后延迟上报统计
 * schedule('background', () => sendAnalytics(data), { delay: 2000 });
 */
export function schedule(
  priority: Priority,
  fn: () => void,
  options?: ScheduleOptions
): TaskHandle {
  return scheduleNative(priority, fn, options);
}

/**
 * 分片处理大数组，每批后自动让出主线程
 *
 * 适合：大列表渲染、批量 DOM 操作、大量数据转换
 *
 * @example
 * // 渲染 10000 条消息，不阻塞用户交互
 * await chunk(messages, (msg) => {
 *   list.appendChild(renderMessage(msg));
 * }, { chunkSize: 50 });
 *
 * @example
 * // 可取消的分片（用户翻页时中止）
 * const ctrl = new AbortController();
 * chunk(items, render, { signal: ctrl.signal });
 * onPageChange(() => ctrl.abort());
 */
export async function chunk<T>(
  items: T[],
  process: (item: T, index: number) => void,
  options: ChunkOptions = {}
): Promise<void> {
  const { chunkSize = 50, signal } = options;

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) return;

    process(items[i], i);

    if ((i + 1) % chunkSize === 0) {
      await yieldToMain();
    }
  }
}

/**
 * 空闲时执行低优先级任务
 *
 * 适合：预加载、埋点上报、缓存预热等不影响主流程的工作
 *
 * @example
 * idle(() => prefetchNextPage());
 * idle(() => warmupCache(userId));
 */
export function idle(fn: () => void): TaskHandle {
  if (typeof requestIdleCallback !== 'undefined') {
    const id = requestIdleCallback(fn);
    return { cancel: () => cancelIdleCallback(id) };
  }
  return scheduleNative('background', fn);
}

/**
 * 可批量取消的任务组
 *
 * 原生 API 痛点：AbortController 只能取消单个任务，无法批量取消一组相关任务。
 * TaskGroup 解决"上一批全取消，开始新一批"的场景。
 *
 * 适合：搜索结果渲染、LLM 输出处理、翻页重绘、路由切换清理
 *
 * @example
 * // 搜索框：每次输入取消上一轮的所有渲染任务
 * const group = new TaskGroup();
 *
 * searchInput.oninput = (e) => {
 *   group.reset(); // 取消上一轮，重置状态
 *   group.schedule('user-visible', () => renderResults(search(e.target.value)));
 *   group.schedule('background', () => updateSearchStats(e.target.value));
 * };
 *
 * @example
 * // LLM 流式输出：停止生成时取消所有待处理的高亮/公式任务
 * const renderGroup = new TaskGroup();
 *
 * onToken((token) => {
 *   renderGroup.schedule('user-visible', () => appendToken(token));
 * });
 * onCodeBlock((code) => {
 *   renderGroup.schedule('background', () => syntaxHighlight(code));
 * });
 *
 * stopBtn.onclick = () => renderGroup.cancel();
 */
export class TaskGroup {
  private handles: TaskHandle[] = [];
  private _cancelled = false;

  get cancelled(): boolean {
    return this._cancelled;
  }

  schedule(
    priority: Priority,
    fn: () => void,
    options?: ScheduleOptions
  ): TaskHandle {
    if (this._cancelled) return { cancel: () => {} };
    const handle = scheduleNative(priority, fn, options);
    this.handles.push(handle);
    return handle;
  }

  async chunk<T>(
    items: T[],
    process: (item: T, index: number) => void,
    options: Omit<ChunkOptions, 'signal'> = {}
  ): Promise<void> {
    if (this._cancelled) return;
    const ctrl = new AbortController();
    this.handles.push({ cancel: () => ctrl.abort() });
    return chunk(items, process, { ...options, signal: ctrl.signal });
  }

  /** 取消组内所有任务，之后该组不再接受新任务 */
  cancel(): void {
    this._cancelled = true;
    this.handles.forEach(h => h.cancel());
    this.handles = [];
  }

  /** 取消所有任务并重置，之后可以继续接受新任务 */
  reset(): void {
    this.cancel();
    this._cancelled = false;
  }
}
