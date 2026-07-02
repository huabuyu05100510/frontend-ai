import { BridgeErrorCode } from './constants';

// ============================================================
// Bridge Custom Errors
// ============================================================

/** Base error class for all Bridge-related errors */
export class BridgeError extends Error {
  public readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

/** Thrown when a request exceeds its timeout duration */
export class BridgeTimeoutError extends BridgeError {
  public readonly method: string;

  constructor(method: string, timeoutMs: number) {
    super(
      BridgeErrorCode.TIMEOUT,
      `Request '${method}' timed out after ${timeoutMs}ms`,
    );
    this.name = 'BridgeTimeoutError';
    this.method = method;
  }
}

/** Thrown when handshake fails due to origin mismatch (message blocked by browser) */
export class BridgeOriginBlockedError extends BridgeError {
  constructor(targetOrigin: string) {
    super(
      BridgeErrorCode.TARGET_ORIGIN_BLOCKED,
      `Handshake failed: messages to '${targetOrigin}' may be blocked by the browser`,
    );
    this.name = 'BridgeOriginBlockedError';
  }
}

/** Thrown when a request is made after the Bridge has been destroyed */
export class BridgeDestroyedError extends BridgeError {
  constructor() {
    super(
      BridgeErrorCode.BRIDGE_DESTROYED,
      'Bridge has been destroyed and can no longer be used',
    );
    this.name = 'BridgeDestroyedError';
  }
}

/** Thrown when protocol version negotiation fails */
export class BridgeVersionMismatchError extends BridgeError {
  constructor(hostVersion: string, guestVersion: string) {
    super(
      BridgeErrorCode.VERSION_MISMATCH,
      `Version mismatch: host=${hostVersion}, guest=${guestVersion}`,
    );
    this.name = 'BridgeVersionMismatchError';
  }
}