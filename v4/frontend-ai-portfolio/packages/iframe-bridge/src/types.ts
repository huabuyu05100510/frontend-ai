// ============================================================
// JSON-RPC 2.0 Protocol Types for IframeBridge
// ============================================================

/** Unique request identifier (UUID v4) */
export type RpcId = string;

/** JSON-RPC 2.0 version constant */
export type JsonRpcVersion = '2.0';

/** JSON-RPC 2.0 Request — expects a response */
export interface JsonRpcRequest<T = unknown> {
  jsonrpc: JsonRpcVersion;
  id: RpcId;
  method: string;
  params?: T;
}

/** JSON-RPC 2.0 Success Response */
export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: JsonRpcVersion;
  id: RpcId;
  result: T;
}

/** JSON-RPC 2.0 Error Response */
export interface JsonRpcErrorResponse {
  jsonrpc: JsonRpcVersion;
  id: RpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** JSON-RPC 2.0 Notification — no id, no response expected */
export interface JsonRpcNotification<T = unknown> {
  jsonrpc: JsonRpcVersion;
  method: string;
  params?: T;
  // deliberately no `id` field
}

/** Union type for all JSON-RPC message variants */
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification;

/** Type guard: is this message a Request? */
export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg && !('result' in msg) && !('error' in msg);
}

/** Type guard: is this message a Success Response? */
export function isSuccessResponse(msg: JsonRpcMessage): msg is JsonRpcSuccessResponse {
  return 'id' in msg && 'result' in msg;
}

/** Type guard: is this message an Error Response? */
export function isErrorResponse(msg: JsonRpcMessage): msg is JsonRpcErrorResponse {
  return 'id' in msg && 'error' in msg;
}

/** Type guard: is this message a Notification? */
export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return !('id' in msg) && 'method' in msg;
}

/** Handler function signature for registered methods */
export type BridgeHandler = (params?: unknown) => unknown | Promise<unknown>;

/** Pending request entry stored in the request map */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Result of a successful handshake */
export interface HandshakeResult {
  version: string;
  capabilities: string[];
}