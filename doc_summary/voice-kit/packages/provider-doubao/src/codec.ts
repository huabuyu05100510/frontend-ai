/**
 * Volcengine v3/sauc binary protocol codec.
 *
 * Pillar: hand-rolled binary frame parser for the undocumented Volcengine
 * bigmodel ASR protocol. Ported from the Python reference implementation
 * in voice-portfolio/server/volcengine_engine.py.
 *
 * Frame layout (client → server):
 *   byte0 = 0x11                          (protocol_version=1 << 4 | header_size=1*4)
 *   byte1 = (msg_type << 4) | flags       (msg_type: 0x1=full, 0x2=audio)
 *                                         (flags: 0x0=none, 0x1=has_seq, 0x2=last)
 *   byte2 = (serialization << 4) | compression
 *                                         (serialization: 0x1=JSON, 0x2=protobuf)
 *                                         (compression: 0x0=none, 0x1=gzip)
 *   byte3 = 0x00                          (reserved)
 *   size: 4B big-endian unsigned
 *   body: <size> bytes (gzip-compressed JSON when compression=1)
 *
 * Server response adds an optional 4-byte seq field (when flags & 0x01).
 */

const HEADER_BYTE_0 = 0x11;
const SERIAL_JSON = 0x01;
const COMPRESS_NONE = 0x00;
const COMPRESS_GZIP = 0x01;

export const MSG_TYPE_FULL_REQUEST = 0x01;
export const MSG_TYPE_AUDIO_ONLY = 0x02;
export const MSG_TYPE_LAST = 0x02; // flag, not msg type

const FLAG_NONE = 0x00;
const FLAG_HAS_SEQ = 0x01;
const FLAG_LAST = 0x02;

// ---------------------------------------------------------------------------
// Synchronous gzip — uses Web CompressionStreams when available; for synchronous
// encode we use a minimal pako-compatible interface. Tests use raw bytes.
// ---------------------------------------------------------------------------

let gzipEncoder: ((data: Uint8Array) => Uint8Array) | null = null;
let gunzipDecoder: ((data: Uint8Array) => Uint8Array) | null = null;

/**
 * Register a gzip implementation. In the browser, pass a pako import.
 * Without registration, frames are sent uncompressed (compression=0).
 */
export function registerGzip(opts: {
  gzip: (data: Uint8Array) => Uint8Array;
  gunzip: (data: Uint8Array) => Uint8Array;
}): void {
  gzipEncoder = opts.gzip;
  gunzipDecoder = opts.gunzip;
}

function maybeGzip(json: Uint8Array): { body: Uint8Array; compression: number } {
  if (gzipEncoder) {
    return { body: gzipEncoder(json), compression: COMPRESS_GZIP };
  }
  return { body: json, compression: COMPRESS_NONE };
}

