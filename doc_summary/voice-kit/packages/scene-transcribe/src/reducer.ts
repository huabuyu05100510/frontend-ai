/**
 * transcriptionReducer — pure function state machine for streaming ASR.
 *
 * Pillar of voice-kit (sedimented from production voice-portfolio):
 * Four-path incremental dedup handles Volcengine's cumulative-mode protocol
 * where each frame resends the full transcript with re-added punctuation.
 *
 * Classification paths (per `(speakerId, definite)` group):
 *   A · Text expansion  : new text is a prefix-extension of last → increment
 *   B · Subset shrink    : new text is subset of last → skip (server rollback)
 *   C · Prefix overlap   : ≥70% normalized prefix overlap → continuation
 *   D · New card         : none of the above → new utterance card
 *
 * Plus: gap-based merge for consecutive same-speaker segments (<1500ms),
 * djb2 stable speaker color, client-side re-labeling by appearance order.
 *
 * Pure: no I/O, no Math.random, no Date.now — timestamps injected via action.
 */

import {
  normalizeForCompare,
  prefixOverlap,
  getSpeakerColor,
} from '@voice-kit/core-utils';
export type { SPEAKER_PALETTE } from '@voice-kit/core-utils';

export interface TranscriptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptionCard {
  /** Stable client-side id */
  id: string;
  /** Engine-provided speaker id (untrusted; client re-labels) */
  rawSpeakerId?: string;
  /** Stable client-assigned label: "发言人 1", "发言人 2"... */
  speakerLabel: string;
  /** Speaker → color mapping */
  speakerColor: string;
  text: string;
  startMs: number;
  endMs: number;
  words?: TranscriptionWord[];
  definite: boolean;
  /** Cumulative-mode indicator (server resends full text each frame) */
  isCumulative?: boolean;
  /**
   * Cumulative mode only: number of leading characters in `text` that were
   * already confirmed by previous finalized cards and should be hidden by
   * the UI. Allows the card to store the full server text (needed for future
   * diff correctness) while rendering only the new portion.
   *
   * Example: server sends cumulative "你好我是助手" but "你好" was already
   * finalized in card 0 → confirmedPrefixLen = 2, display "我是助手".
   */
  confirmedPrefixLen?: number;
  /** Last update timestamp */
  updatedAt: number;
}

export interface TranscriptionStats {
  totalCards: number;
  finalizedCards: number;
  totalChars: number;
  speakerCount: number;
}

export interface TranscriptionState {
  cards: TranscriptionCard[];
  /** Speaker label assignment by appearance order */
  speakerLabels: Map<string, string>;
  stats: TranscriptionStats;
}

export const MAX_CARDS = 200;

