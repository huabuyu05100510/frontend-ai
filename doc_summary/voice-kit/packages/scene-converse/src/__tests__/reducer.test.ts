import { describe, expect, it } from 'vitest';
import {
  conversationReducer,
  initialConverseState,
  ConverseAction,
} from '../reducer';

const ts = () => Date.now();

describe('conversationReducer', () => {
  it('starts in idle', () => {
    expect(initialConverseState.status).toBe('idle');
    expect(initialConverseState.currentResponseId).toBe(0);
  });

  it('transitions idle → connecting → listening', () => {
    let s = initialConverseState;
    s = conversationReducer(s, { type: 'CONNECT_START', ts: ts() });
    expect(s.status).toBe('connecting');
    s = conversationReducer(s, { type: 'CONNECTED', ts: ts() });
    expect(s.status).toBe('listening');
  });

  it('transitions listening → thinking → speaking → listening on full turn', () => {
    let s = initialConverseState;
    s = conversationReducer(s, { type: 'CONNECTED', ts: ts() });
    s = conversationReducer(s, { type: 'USER_SPEECH_START', ts: ts() });
    expect(s.status).toBe('listening');
    s = conversationReducer(s, { type: 'USER_TRANSCRIPT_DELTA', delta: '你好', ts: ts() });
    expect(s.userTranscript).toBe('你好');
    s = conversationReducer(s, { type: 'USER_SPEECH_END', ts: ts() });
    expect(s.status).toBe('thinking');
    s = conversationReducer(s, {
      type: 'AI_RESPONSE_START',
      responseId: '1',
      ts: ts(),
    });
    expect(s.status).toBe('speaking');
    expect(s.assistantMessage?.responseId).toBe('1');
    s = conversationReducer(s, {
      type: 'AI_TRANSCRIPT_DELTA',
      responseId: '1',
      delta: '你好啊',
      ts: ts(),
    });
    expect(s.assistantMessage?.transcript).toBe('你好啊');
    s = conversationReducer(s, {
      type: 'AI_RESPONSE_DONE',
      responseId: '1',
      ts: ts(),
    });
    expect(s.status).toBe('listening');
    expect(s.history.length).toBe(1);
    expect(s.history[0].transcript).toBe('你好啊');
    expect(s.history[0].finalized).toBe(true);
    expect(s.userTranscript).toBe('');
  });

  it('BARGE_IN during speaking bumps currentResponseId and goes to interrupting', () => {
    let s = initialConverseState;
    s = conversationReducer(s, { type: 'CONNECTED', ts: ts() });
    s = conversationReducer(s, { type: 'USER_SPEECH_START', ts: ts() });
    s = conversationReducer(s, { type: 'USER_SPEECH_END', ts: ts() });
    s = conversationReducer(s, { type: 'AI_RESPONSE_START', responseId: '1', ts: ts() });
    s = conversationReducer(s, {
      type: 'AI_TRANSCRIPT_DELTA',
      responseId: '1',
      delta: '正在',
      ts: ts(),
    });
    s = conversationReducer(s, { type: 'BARGE_IN', ts: ts() });
    expect(s.status).toBe('interrupting');
    expect(s.currentResponseId).toBe(1); // bumped from 0
    expect(s.assistantMessage).toBeNull();
    expect(s.history.length).toBe(1); // partial moved to history as finalized
    expect(s.stats.bargeIns).toBe(1);

    s = conversationReducer(s, { type: 'BARGE_IN_COMPLETE', ts: ts() });
    expect(s.status).toBe('listening');
  });

  it('USER_SPEECH_START during speaking triggers automatic barge-in', () => {
    let s = initialConverseState;
    s = conversationReducer(s, { type: 'CONNECTED', ts: ts() });
    s = conversationReducer(s, { type: 'USER_SPEECH_END', ts: ts() }); // thinking
    s = conversationReducer(s, { type: 'AI_RESPONSE_START', responseId: '1', ts: ts() });
    expect(s.status).toBe('speaking');

    // User starts speaking again → auto barge-in
    s = conversationReducer(s, { type: 'USER_SPEECH_START', ts: ts() });
    expect(s.status).toBe('interrupting');
    expect(s.currentResponseId).toBe(1);
    expect(s.stats.bargeIns).toBe(1);
  });

  it('rejects stale AI_AUDIO_CHUNK after barge-in', () => {
    let s = initialConverseState;
    s = conversationReducer(s, { type: 'CONNECTED', ts: ts() });
    s = conversationReducer(s, { type: 'AI_RESPONSE_START', responseId: '1', ts: ts() });
    s = conversationReducer(s, { type: 'BARGE_IN', ts: ts() }); // currentResponseId=1
    s = conversationReducer(s, {
      type: 'AI_AUDIO_CHUNK',
      responseId: '1', // stale
      seq: 5,
      ts: ts(),
    });
    expect(s.stats.droppedStaleChunks).toBe(1);
  });

  it('rejects stale AI_RESPONSE_START after barge-in', () => {
    let s = initialConverseState;
    s = conversationReducer(s, { type: 'CONNECTED', ts: ts() });
    s = conversationReducer(s, { type: 'AI_RESPONSE_START', responseId: '1', ts: ts() });
    s = conversationReducer(s, { type: 'BARGE_IN', ts: ts() }); // bumps to 1
    // Late response start from the pre-barge-in turn — must be dropped
    s = conversationReducer(s, { type: 'AI_RESPONSE_START', responseId: '1', ts: ts() });
    expect(s.assistantMessage).toBeNull();
    expect(s.stats.droppedStaleChunks).toBe(1);
  });

  it('AI_TRANSCRIPT_DELTA on non-matching responseId is ignored', () => {
    let s = initialConverseState;
    s = conversationReducer(s, { type: 'CONNECTED', ts: ts() });
    s = conversationReducer(s, { type: 'AI_RESPONSE_START', responseId: '1', ts: ts() });
    s = conversationReducer(s, {
      type: 'AI_TRANSCRIPT_DELTA',
      responseId: '999', // mismatched
      delta: 'xxx',
      ts: ts(),
    });
    expect(s.assistantMessage?.transcript).toBe('');
  });

  it('ERROR sets error state', () => {
    let s = initialConverseState;
    s = conversationReducer(s, {
      type: 'ERROR',
      code: 'AUTH_FAILED',
      message: 'invalid token',
      ts: ts(),
    });
    expect(s.status).toBe('error');
    expect(s.error?.code).toBe('AUTH_FAILED');
  });
});