function maybeGunzip(body: Uint8Array, compression: number): Uint8Array {
  if (compression === COMPRESS_GZIP && gunzipDecoder) {
    return gunzipDecoder(body);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

/**
 * Build the initial FULL_REQUEST frame (config only, no audio per v3 protocol).
 */
export function encodeFullClientRequest(payload: Record<string, unknown>): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const { body, compression } = maybeGzip(jsonBytes);

  const out = new Uint8Array(8 + body.length);
  out[0] = HEADER_BYTE_0;
  out[1] = (MSG_TYPE_FULL_REQUEST << 4) | FLAG_NONE;
  out[2] = (SERIAL_JSON << 4) | compression;
  out[3] = 0x00;
  const dv = new DataView(out.buffer);
  dv.setUint32(4, body.length, false); // big-endian
  out.set(body, 8);
  return out.buffer;
}

/**
 * Build an AUDIO_ONLY frame (no LAST flag).
 */
export function encodeAudioOnly(audio: ArrayBuffer | Uint8Array): ArrayBuffer {
  return encodeAudioFrame(audio, false);
}

/**
 * Build the final AUDIO frame with LAST flag.
 */
export function encodeAudioLast(audio: ArrayBuffer | Uint8Array): ArrayBuffer {
  return encodeAudioFrame(audio, true);
}

function encodeAudioFrame(
  audio: ArrayBuffer | Uint8Array,
  isLast: boolean
): ArrayBuffer {
  const audioBytes =
    audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  const { body, compression } = maybeGzip(audioBytes);

  const out = new Uint8Array(8 + body.length);
  out[0] = HEADER_BYTE_0;
  out[1] = isLast
    ? (MSG_TYPE_AUDIO_ONLY << 4) | FLAG_LAST
    : MSG_TYPE_AUDIO_ONLY << 4;
  out[2] = (SERIAL_JSON << 4) | compression;
  out[3] = 0x00;
  const dv = new DataView(out.buffer);
  dv.setUint32(4, body.length, false);
  out.set(body, 8);
  return out.buffer;
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

export interface ServerResponse {
  msgType: number;
  flags: number;
  serialization: number;
  compression: number;
  seq?: number;
  /** Decompressed JSON (when serialization=JSON) or raw bytes */
  payload: Uint8Array | Record<string, unknown>;
}

/**
 * Parse one server response frame.
 * Returns null if the buffer doesn't contain a complete frame yet.
 */
export function parseServerResponse(
  buf: ArrayBuffer | Uint8Array
): ServerResponse | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 8) return null;

  // byte0 should be 0x11 (protocol version 1)
  if (bytes[0] !== HEADER_BYTE_0) return null;
  const msgType = (bytes[1] >> 4) & 0x0f;
  const flags = bytes[1] & 0x0f;
  const serialization = (bytes[2] >> 4) & 0x0f;
  const compression = bytes[2] & 0x0f;

  let offset = 4;
  let seq: number | undefined;
  if (flags & FLAG_HAS_SEQ) {
    if (bytes.length < 12) return null;
    seq = new DataView(bytes.buffer).getInt32(offset, false);
    offset += 4;
  }
  if (bytes.length < offset + 4) return null;
  const dv = new DataView(bytes.buffer);
  const size = dv.getUint32(offset, false);
  offset += 4;
  if (bytes.length < offset + size) return null;

  const body = bytes.slice(offset, offset + size);
  const decompressed = maybeGunzip(body, compression);

  let payload: Uint8Array | Record<string, unknown> = decompressed;
  if (serialization === SERIAL_JSON) {
    try {
      payload = JSON.parse(new TextDecoder().decode(decompressed));
    } catch {
      // Keep raw bytes
    }
  }
  return { msgType, flags, serialization, compression, seq, payload };
}

/**
 * Extract utterances from a v3 result payload.
 * Speaker ID lives at `utterance.additions.speaker_id` (sauc 2.0),
 * with fallback to `utterance.speaker_id`.
 */
export interface ExtractedUtterance {
  text: string;
  startMs: number;
  endMs: number;
  rawSpeakerId?: string;
  words?: { text: string; startMs: number; endMs: number }[];
  definite?: boolean;
}

export function extractUtterances(
  payload: Record<string, unknown>
): ExtractedUtterance[] {
  const result = payload.result as
    | { utterances?: Array<Record<string, unknown>> }
    | undefined;
  if (!result?.utterances) return [];
  return result.utterances.map((u) => {
    const additions = u.additions as { speaker_id?: string } | undefined;
    const rawWords = (u.words ?? []) as Array<Record<string, unknown>>;
    return {
      text: String(u.text ?? ''),
      startMs: Number(u.start_time ?? 0),
      endMs: Number(u.end_time ?? 0),
      rawSpeakerId: additions?.speaker_id ?? (u.speaker_id as string | undefined),
      words: rawWords.map((w) => ({
        text: String(w.text ?? ''),
        startMs: Number(w.start_time ?? 0),
        endMs: Number(w.end_time ?? 0),
      })),
      definite: Boolean(u.definite ?? false),
    };
  });
}
