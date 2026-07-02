/**
 * @voice-kit/core-types — AI provider interface
 *
 * One SDK, three providers: Doubao (火山引擎) / Zhipu (智谱 GLM) / MiniMax.
 * Each provider implements the capabilities it supports; scenes gracefully
 * degrade when a capability is unavailable.
 */

export type ProviderId = 'doubao' | 'zhipu' | 'minimax';

export type AICapability =
  | 'asr-stream' // streaming speech recognition
  | 'asr-file' // offline file transcription
  | 'tts-stream' // streaming text-to-speech
  | 'llm-chat' // text chat completion
  | 'realtime-voice' // full-duplex realtime voice (OpenAI-Realtime-compatible)
  | 'voice-clone'
  | 'translation';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  capabilities: readonly AICapability[];
}

// ---------------------------------------------------------------------------
// ASR
// ---------------------------------------------------------------------------

export interface ASRStreamConfig {
  language?: string;
  /** Enable punctuation post-processing */
  punctuation?: boolean;
  /** Enable ITN (Inverse Text Normalization): "一百" → "100" */
  itn?: boolean;
  /** Enable speaker diarization */
  diarization?: boolean;
  /** Audio format expected by the engine */
  audioFormat: AudioFormatImport;
  /** Hint for domain-specific model selection */
  domain?: 'general' | 'meeting' | 'medical' | 'legal' | 'finance';
}

export interface AudioFormatImport {
  sampleRate: 8000 | 16000 | 24000 | 44100 | 48000;
  encoding: 'pcm-s16le' | 'pcm-f32le' | 'opus' | 'mp3';
  channels: 1 | 2;
}

export interface ASRWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ASRUtterance {
  text: string;
  startMs: number;
  endMs: number;
  /** Speaker id (engine-dependent; client re-labels by appearance order) */
  speakerId?: string;
  words?: ASRWord[];
  /** Whether the utterance is finalized (will not change) */
  definite?: boolean;
}

export type ASRResult =
  | {
      kind: 'partial';
      text: string;
      /** Cumulative-mode indicator: subsequent partials grow on this text */
      isCumulative?: boolean;
      ts: number;
      latencyMs?: number;
    }
  | {
      kind: 'final';
      text: string;
      isCumulative?: boolean;
      utterances: ASRUtterance[];
      ts: number;
      latencyMs?: number;
    }
  | {
      kind: 'error';
      code: string;
      message: string;
    };

export interface IASRProvider {
  /** Open a streaming ASR session; returns a controller + result stream */
  openStream(config: ASRStreamConfig): Promise<ASRStreamSession>;
}

export interface ASRStreamSession {
  /** Push raw audio bytes (must match config.audioFormat) */
  pushAudio(chunk: ArrayBuffer): void;
  /** Signal end-of-stream (last frame) */
  finalize(): void;
  /** Async iterable of results */
  results(): AsyncIterable<ASRResult>;
  /** Close the session */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export interface TTSConfig {
  voice?: string;
  speed?: number; // 0.5..2.0
  pitch?: number;
  volume?: number;
  /** Audio format for the synthesized stream */
  audioFormat: AudioFormatImport;
}

export interface TTSSentence {
  text: string;
  startMs: number;
}

export interface TTSResult {
  /** Synthesized audio chunk (matches config.audioFormat) */
  audio: ArrayBuffer;
  /** Bumped on each sentence boundary; subs for closed captions */
  sentence?: TTSSentence;
  /** Marks the final chunk */
  isFinal?: boolean;
}

export interface ITTSProvider {
  /** Stream synthesized audio for the given text */
  stream(text: string, config: TTSConfig): AsyncIterable<TTSResult>;
}

// ---------------------------------------------------------------------------
// LLM chat
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LLMStreamOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ILLMProvider {
  stream(
    messages: LLMMessage[],
    opts?: LLMStreamOptions
  ): AsyncIterable<{ delta: string; done: boolean }>;
}

// ---------------------------------------------------------------------------
// Realtime voice (full-duplex) — OpenAI-Realtime-compatible protocol
// ---------------------------------------------------------------------------

export type RealtimeEvent =
  | { type: 'session.created'; sessionId: string; model: string }
  | { type: 'speech.started'; ts: number } // user started speaking → barge-in candidate
  | { type: 'speech.stopped'; ts: number }
  | { type: 'user.transcript'; delta: string; ts: number }
  | { type: 'assistant.transcript'; delta: string; ts: number }
  | { type: 'assistant.audio'; audio: ArrayBuffer; responseId: string; seq: number; isFinal?: boolean; ts: number }
  | { type: 'response.done'; responseId: string; ts: number }
  | { type: 'error'; code: string; message: string; ts: number };

export interface RealtimeSessionConfig {
  model?: string;
  voice?: string;
  turnDetection?: {
    type: 'server_vad';
    silenceDurationMs?: number;
    threshold?: number;
  };
  /** Audio format for both input and output */
  audioFormat: AudioFormatImport;
}

export interface IRealtimeProvider {
  /** Open a realtime voice session */
  openSession(config: RealtimeSessionConfig): Promise<RealtimeSession>;
}

export interface RealtimeSession {
  /** Send user audio chunk (must match config.audioFormat) */
  pushAudio(chunk: ArrayBuffer): void;
  /** Server events stream */
  events(): AsyncIterable<RealtimeEvent>;
  /** Manually trigger AI response (for push-to-talk) */
  triggerResponse(): void;
  /** Cancel current response (server-side) */
  cancelResponse(): void;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Top-level provider aggregate
// ---------------------------------------------------------------------------

export interface IAIProvider {
  readonly info: ProviderInfo;
  asr?: IASRProvider;
  tts?: ITTSProvider;
  llm?: ILLMProvider;
  realtime?: IRealtimeProvider;
}

// ---------------------------------------------------------------------------
// Provider factory — scenes consume via dependency injection
// ---------------------------------------------------------------------------

export interface ProviderCredentials {
  appId?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  resourceId?: string;
  endpoint?: string;
}

export type ProviderFactory = (creds: ProviderCredentials) => IAIProvider;
