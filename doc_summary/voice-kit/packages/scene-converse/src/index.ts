/**
 * @voice-kit/scene-converse — public API surface
 *
 * Composes: capture → ASR (or realtime provider) → LLM → TTS → player,
 * with the Barge-in FSM as the orchestrator.
 */

export {
  conversationReducer,
  initialConverseState,
} from './reducer';
export type {
  ConverseStatus,
  ConverseState,
  ConverseAction,
  AssistantMessage,
} from './reducer';

export { ScheduledPlayer } from './scheduled-player';
export type {
  AudioContextLike,
  AudioBufferLike,
  AudioBufferSourceLike,
  ScheduledPlayerOptions,
} from './scheduled-player';

export { VadPlaybackCoordinator } from './vad-playback-coordinator';
export type { VadPlaybackCoordinatorOptions } from './vad-playback-coordinator';

export { WordSyncTracker } from './word-sync-tracker';
export type { TrackedWord, WordSyncTrackerOptions, AudioContextRef } from './word-sync-tracker';