export const initialTranscriptionState: TranscriptionState = {
  cards: [],
  speakerLabels: new Map(),
  stats: { totalCards: 0, finalizedCards: 0, totalChars: 0, speakerCount: 0 },
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface ASRUtteranceInput {
  text: string;
  startMs: number;
  endMs: number;
  rawSpeakerId?: string;
  words?: TranscriptionWord[];
  definite?: boolean;
}

export type TranscriptionAction =
  | {
      type: 'PARTIAL';
      text: string;
      isCumulative?: boolean;
      rawSpeakerId?: string;
      ts: number;
    }
  | {
      type: 'FINAL';
      text: string;
      isCumulative?: boolean;
      utterances: ASRUtteranceInput[];
      ts: number;
    }
  | { type: 'CLEAR'; ts: number }
  | { type: 'RENAME_SPEAKER'; from: string; to: string; ts: number }
  | { type: 'EVICT'; count: number; ts: number };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function transcriptionReducer(
  state: TranscriptionState,
  action: TranscriptionAction
): TranscriptionState {
  switch (action.type) {
    case 'CLEAR':
      return {
        ...initialTranscriptionState,
      };

    case 'EVICT': {
      if (action.count <= 0 || state.cards.length <= action.count) {
        return state;
      }
      return {
        ...state,
        cards: state.cards.slice(action.count),
      };
    }

    case 'RENAME_SPEAKER': {
      const labels = new Map(state.speakerLabels);
      labels.set(action.from, action.to);
      return {
        ...state,
        speakerLabels: labels,
        cards: state.cards.map((c) =>
          c.rawSpeakerId === action.from
            ? { ...c, speakerLabel: action.to }
            : c
        ),
      };
    }

    case 'PARTIAL':
      return applyPartial(state, action);

    case 'FINAL':
      return applyFinal(state, action);

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Cumulative prefix helper
// ---------------------------------------------------------------------------

/**
 * In cumulative mode the server resends already-confirmed text on every frame.
 * This helper estimates how many raw characters at the start of `newText` are
 * already represented by finalized cards, so the UI can skip them.
 *
 * Strategy: walk finalized cards for the same speaker (newest first) and find
 * the one whose normalized text is a prefix of the normalized newText. Return
 * the raw character index at which the new content begins.
 */
function computeConfirmedPrefixLen(
  cards: TranscriptionCard[],
  currentIdx: number,
  speakerKey: string,
  newText: string
): number {
  const normNew = normalizeForCompare(newText);
  // Walk backwards through cards BEFORE currentIdx (the card being updated)
  for (let i = currentIdx - 1; i >= 0; i--) {
    const c = cards[i];
    if (c.rawSpeakerId !== speakerKey || !c.definite) continue;
    const normConfirmed = normalizeForCompare(c.text);
    if (normNew.startsWith(normConfirmed) && normConfirmed.length > 0) {
      // Map normalized prefix length back to an approximate raw position by
      // scanning newText and counting non-punctuation/whitespace chars.
      let normCount = 0;
      for (let j = 0; j < newText.length; j++) {
        if (!(/[\p{P}\p{S}\s]/u).test(newText[j])) normCount++;
        if (normCount >= normConfirmed.length) return j + 1;
      }
    }
    // Only inspect the most recent finalized card for this speaker
    break;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// PARTIAL — non-final streaming result
// ---------------------------------------------------------------------------

function applyPartial(
  state: TranscriptionState,
  action: Extract<TranscriptionAction, { type: 'PARTIAL' }>
): TranscriptionState {
  if (!action.text) return state;
  const speakerKey = action.rawSpeakerId ?? 'default';
  const cards = [...state.cards];

  // Find last non-final card for this speaker (the "active" hypothesis).
  // While ASR is still streaming, we keep ONE card per (speaker, in-flight)
  // and update it with the latest hypothesis — Volcengine emits divergent
  // partials as it re-scores acoustic frames, and stacking each variant as
  // its own card produces the "世界上胸 / 世界上数额太大 / 世界上胸怀太大条了"
  // tower seen in production.
  let lastIdx = -1;
  for (let i = cards.length - 1; i >= 0; i--) {
    if (cards[i].rawSpeakerId === speakerKey && !cards[i].definite) {
      lastIdx = i;
      break;
    }
  }

  if (lastIdx === -1) {
    // No active hypothesis for this speaker — create the first card.
    return commitNewCard(state, cards, action, speakerKey, action.text);
  }

  const last = cards[lastIdx];
  const normNew = normalizeForCompare(action.text);
  const normLast = normalizeForCompare(last.text);

  // Server rollback: new is shorter and a strict prefix of last. Keep last;
  // it's the latest committed hypothesis and the shorter variant will likely
  // re-extend on the next frame. Don't churn the UI for sub-second flicker.
  if (normLast.startsWith(normNew) && normNew.length < normLast.length) {
    return state;
  }

  // Active hypothesis for this speaker — update in place regardless of
  // overlap. Overlap-based branching still matters for cumulative prefix
  // accounting (UI uses confirmedPrefixLen to skip already-finalized prefix).
  const confirmedPrefixLen =
    action.isCumulative && normNew.startsWith(normLast)
      ? computeConfirmedPrefixLen(cards, lastIdx, speakerKey, action.text)
      : 0;

  cards[lastIdx] = {
    ...last,
    text: action.text,
    isCumulative: action.isCumulative,
    confirmedPrefixLen,
    updatedAt: action.ts,
  };
  return commitCards(state, cards);
}

// ---------------------------------------------------------------------------
// FINAL — finalized utterances from server
// ---------------------------------------------------------------------------

function applyFinal(
  state: TranscriptionState,
  action: Extract<TranscriptionAction, { type: 'FINAL' }>
): TranscriptionState {
  let cards = [...state.cards];
  // Carry a mutable copy so new speakers discovered mid-loop are visible
  // to subsequent iterations AND to non-definite applyPartial calls.
  const labels = new Map(state.speakerLabels);

  for (const utt of action.utterances) {
    if (!utt.text) continue;
    const speakerKey = utt.rawSpeakerId ?? 'default';

    // Ensure label is registered in the local map (fixes: new speakers from
    // FINAL were never persisted back to state.speakerLabels).
    if (!labels.has(speakerKey)) {
      labels.set(speakerKey, `发言人 ${labels.size + 1}`);
    }
    const label = labels.get(speakerKey)!;

    if (utt.definite) {
      // Definite utterance: lock as finalized card.
      //
      // Volcengine frequently re-emits the same text as a separate definite
      // utterance when speech continues (e.g. server emits "因为我害怕" then a
      // few seconds later emits "因为我害怕" again with a fresh timestamp).
      // Naive creation produces N visually-identical cards stacked in the UI.
      //
      // Dedup strategy: scan backwards through recent definite cards from the
      // same speaker. If any matches utt.text (exact, suffix, or prefix), drop
      // the duplicate and bump the matched card's endMs. Otherwise create new.
      const DEDUP_WINDOW_MS = 3000;
      const normNew = normalizeForCompare(utt.text);
      let matchIdx = -1;
      for (let i = cards.length - 1; i >= 0; i--) {
        const c = cards[i];
        if (c.rawSpeakerId !== speakerKey) continue;
        if (!c.definite) continue; // only dedup against locked cards
        if (utt.startMs - c.endMs > DEDUP_WINDOW_MS) break; // out of window
        const normCard = normalizeForCompare(c.text);
        if (normCard === normNew || normCard.endsWith(normNew) || normNew.startsWith(normCard)) {
          matchIdx = i;
          break;
        }
      }

      if (matchIdx !== -1) {
        // Matched a recent definite card from same speaker within window.
        // Three sub-cases:
        //   (a) exact or suffix-match (normCard.endsWith(normNew))
        //       → pure duplicate, only extend endMs
        //   (b) prefix-extension (normNew.startsWith(normCard))
        //       → cumulative: keep the longer new text
        //   (c) otherwise disjoint within same text shape (rare)
        //       → keep existing; new text would create overlap
        const matched = cards[matchIdx];
        const normCard = normalizeForCompare(matched.text);
        let nextText = matched.text;
        if (normNew.startsWith(normCard) && normNew.length > normCard.length) {
          nextText = utt.text; // cumulative extension: upgrade
        }
        cards[matchIdx] = {
          ...matched,
          text: nextText,
          endMs: utt.endMs,
          words: utt.words ? [...(matched.words ?? []), ...utt.words] : matched.words,
          updatedAt: action.ts,
        };
      } else {
        cards.push({
          id: `card-${cards.length + 1}-${utt.startMs}`,
          rawSpeakerId: speakerKey,
          speakerLabel: label,
          speakerColor: getSpeakerColor(speakerKey),
          text: utt.text,
          startMs: utt.startMs,
          endMs: utt.endMs,
          words: utt.words,
          definite: true,
          updatedAt: action.ts,
        });
      }
    } else {
      // Non-definite: route through partial-like logic.
      // Pass updated labels so commitNewCard sees already-assigned speakers.
      const partialAction = {
        type: 'PARTIAL' as const,
        text: utt.text,
        isCumulative: action.isCumulative,
        rawSpeakerId: speakerKey,
        ts: action.ts,
      };
      const interim = applyPartial({ ...state, cards, speakerLabels: labels }, partialAction);
      cards = interim.cards;
      // Sync any new labels commitNewCard may have added
      for (const [k, v] of interim.speakerLabels) {
        if (!labels.has(k)) labels.set(k, v);
      }
    }
  }

  // Enforce MAX_CARDS via eviction
  if (cards.length > MAX_CARDS) {
    cards = cards.slice(cards.length - MAX_CARDS);
  }

  return commitCards({ ...state, cards, speakerLabels: labels }, cards);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureSpeakerLabel(
  labels: Map<string, string>,
  speakerKey: string
): string {
  const existing = labels.get(speakerKey);
  if (existing) return existing;
  const newLabel = `发言人 ${labels.size + 1}`;
  // Note: caller is responsible for committing the new map
  return newLabel;
}

function commitNewCard(
  state: TranscriptionState,
  cards: TranscriptionCard[],
  action: Extract<TranscriptionAction, { type: 'PARTIAL' }>,
  speakerKey: string,
  text: string
): TranscriptionState {
  const labels = new Map(state.speakerLabels);
  if (!labels.has(speakerKey)) {
    labels.set(speakerKey, `发言人 ${labels.size + 1}`);
  }
  const label = labels.get(speakerKey)!;
  cards.push({
    id: `card-${cards.length + 1}-${action.ts}`,
    rawSpeakerId: speakerKey,
    speakerLabel: label,
    speakerColor: getSpeakerColor(speakerKey),
    text,
    startMs: action.ts,
    endMs: action.ts,
    definite: false,
    isCumulative: action.isCumulative,
    updatedAt: action.ts,
  });
  const newState = { ...state, cards, speakerLabels: labels };
  return recomputeStats(newState);
}

function commitCards(
  state: TranscriptionState,
  cards: TranscriptionCard[]
): TranscriptionState {
  const newState = { ...state, cards };
  return recomputeStats(newState);
}

function recomputeStats(state: TranscriptionState): TranscriptionState {
  let totalChars = 0;
  let finalizedCards = 0;
  const speakers = new Set<string>();
  for (const c of state.cards) {
    totalChars += c.text.length;
    if (c.definite) finalizedCards++;
    if (c.rawSpeakerId) speakers.add(c.rawSpeakerId);
  }
  return {
    ...state,
    stats: {
      totalCards: state.cards.length,
      finalizedCards,
      totalChars,
      speakerCount: speakers.size,
    },
  };
}

