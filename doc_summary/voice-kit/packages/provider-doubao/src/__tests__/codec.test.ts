import { describe, expect, it } from 'vitest';
import {
  encodeFullClientRequest,
  encodeAudioOnly,
  encodeAudioLast,
  parseServerResponse,
  extractUtterances,
} from '../codec';

describe('Volcengine v3/sauc binary codec', () => {
  it('encodeFullClientRequest produces correct header bytes', () => {
    const buf = encodeFullClientRequest({ foo: 'bar' });
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0x11); // protocol version 1, header size 1*4
    expect(bytes[1] >> 4).toBe(0x01); // FULL_REQUEST msg type
    expect(bytes[1] & 0x0f).toBe(0x00); // no flags
    expect(bytes[2] >> 4).toBe(0x01); // JSON serialization
    // Compression may be 0 (no gzip registered) or 1
    expect(bytes.length).toBeGreaterThan(8);
  });

  it('encodeAudioOnly sets AUDIO_ONLY msg type', () => {
    const audio = new Uint8Array([1, 2, 3, 4]).buffer;
    const buf = encodeAudioOnly(audio);
    const bytes = new Uint8Array(buf);
    expect(bytes[1] >> 4).toBe(0x02);
    expect(bytes[1] & 0x0f).toBe(0x00); // no LAST flag
  });

  it('encodeAudioLast sets LAST flag', () => {
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const buf = encodeAudioLast(audio);
    const bytes = new Uint8Array(buf);
    expect(bytes[1] >> 4).toBe(0x02);
    expect(bytes[1] & 0x0f).toBe(0x02); // LAST
  });

  it('round-trips encode → parse with no compression', () => {
    const payload = { hello: 'world', n: 42 };
    const encoded = encodeFullClientRequest(payload);
    const parsed = parseServerResponse(encoded);
    expect(parsed).not.toBeNull();
    // Note: parsed.payload will be Uint8Array if no gzip registered
    if (parsed && parsed.payload instanceof Uint8Array) {
      const json = JSON.parse(new TextDecoder().decode(parsed.payload));
      expect(json).toEqual(payload);
    }
  });

  it('parseServerResponse returns null for truncated buffers', () => {
    expect(parseServerResponse(new ArrayBuffer(4))).toBeNull();
    expect(parseServerResponse(new ArrayBuffer(0))).toBeNull();
  });

  it('parseServerResponse returns null for wrong protocol byte', () => {
    const bad = new Uint8Array(8);
    bad[0] = 0x00; // wrong protocol
    expect(parseServerResponse(bad.buffer)).toBeNull();
  });

  it('extractUtterances reads speaker_id from additions (sauc 2.0)', () => {
    const payload = {
      result: {
        utterances: [
          {
            text: '你好',
            start_time: 100,
            end_time: 500,
            definite: true,
            additions: { speaker_id: 'spk-0' },
            words: [{ text: '你', start_time: 100, end_time: 300 }],
          },
        ],
      },
    };
    const utts = extractUtterances(payload);
    expect(utts.length).toBe(1);
    expect(utts[0].text).toBe('你好');
    expect(utts[0].rawSpeakerId).toBe('spk-0');
    expect(utts[0].definite).toBe(true);
    expect(utts[0].words?.[0].text).toBe('你');
  });

  it('extractUtterances falls back to top-level speaker_id', () => {
    const payload = {
      result: {
        utterances: [
          {
            text: '嗨',
            start_time: 0,
            end_time: 100,
            speaker_id: 'spk-1',
          },
        ],
      },
    };
    const utts = extractUtterances(payload);
    expect(utts[0].rawSpeakerId).toBe('spk-1');
  });

  it('extractUtterances returns [] for empty payload', () => {
    expect(extractUtterances({})).toEqual([]);
    expect(extractUtterances({ result: {} })).toEqual([]);
  });
});
