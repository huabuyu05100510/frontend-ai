/**
 * conversationReducer — pure function state machine for AI voice conversation.
 *
 * States: idle → connecting → listening ⇄ thinking ⇄ speaking → completed
 *
 * Barge-in: when user starts speaking during 'speaking', state goes back to
 * 'listening' atomically; conversationReducer must NOT emit assistant audio
 * after the interrupt boundary.
 *
 * Pure: no I/O, no timers, no Math.random. Timestamps injected via action.
 */

export type ConverseStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupting'   // transient: barge-in initiated, draining in-flight chunks
  | 'paused'         // transport dropped; auto-reconnect in progress (not fatal)
  | 'thinking_timeout' // AI hasn't responded within configured timeout
  | 'completed'
  | 'error';

export interface AssistantMessage {
  responseId: string;
  /** Accumulated assistant transcript text so far */
  transcript: string;
  /** True once response.done received */
  finalized: boolean;
  ts: number;
}

export interface ConverseState {
  status: ConverseStatus;
  /** Monotonic response id; bumped on every AI response & every barge-in */
  currentResponseId: number;
  /** Last user transcript (incremental) */
  userTranscript: string;
  /** Current assistant message in flight (if any) */
  assistantMessage: AssistantMessage | null;
  /** Completed assistant messages, oldest first */
  history: AssistantMessage[];
  /** Last error */
  error: { code: string; message: string; ts: number } | null;
  /** Counters for observability */
  stats: {
    bargeIns: number;
    droppedStaleChunks: number;
    completedResponses: number;
  };
}

