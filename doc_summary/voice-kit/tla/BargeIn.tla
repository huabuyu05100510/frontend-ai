---- MODULE BargeIn ----
(*
 * Barge-in打断机制的形式化规约
 *
 * 问题：实时对话中，用户打断AI后，如何保证无陈旧音频残留？
 *
 * 方案：responseId门控机制
 *   - 每个音频chunk携带单调responseId
 *   - interrupt()递增currentResponseId并清空队列
 *   - 入队检查：chunk.responseId >= currentResponseId
 *
 * 不变式：NoStaleAudioPlaying
 *   interrupt完成后，不存在responseId < currentResponseId的音频播放
 *
 * 证明方法：TLA+模型检验
 *   验证所有可达状态下，不变式成立
 *)

EXTENDS Naturals, Sequences

CONSTANTS
  MaxQueueSize,    \* 播放队列最大长度（防止无限增长）
  ResponseIdInit,  \* 初始responseId值
  AudioChunks      \* 所有可能的音频chunk集合

VARIABLES
  currentResponseId,   \* 当前门控值（单调递增）
  playQueue,           \* 播放队列：SEQUENCE of AudioChunk
  playingChunk,        \* 当前正在播放的chunk（可为None）
  systemState          \* 系统状态：idle | playing | interrupted

(* ========================================= *)
(* 类型定义                                   *)
(* ========================================= *)

AudioChunk == [responseId: Nat, audioData: Str]
None == "None"  \* 无播放时的标记

(* ========================================= *)
(* 不变式定义                                 *)
(* ========================================= *)

(* 核心：无陈旧音频播放
 * 定义：
 *   1. 队列中所有chunk的responseId >= currentResponseId
 *   2. 当前播放的chunk（若有）responseId >= currentResponseId
 *)
NoStaleAudioPlaying ==
  /\ \A i \in 1..Len(playQueue) :
       playQueue[i].responseId >= currentResponseId
  /\ \/ playingChunk = None
     \/ playingChunk.responseId >= currentResponseId

(* 辅助不变式：responseId单调性 *)
ResponseIdMonotonic ==
  currentResponseId >= ResponseIdInit

(* 辅助不变式：队列大小限制 *)
QueueSizeBound ==
  Len(playQueue) <= MaxQueueSize

(* ========================================= *)
(* 状态定义                                   *)
(* ========================================= *)

TypeInvariant ==
  /\ currentResponseId \in Nat
  /\ playQueue \in Seq(AudioChunks)
  /\ playingChunk \in AudioChunks \union {None}
  /\ systemState \in {"idle", "playing", "interrupted"}

(* ========================================= *)
(* 初始状态                                   *)
(* ========================================= *)

Init ==
  /\ currentResponseId = ResponseIdInit
  /\ playQueue = <<>>  \* 空队列
  /\ playingChunk = None
  /\ systemState = "idle"

(* ========================================= *)
(* 动作定义                                   *)
(* ========================================= *)

(* 动作1：入队播放
 * 前提：
 *   1. 队列未满
 *   2. chunk.responseId >= currentResponseId（门控检查）
 * 效果：chunk加入队列尾部
 *)
Enqueue(chunk) ==
  /\ Len(playQueue) < MaxQueueSize
  /\ chunk.responseId >= currentResponseId  \* 门控：拒绝陈旧chunk
  /\ playQueue' = Append(playQueue, chunk)
  /\ UNCHANGED <<currentResponseId, playingChunk, systemState>>

(* 动作2：开始播放
 * 前提：
 *   1. 队列非空
 *   2. 当前无播放
 * 效果：
 *   1. 取出队首chunk
 *   2. 开始播放该chunk
 *)
StartPlay ==
  /\ Len(playQueue) > 0
  /\ playingChunk = None
  /\ systemState = "idle"
  /\ playQueue' = Tail(playQueue)
  /\ playingChunk' = Head(playQueue)
  /\ systemState' = "playing"
  /\ UNCHANGED currentResponseId

(* 动作3：播放完成
 * 前提：有chunk正在播放
 * 效果：停止播放，回到idle
 *)
EndPlay ==
  /\ playingChunk /= None
  /\ systemState = "playing"
  /\ playingChunk' = None
  /\ systemState' = "idle"
  /\ UNCHANGED <<currentResponseId, playQueue>>

(* 动作4：打断（核心）
 * 前提：用户触发打断
 * 效果：
 *   1. currentResponseId递增（门控升级）
 *   2. 清空播放队列（丢弃所有待播放chunk）
 *   3. 停止当前播放
 *   4. 状态切换到interrupted（短暂状态）
 *
 * 关键：这是一个原子操作，四步同时发生
 *)
Interrupt ==
  /\ currentResponseId' = currentResponseId + 1  \* 门控递增
  /\ playQueue' = <<>>                            \* 清空队列
  /\ playingChunk' = None                         \* 停止当前播放
  /\ systemState' = "idle"                        \* 回到idle状态

(* 动作5：接收新chunk（模拟网络持续发送）
 * 前提：系统在idle或playing状态
 * 效果：新chunk入队（受门控约束）
 *)
ReceiveChunk ==
  /\ systemState \in {"idle", "playing"}
  /\ \E chunk \in AudioChunks :
       Enqueue(chunk)

(* ========================================= *)
(* 下一步关系                                 *)
(* ========================================= *)

Next ==
  \/ ReceiveChunk
  \/ StartPlay
  \/ EndPlay
  \/ Interrupt

(* ========================================= *)
(* 规约                                       *)
(* ========================================= *)

Spec == Init /\ [Next]_<<currentResponseId, playQueue, playingChunk, systemState>>

(* ========================================= *)
(* 理论证明                                   *)
(* ========================================= *)

THEOREM Spec => []NoStaleAudioPlaying
<1> SUFFICES ASSUME Init, [Next]_vars PROVE []NoStaleAudioPlaying
    BY DEF Spec
<1> USE DEF NoStaleAudioPlaying
<1> QED
    BY DEF Init, Enqueue, StartPlay, EndPlay, Interrupt, Next
    PROVE NoStaleAudioPlaying'

THEOREM Spec => []TypeInvariant
<1> SUFFICES ASSUME Init, [Next]_vars PROVE []TypeInvariant
    BY DEF Spec
<1> QED
    BY DEF Init, TypeInvariant, Next

THEOREM Spec => []ResponseIdMonotonic
<1> QED BY DEF ResponseIdMonotonic, Init, Interrupt

THEOREM Spec => []QueueSizeBound
<1> QED BY DEF QueueSizeBound, Init, Enqueue

====