/**
 * Dedup regression tests — covers the applyFinal definite-utterance logic
 * that was producing stacked duplicate cards when Volcengine re-emitted the
 * same trailing text as a fresh FINAL within the same session.
 *
 * Run: pnpm --filter @voice-kit/scene-transcribe test
 */
import { describe, expect, it } from 'vitest';
import {
  transcriptionReducer,
  initialTranscriptionState,
} from '../reducer';
import type { TranscriptionAction } from '../reducer';

function finalAt(
  text: string,
  startMs: number,
  endMs: number,
  speaker = 'spk0'
): TranscriptionAction {
  return {
    type: 'FINAL',
    text,
    isCumulative: false,
    utterances: [{ text, startMs, endMs, rawSpeakerId: speaker, definite: true }],
    ts: endMs,
  };
}

describe('applyFinal definite dedup', () => {
  it('consecutive identical FINAL → 1 card', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, finalAt('因为我害怕', 1000, 2000));
    s = transcriptionReducer(s, finalAt('因为我害怕', 2100, 3000));
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('因为我害怕');
  });

  it('FINAL separated by partial → still 1 card (window-dedup)', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, finalAt('因为我害怕', 1000, 2000));
    // partial from another speaker-style fragment in between
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '中间插一句',
      ts: 2500,
    });
    s = transcriptionReducer(s, finalAt('因为我害怕', 2600, 3500));
    expect(s.cards.length).toBe(2); // 1 definite + 1 partial-card
    const definiteCards = s.cards.filter((c) => c.definite);
    expect(definiteCards.length).toBe(1);
    expect(definiteCards[0].text).toBe('因为我害怕');
    // endMs extended to the latest duplicate
    expect(definiteCards[0].endMs).toBe(3500);
  });

  it('different text → 2 cards', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, finalAt('第一句', 1000, 2000));
    s = transcriptionReducer(s, finalAt('第二句', 2100, 3000));
    expect(s.cards.length).toBe(2);
    expect(s.cards[0].text).toBe('第一句');
    expect(s.cards[1].text).toBe('第二句');
  });

  it('same text after >3s window → 2 cards (no dedup)', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, finalAt('很久以前', 1000, 2000));
    s = transcriptionReducer(s, finalAt('很久以前', 6000, 7000));
    expect(s.cards.length).toBe(2);
  });

  it('different speakers, same text → 2 cards', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, finalAt('同意', 1000, 2000, 'spk0'));
    s = transcriptionReducer(s, finalAt('同意', 2100, 3000, 'spk1'));
    expect(s.cards.length).toBe(2);
    expect(s.cards[0].rawSpeakerId).toBe('spk0');
    expect(s.cards[1].rawSpeakerId).toBe('spk1');
  });

  it('prefix extension (cumulative) → keep full extended text', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, finalAt('你好', 1000, 2000));
    s = transcriptionReducer(s, finalAt('你好世界', 2100, 3000));
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('你好世界');
  });

  it('exact duplicate from screenshot scenario — three duplicates + 1 partial → 1 definite card', () => {
    let s = initialTranscriptionState;
    // mimic user's screenshot: same phrase re-emitted 3 times with partials between
    s = transcriptionReducer(s, finalAt('因为我害怕', 1000, 2000));
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '15', ts: 2200 });
    s = transcriptionReducer(s, finalAt('因为我害怕', 2300, 3300));
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '直接刻到了文韬 BK', ts: 3500 });
    s = transcriptionReducer(s, finalAt('因为我害怕', 3600, 4500));
    const definiteCards = s.cards.filter((c) => c.definite);
    expect(definiteCards.length).toBe(1);
    expect(definiteCards[0].text).toBe('因为我害怕');
  });
});

describe('applyPartial divergent hypotheses (in-flight dedup)', () => {
  // Reproduces the user's 2nd screenshot: same in-flight utterance producing
  // multiple ASR hypotheses with low character overlap, each currently creates
  // its own card. After fix: only ONE in-flight card per speaker.

  it('divergent partials same speaker → 1 card, latest text wins', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '世界上胸', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '世界上数额太大', ts: 1100 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '世界上胸怀太大条了', ts: 1200 });
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '世界上数额太大条了，我没发现',
      ts: 1300,
    });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('世界上数额太大条了，我没发现');
    expect(s.cards[0].definite).toBe(false);
  });

  it('rollback (shorter prefix) → keep longer last', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '今天天气很好', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '今天天气', ts: 1100 });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('今天天气很好');
  });

  it('partial after FINAL → new card', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, finalAt('第一句', 1000, 2000));
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '第二句开始', ts: 2500 });
    expect(s.cards.length).toBe(2);
    expect(s.cards[0].definite).toBe(true);
    expect(s.cards[1].text).toBe('第二句开始');
    expect(s.cards[1].definite).toBe(false);
  });

  it('cumulative mode partial extension after definite → new partial card', () => {
    let s = initialTranscriptionState;
    // Prior definite card locks "你好"
    s = transcriptionReducer(s, finalAt('你好', 500, 1000));
    // Cumulative partial resends "你好" + new tail — creates new partial card
    // because the prior card is definite. confirmedPrefixLen is set when a
    // *cumulative* partial extends another partial; here the partial is fresh.
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '你好我是助手',
      isCumulative: true,
      ts: 1500,
    });
    expect(s.cards.length).toBe(2);
    expect(s.cards[0].definite).toBe(true);
    expect(s.cards[1].text).toBe('你好我是助手');
    expect(s.cards[1].definite).toBe(false);
  });

  it('cumulative mode partial EXTENDS another partial → confirmedPrefixLen set', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '你好',
      isCumulative: true,
      ts: 1000,
    });
    s = transcriptionReducer(s, {
      type: 'PARTIAL',
      text: '你好我是助手',
      isCumulative: true,
      ts: 1100,
    });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('你好我是助手');
    // No prior definite card with matching prefix → 0
    expect(s.cards[0].confirmedPrefixLen).toBe(0);
  });

  it('identical partial repeated → still 1 card, no churn', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '重复的话', ts: 1000 });
    const before = s.cards[0].updatedAt;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '重复的话', ts: 1100 });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('重复的话');
    expect(s.cards[0].updatedAt).toBe(1100); // timestamp still bumps
  });

  it('empty partial text → no-op (no card created, no churn)', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '第一句', ts: 1000 });
    s = transcriptionReducer(s, { type: 'PARTIAL', text: '', ts: 1100 });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].text).toBe('第一句'); // unchanged
    expect(s.cards[0].updatedAt).toBe(1000); // unchanged
  });

  it('non-definite FINAL utterance (e.g. final with one indefinite utterance) → routed through applyPartial', () => {
    let s = initialTranscriptionState;
    s = transcriptionReducer(s, {
      type: 'FINAL',
      text: '第一句',
      utterances: [{ text: '第一句', startMs: 1000, endMs: 2000, definite: false }],
      ts: 2000,
    });
    expect(s.cards.length).toBe(1);
    expect(s.cards[0].definite).toBe(false);
    expect(s.cards[0].text).toBe('第一句');
  });
});