export const initialConverseState: ConverseState = {
  status: 'idle',
  currentResponseId: 0,
  userTranscript: '',
  assistantMessage: null,
  history: [],
  error: null,
  stats: { bargeIns: 0, droppedStaleChunks: 0, completedResponses: 0 },
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ConverseAction =
  | { type: 'CONNECT_START'; ts: number }
  | { type: 'CONNECTED'; ts: number }
  | { type: 'DISCONNECT'; ts: number; reason?: string }
  | { type: 'USER_SPEECH_START'; ts: number }
  | { type: 'USER_SPEECH_END'; ts: number }
  | { type: 'USER_TRANSCRIPT_DELTA'; delta: string; ts: number }
  | { type: 'AI_RESPONSE_START'; responseId: string; ts: number }
  | {
      type: 'AI_AUDIO_CHUNK';
      responseId: string;
      seq: number;
      ts: number;
    }
  | { type: 'AI_TRANSCRIPT_DELTA'; responseId: string; delta: string; ts: number }
  | { type: 'AI_RESPONSE_DONE'; responseId: string; ts: number }
  | { type: 'BARGE_IN'; ts: number }
  | { type: 'BARGE_IN_COMPLETE'; ts: number }
  | { type: 'ERROR'; code: string; message: string; ts: number }
  /** Transport dropped but reconnect is in progress — not user-facing fatal. */
  | { type: 'TRANSPORT_PAUSED'; ts: number }
  /** Transport successfully reconnected after a TRANSPORT_PAUSED. */
  | { type: 'TRANSPORT_RESUMED'; ts: number }
  /**
   * AI has not responded within the caller-configured timeout window.
   * The scene orchestrator dispatches this after arming a timer on USER_SPEECH_END.
   * Moves from 'thinking' → 'thinking_timeout' so the UI can show a retry prompt.
   */
  | { type: 'THINKING_TIMEOUT'; ts: number }
  /** User or UI retries after thinking_timeout. */
  | { type: 'THINKING_RETRY'; ts: number };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function conversationReducer(
  state: ConverseState,
  action: ConverseAction
): ConverseState {
  switch (action.type) {
    case 'CONNECT_START':
      return { ...state, status: 'connecting', error: null };

    case 'CONNECTED':
      return { ...state, status: 'listening' };

    case 'DISCONNECT':
      return {
        ...state,
        status: 'completed',
        error: action.reason
          ? { code: 'DISCONNECT', message: action.reason, ts: action.ts }
          : state.error,
      };

    case 'USER_SPEECH_START': {
      // Barge-in: if AI is speaking, transition through interrupting
      if (state.status === 'speaking' || state.status === 'thinking') {
        const nextResponseId = state.currentResponseId + 1;
        const history =
          state.assistantMessage && state.assistantMessage.transcript
            ? [...state.history, { ...state.assistantMessage, finalized: true }]
            : state.history;
        return {
          ...state,
          status: 'interrupting',
          currentResponseId: nextResponseId,
          assistantMessage: null,
          history,
          userTranscript: '',
          stats: {
            ...state.stats,
            bargeIns: state.stats.bargeIns + 1,
          },
        };
      }
      return { ...state, status: 'listening', userTranscript: '' };
    }

    case 'USER_SPEECH_END':
      if (state.status === 'listening') {
        return { ...state, status: 'thinking' };
      }
      return state;

    case 'USER_TRANSCRIPT_DELTA': {
      if (state.status !== 'listening' && state.status !== 'interrupting') {
        return state;
      }
      return {
        ...state,
        userTranscript: state.userTranscript + action.delta,
      };
    }

    case 'AI_RESPONSE_START': {
      // Reject if responseId is stale (from a previous response pre-barge-in).
      // After barge-in to N, the just-interrupted response had id == N, so
      // reject when responseId <= currentResponseId.
      if (Number(action.responseId) <= state.currentResponseId) {
        return bumpStale(state);
      }
      return {
        ...state,
        status: 'speaking',
        assistantMessage: {
          responseId: action.responseId,
          transcript: '',
          finalized: false,
          ts: action.ts,
        },
      };
    }

    case 'AI_AUDIO_CHUNK': {
      // Stale chunks (from a response before the latest barge-in) are counted
      if (Number(action.responseId) <= state.currentResponseId) {
        return bumpStale(state);
      }
      return state;
    }

    case 'AI_TRANSCRIPT_DELTA': {
      if (
        !state.assistantMessage ||
        state.assistantMessage.responseId !== action.responseId
      ) {
        return state;
      }
      if (Number(action.responseId) <= state.currentResponseId) {
        return bumpStale(state);
      }
      return {
        ...state,
        assistantMessage: {
          ...state.assistantMessage,
          transcript: state.assistantMessage.transcript + action.delta,
        },
      };
    }

    case 'AI_RESPONSE_DONE': {
      if (
        state.assistantMessage &&
        state.assistantMessage.responseId === action.responseId
      ) {
        const finalized: AssistantMessage = {
          ...state.assistantMessage,
          finalized: true,
        };
        return {
          ...state,
          status: 'listening',
          assistantMessage: null,
          history: [...state.history, finalized],
          userTranscript: '',
          stats: {
            ...state.stats,
            completedResponses: state.stats.completedResponses + 1,
          },
        };
      }
      return state;
    }

    case 'BARGE_IN': {
      // Programmatic barge-in (e.g. user clicked stop button)
      if (state.status !== 'speaking' && state.status !== 'thinking') {
        return state;
      }
      const nextResponseId = state.currentResponseId + 1;
      const history =
        state.assistantMessage && state.assistantMessage.transcript
          ? [...state.history, { ...state.assistantMessage, finalized: true }]
          : state.history;
      return {
        ...state,
        status: 'interrupting',
        currentResponseId: nextResponseId,
        assistantMessage: null,
        history,
        stats: {
          ...state.stats,
          bargeIns: state.stats.bargeIns + 1,
        },
      };
    }

    case 'BARGE_IN_COMPLETE':
      // Player has finished draining; safe to listen again
      if (state.status === 'interrupting') {
        return { ...state, status: 'listening' };
      }
      return state;

    case 'ERROR':
      return {
        ...state,
        status: 'error',
        error: { code: action.code, message: action.message, ts: action.ts },
      };

    case 'TRANSPORT_PAUSED': {
      // Only move to paused from active states; idle/completed/error are unaffected.
      if (
        state.status === 'listening' ||
        state.status === 'thinking' ||
        state.status === 'speaking' ||
        state.status === 'interrupting'
      ) {
        return { ...state, status: 'paused' };
      }
      return state;
    }

    case 'TRANSPORT_RESUMED': {
      // Resume only from paused; go back to listening (user must re-speak).
      if (state.status === 'paused') {
        return { ...state, status: 'listening' };
      }
      return state;
    }

    case 'THINKING_TIMEOUT': {
      // Only meaningful while waiting for AI to respond.
      if (state.status === 'thinking') {
        return { ...state, status: 'thinking_timeout' };
      }
      return state;
    }

    case 'THINKING_RETRY': {
      // User acknowledged timeout — go back to listening so they can re-speak.
      if (state.status === 'thinking_timeout') {
        return {
          ...state,
          status: 'listening',
          userTranscript: '',
          error: null,
        };
      }
      return state;
    }

    default:
      return state;
  }
}

function bumpStale(state: ConverseState): ConverseState {
  return {
    ...state,
    stats: {
      ...state.stats,
      droppedStaleChunks: state.stats.droppedStaleChunks + 1,
    },
  };
}
