#!/usr/bin/env node
/**
 * Quick real-ASR smoke test: connect to gateway, send a synthesized 440Hz tone
 * for 2 seconds, expect at least one server response frame.
 */
import WebSocket from '/Users/didi/Downloads/前端AI/doc_summary/voice-kit/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js';

const GATEWAY = 'ws://localhost:8787/api/asr/doubao?lang=zh-CN&domain=general';
const SAMPLE_RATE = 16000;
const DURATION_MS = 5000;

// --- v3/sauc frame builders (mirroring packages/provider-doubao/src/codec.ts) ---
// Volcengine v3/sauc: byte1 = (msgType << 4) | flags
//   msgType: 0x1 = FULL_CLIENT_REQUEST, 0x2 = AUDIO_ONLY
//   flags:   0x0 = none, 0x2 = LAST (NOT a separate msgType)
const HEADER0 = 0x11;
const SERIAL_JSON = 0x01;

function buildFrame(msgType, flags, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const out = Buffer.alloc(8 + json.length);
  out[0] = HEADER0;
  out[1] = ((msgType << 4) | flags) & 0xff;
  out[2] = (SERIAL_JSON << 4) | 0;
  out[3] = 0x00;
  out.writeUInt32BE(json.length, 4);
  json.copy(out, 8);
  return out;
}

function fullClientRequest() {
  return buildFrame(0x01, 0x00, {
    user: { uid: 'smoke-test', platform: 'Web' },
    audio: { format: 'pcm', codec: 'raw', rate: SAMPLE_RATE, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      show_utterances: true,
      result_type: 'full',
    },
  });
}

function audioOnly(pcm) {
  const out = Buffer.alloc(8 + pcm.length);
  out[0] = HEADER0;
  out[1] = (0x02 << 4) | 0x00; // AUDIO_ONLY, no LAST flag
  out[2] = (SERIAL_JSON << 4) | 0;
  out[3] = 0x00;
  out.writeUInt32BE(pcm.length, 4);
  pcm.copy(out, 8);
  return out;
}

function audioLast() {
  // LAST is a flag (0x02) on AUDIO_ONLY (msgType 0x2), NOT a new msgType
  const out = Buffer.alloc(8);
  out[0] = HEADER0;
  out[1] = (0x02 << 4) | 0x02; // AUDIO_ONLY + FLAG_LAST
  out[2] = (SERIAL_JSON << 4) | 0;
  out[3] = 0x00;
  out.writeUInt32BE(0, 4);
  return out;
}

// --- Speech-like signal: sum of 200/400/800/1600 Hz with amplitude modulation,
// mimics the envelope of human voice better than a pure 440Hz tone ---
function genSpeechLike() {
  const n = (SAMPLE_RATE * DURATION_MS) / 1000;
  const buf = Buffer.alloc(n * 2);
  const carriers = [200, 400, 800, 1600];
  const weights = [0.4, 0.3, 0.2, 0.1];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // Amplitude envelope ~5Hz + 3Hz (syllable-like rhythm)
    const env = 0.5 + 0.5 * Math.abs(Math.sin(2 * Math.PI * 5 * t) * Math.sin(2 * Math.PI * 3 * t));
    let v = 0;
    for (let k = 0; k < carriers.length; k++) {
      v += weights[k] * Math.sin(2 * Math.PI * carriers[k] * t);
    }
    v *= env * 0.4; // overall gain
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32768))), i * 2);
  }
  return buf;
}

const ws = new WebSocket(GATEWAY);
let opened = false;
let frames = 0;
let textPayloads = [];

ws.on('open', () => {
  opened = true;
  console.log('[smoke] WS open');
  ws.send(fullClientRequest());
  console.log('[smoke] sent FULL_CLIENT_REQUEST');

  // Stream sine in 100ms chunks
  const sine = genSpeechLike();
  const chunkMs = 100;
  const chunkSamples = (SAMPLE_RATE * chunkMs) / 1000;
  let offset = 0;
  const tick = setInterval(() => {
    if (offset >= sine.length) {
      clearInterval(tick);
      ws.send(audioLast());
      console.log('[smoke] sent AUDIO_LAST');
      return;
    }
    const slice = sine.subarray(offset, offset + chunkSamples * 2);
    ws.send(audioOnly(slice));
    offset += slice.length;
  }, chunkMs);
});

ws.on('message', (data) => {
  frames++;
  if (typeof data === 'string') {
    textPayloads.push(data);
    console.log('[smoke] TEXT frame:', data.slice(0, 200));
  } else {
    const buf = data;
    const msgType = (buf[1] >> 4) & 0x0f;
    const size = buf.readUInt32BE(4);
    const json = buf.subarray(8, 8 + size).toString('utf8');
    console.log(`[smoke] BINARY frame msgType=0x${msgType.toString(16)} size=${size}:`, json.slice(0, 300));
  }
});

ws.on('close', (code, reason) => {
  console.log(`[smoke] WS closed code=${code} reason="${reason.toString().slice(0, 80)}"`);
});

ws.on('error', (err) => {
  console.error('[smoke] WS error:', err.message);
});

setTimeout(() => {
  console.log(`\n[smoke] timeout — opened=${opened} frames=${frames}`);
  ws.close();
  process.exit(frames > 0 ? 0 : 1);
}, 12000);