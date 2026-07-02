import { describe, expect, it } from 'vitest';
import {
  transcriptionReducer,
  initialTranscriptionState,
} from '../reducer';

describe('transcriptionReducer — four-path dedup', () => {
  it('Path D: first utterance creates a new card', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '你好',
      rawSpeakerId: 'spk-0',
      ts: 1000,
    });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('你好');
    expect(s.cards[0].speakerLabel).toBe('发言人 1');
    expect(s.cards[0].speakerColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('Path A: prefix extension updates last card text', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '你好',
      rawSpeakerId: 'spk-0',
      ts: 1000,
    });
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '你好世界',
      rawSpeakerId: 'spk-0',
      ts: 1100,
    });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('你好世界');
  });

  it('Path B: server rollback (subset) does not shrink text', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '你好世界', rawSpeakerId: 'spk-0', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '你好', rawSpeakerId: 'spk-0', ts: 1100 });
    expect(s.cards[0].text).toBe('你好世界');
  });

  it('Path C: prefix overlap ≥70% updates last card', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '今天天气很好', rawSpeakerId: 'spk-0', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '今天天气很好我们出去玩吧', rawSpeakerId: 'spk-0', ts: 1100 });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('今天天气很好我们出去玩吧');
  });

  it('Path D: low overlap creates new card', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '今天天气很好', rawSpeakerId: 'spk-0', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '完全不同的话题', rawSpeakerId: 'spk-0', ts: 1100 });
    expect(s.cards.length).toBe(2);
  });

  it('different speakers get different cards and labels', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '你好', rawSpeakerId: 'spk-0', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '嗨', rawSpeakerId: 'spk-1', ts: 1100 });
    expect(s.cards.length).toBe(2);
    expect(s.cards[0].speakerLabel).toBe('发言人 1');
    expect(s.cards[1].speakerLabel).toBe('发言人 2');
    expect(s.cards[0].speakerColor).not.toBe(s.cards[1].speakerColor);
  });

  it('FINAL with definite utterance locks as finalized', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, {
      type: 'FINAL',
      text: '',
      utterances: [
        { text: '你好世界', startMs: 1000, endMs: 2000, rawSpeakerId: 'spk-0', definite: true },
      ],
      ts: 2000,
    });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].definite).toBe(true);
    expect(s.cards[0].text).toBe('你好世界');
    expect(s.stats.finalizedCards).toBe(1);
  });

  it('FINAL merges consecutive same-speaker definite cards within 1500ms', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, {
      type: 'FINAL',
      text: '',
      utterances: [
        { text: '你好', startMs: 1000, endMs: 1500, rawSpeakerId: 'spk-0', definite: true },
        { text: '世界', startMs: 2000, endMs: 2500, rawSpeakerId: 'spk-0', definite: true },
      ],
      ts: 2500,
    });
    // Gap = 2000 - 1500 = 500ms < 1500ms → merge
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('你好世界');
  });

  it('FINAL does NOT merge when gap > 1500ms', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, {
      type: 'FINAL',
      text: '',
      utterances: [
        { text: '你好', startMs: 1000, endMs: 1500, rawSpeakerId: 'spk-0', definite: true },
        { text: '世界', startMs: 5000, endMs: 5500, rawSpeakerId: 'spk-0', definite: true },
      ],
      ts: 5500,
    });
    expect(s.cards.length).toBe(2);
  });

  it('CLEAR resets state', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '你好', rawSpeakerId: 'spk-0', ts: 1000 });
    s = transcriptionReducer(s, { type: 'CLEAR', ts: 2000 });
    expect(s.cards.length).toBe(0);
    expect(s.stats.totalCards).toBe(0);
  });

  it('enforces MAX_CARDS eviction', () => {
    let s = initialTranscriptionState;
    for (let i = 0; i < 250; i++) {
      s = transcriptionReducer(s, {
        type: 'FINAL',
        text: '',
        utterances: [
          {
            text: `话题${i}`,
            startMs: i * 3000,
            endMs: i * 3000 + 1000,
            rawSpeakerId: `spk-${i % 3}`,
            definite: true,
          },
        ],
        ts: i * 3000,
      });
    }
    expect(s.cards.length).toBeLessThanOrEqual(200);
  });

  it('RENAME_SPEAKER updates labels across all cards', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '你好', rawSpeakerId: 'spk-0', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '嗨', rawSpeakerId: 'spk-1', ts: 1100 });
    s = transcriptionReducer(s, { type: 'RENAME_SPEAKER', from: 'spk-0', to: '张三', ts: 1200 });
    expect(s.cards[0].speakerLabel).toBe('张三');
    expect(s.cards[1].speakerLabel).toBe('发言人 2'); // unchanged
  });
});
