import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcNotification,
  PendingRequest,
  BridgeHandler,
  HandshakeResult,
  isNotification,
  isRequest,
  isErrorResponse,
  isSuccessResponse,
} from './types';
import {
  BridgeErrorCode,
  DEFAULT_TIMEOUT_MS,
  InternalMethods,
} from './constants';
import {
  BridgeTimeoutError,
  BridgeDestroyedError,
  BridgeVersionMismatchError,
} from './errors';

// ============================================================
// IframeBridge — JSON-RPC 2.0 bidirectional communication bus
// ============================================================

export class IframeBridge {
  private targetWindow: Window;
  private targetOrigin: string;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private handlers: Map<string, BridgeHandler> = new Map();
  private destroyed = false;
  private boundHandleMessage: (event: MessageEvent) => void;

  /**
   * Create a new Bridge instance connected to a target iframe window.
   *
   * @param targetWindow - The iframe's contentWindow (or parent window for Guest)
   * @param targetOrigin - MUST be explicitly specified. Use '*' ONLY for localhost dev.
   */
  constructor(targetWindow: Window, targetOrigin: string) {
    this.targetWindow = targetWindow;
    this.targetOrigin = targetOrigin;

    // Bind the message handler so we can add/remove it cleanly
    this.boundHandleMessage = this.handleMessage.bind(this);
    window.addEventListener('message', this.boundHandleMessage);
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Send a JSON-RPC 2.0 Request and return a Promise that resolves with the response.
   * Rejects with BridgeTimeoutError if no response is received within timeoutMs.
   *
   * @param method  - The RPC method name (e.g., 'auth.getToken')
   * @param params  - Optional parameters payload
   * @param timeoutMs - Timeout in milliseconds (default: 30_000)
   */
  public request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new BridgeDestroyedError());
    }

    const id = this.generateId();

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.clearRequest(id);
          reject(new BridgeTimeoutError(method, timeoutMs));
        }, timeoutMs);
      }

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject: reject as (reason?: unknown) => void, timer });
      this.postMessage(request);
    });
  }

  /**
   * Send a JSON-RPC 2.0 Notification (no response expected).
   */
  public notify(method: string, params?: unknown): void {
    if (this.destroyed) return;

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.postMessage(notification);
  }

  /**
   * Register a handler for incoming RPC calls on the given method.
   */
  public on(method: string, handler: BridgeHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * Remove a previously registered handler.
   */
  public off(method: string): void {
    this.handlers.delete(method);
  }

  /**
   * Perform a version negotiation handshake with the remote Bridge.
   * Returns the remote version and capabilities on success.
   */
  public async handshake(
    version: string = '2.0',
    timeoutMs: number = 5000,
  ): Promise<HandshakeResult> {
    const result = await this.request<HandshakeResult>(
      InternalMethods.BRIDGE_HANDSHAKE,
      { version },
      timeoutMs,
    );

    if (result.version !== version) {
      throw new BridgeVersionMismatchError(version, result.version);
    }

    return result;
  }

  /**
   * Destroy the Bridge: remove listeners, clear handlers,
   * reject all pending promises, and prevent further use.
   */
  public destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;

    // Remove the message listener
    window.removeEventListener('message', this.boundHandleMessage);

    // Clear all pending request timers and reject them
    for (const [id, pending] of this.pendingRequests) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new BridgeDestroyedError());
    }
    this.pendingRequests.clear();

    // Clear all handlers
    this.handlers.clear();
  }

  // ============================================================
  // Private Internals
  // ============================================================

  /**
   * Generate a UUID v4 string for request correlation.
   */
  private generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Post a message to the target window with the configured origin.
   */
  private postMessage(message: JsonRpcMessage): void {
    this.targetWindow.postMessage(message, this.targetOrigin);
  }

  /**
   * Remove a pending request and clear its timeout timer.
   */
  private clearRequest(id: string): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Handle incoming MessageEvent from the window message channel.
   *
   * Routes messages into three paths:
   *   1. Response (has id + result/error) → resolve/reject pending promise
   *   2. Request (has id + method) → invoke registered handler, send response
   *   3. Notification (no id, has method) → invoke registered handler, no reply
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    // Ignore messages from this bridge's own window
    if (event.source === window) return;

    let msg: JsonRpcMessage;

    try {
      msg = JSON.parse(JSON.stringify(event.data));
    } catch {
      // If we can't parse the data, it's not a JSON-RPC message for us
      return;
    }

    // Validate: must have jsonrpc field
    if (!msg || (msg as JsonRpcMessage).jsonrpc !== '2.0') {
      return;
    }

    try {
      if (isSuccessResponse(msg)) {
        this.handleResponse(msg);
      } else if (isErrorResponse(msg)) {
        this.handleErrorResponse(msg);
      } else if (isRequest(msg)) {
        await this.handleRequest(msg);
      } else if (isNotification(msg)) {
        this.handleNotification(msg);
      }
      // Unknown message type → silently ignored
    } catch (_err) {
      // Catch-all: prevent any unhandled error from breaking the message loop
      // Individual handler errors are already caught and returned as -32603
    }
  }

  /**
   * Handle a successful response: resolve the pending Promise.
   */
  private handleResponse(msg: JsonRpcSuccessResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return; // Already timed out or unknown id

    this.clearRequest(msg.id);
    pending.resolve(msg.result);
  }

  /**
   * Handle an error response: reject the pending Promise.
   */
  private handleErrorResponse(msg: JsonRpcErrorResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    this.clearRequest(msg.id);
    const error = new Error(msg.error.message);
    (error as any).code = msg.error.code;
    (error as any).data = msg.error.data;
    pending.reject(error);
  }

  /**
   * Handle an incoming Request: invoke the registered handler and send a response.
   */
  private async handleRequest(msg: JsonRpcRequest): Promise<void> {
    const handler = this.handlers.get(msg.method);

    if (!handler) {
      this.sendErrorResponse(msg.id, BridgeErrorCode.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
      return;
    }

    try {
      const result = await handler(msg.params);
      this.sendSuccessResponse(msg.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      this.sendErrorResponse(msg.id, BridgeErrorCode.INTERNAL_ERROR, message);
    }
  }

  /**
   * Handle an incoming Notification: invoke the handler, no reply.
   */
  private handleNotification(msg: JsonRpcNotification): void {
    const handler = this.handlers.get(msg.method);
    if (handler) {
      // Fire and forget — errors are caught but not reported back
      Promise.resolve(handler(msg.params)).catch(() => {
        // Silently swallow: notification handlers are fire-and-forget
      });
    }
  }

  /**
   * Send a JSON-RPC success response.
   */
  private sendSuccessResponse(id: string, result: unknown): void {
    const response: JsonRpcSuccessResponse = {
      jsonrpc: '2.0',
      id,
      result: result ?? null,
    };
    this.postMessage(response);
  }

  /**
   * Send a JSON-RPC error response.
   */
  private sendErrorResponse(id: string, code: BridgeErrorCode, message: string): void {
    const response: JsonRpcErrorResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    this.postMessage(response);
  }
}