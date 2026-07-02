// ============================================================
// Bridge Protocol Constants
// ============================================================

/** Current protocol version */
export const BRIDGE_PROTOCOL_VERSION = '2.0';

/** Default request timeout in milliseconds */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** ===== Standard JSON-RPC 2.0 Error Codes ===== */
export enum BridgeErrorCode {
  // JSON-RPC 2.0 standard errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // Custom extensions (reserved range: -32000 to -32099)
  TIMEOUT = -32000,
  TARGET_ORIGIN_BLOCKED = -32001,
  BRIDGE_DESTROYED = -32002,
  VERSION_MISMATCH = -32003,
}

/** ===== Host → Guest: methods exposed by Host for Guest to call ===== */
export enum HostMethods {
  AUTH_GET_TOKEN = 'auth.getToken',
  API_FETCH = 'api.fetch',
  UI_SHOW_MODAL = 'ui.showModal',
  UI_SHOW_TOAST = 'ui.showToast',
}

/** ===== Guest → Host: methods exposed by Guest for Host to call ===== */
export enum GuestMethods {
  APP_HEALTH = 'app.health',
  APP_READY = 'app.ready',
  LAYOUT_CONTENT_HEIGHT = 'layout.contentHeight',
  APP_GET_STATE = 'app.getState',
}

/** Internal protocol methods */
export enum InternalMethods {
  BRIDGE_HANDSHAKE = 'bridge.handshake',
}