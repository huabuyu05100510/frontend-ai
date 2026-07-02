// 颜色迁移至 semantic.ts (Phase 2.A)
// VoicePage — 语音中心（对标 Google Translate Voice Mode + Otter.ai + 讯飞听见）
// 模型：claude-sonnet-4-6
//
// 5 个子模式（统一 xf-workspace 布局，与 QualityCheckPage 一致）：
//   1. realtime  — 实时语音翻译（麦克风 → 浏览器 SpeechRecognition → 翻译 → 双语字幕）
//   2. tts       — 文本朗读 + 音色/语速/音调调节 + 波形可视化
//   3. audio     — 音频文件翻译（上传/选择 task → ASR → 翻译）
//   4. video     — 视频文件翻译（同上）
//   5. clone     — 声音复刻（占位向导）
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MicIcon, AudioWaveIcon, MusicIcon, VideoIcon, WandVoiceIcon,
  SparkleIcon, ArrowRightIcon, VolumeIcon, PlayIcon, PauseIcon, StopIcon, CopyIcon,
  CheckIcon, RefreshIcon, FileTextIcon, UploadIcon,
} from '../design/icons'
import { useStore } from '../store'
import type { Task, LangCode } from '../types'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { useAudioLevel } from '../hooks/useAudioLevel'
import { WaveformBars } from '../voice/WaveformBars'
import { MicPulse } from '../voice/MicPulse'
import { BilingualCaption, BilingualCaptionItem } from '../voice/BilingualCaption'
import { VOICE_PRESETS, TRANSLATE_PAIRS, VoicePreset } from '../voice/voicePresets'

type VoiceMode = 'realtime' | 'tts' | 'audio' | 'video' | 'clone'

const SUBMENU: { key: VoiceMode; label: string; desc: string; icon: typeof MicIcon }[] = [
  { key: 'realtime', label: '实时语音翻译', desc: '边说边翻 · 双语字幕', icon: MicIcon },
  { key: 'tts', label: '文本朗读', desc: '多音色 · 调音台', icon: AudioWaveIcon },
  { key: 'audio', label: '音频翻译', desc: 'mp3/wav/m4a → 文字', icon: MusicIcon },
  { key: 'video', label: '视频翻译', desc: 'mp4/mov → 文字', icon: VideoIcon },
  { key: 'clone', label: '声音复刻', desc: '定制专属音色', icon: WandVoiceIcon },
]

const LANG_LABEL: Record<string, string> = {
  'zh-CN': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어',
  'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский',
  'zh': '中文', // pair short form
}

export function VoicePage() {
  const [mode, setMode] = useState<VoiceMode>('realtime')
  return (
    <div className="xf-workspace">
      <div className="xf-submenu">
        {SUBMENU.map(s => (
          <button
            key={s.key}
            className={`xf-submenu-item${mode === s.key ? ' active' : ''}`}
            onClick={() => setMode(s.key)}
            style={{ paddingBottom: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <s.icon size={14} style={{ opacity: 0.7 }} />
              <span>{s.label}</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--xf-text-tertiary)', fontWeight: 400 }}>
              {s.desc}
            </span>
          </button>
        ))}
      </div>

      <div className="xf-content">
        {mode === 'realtime' && <RealtimeMode />}
        {mode === 'tts' && <TtsMode />}
        {mode === 'audio' && <FileTranslateMode kind="audio" />}
        {mode === 'video' && <FileTranslateMode kind="video" />}
        {mode === 'clone' && <CloneMode />}
      </div>
    </div>
  )
}

/* ============ 实时语音翻译模式 ============ */
function RealtimeMode() {
  const [sourceLang, setSourceLang] = useState<LangCode>('zh-CN')
  const [targetLang, setTargetLang] = useState<LangCode>('en')
  const [items, setItems] = useState<BilingualCaptionItem[]>([])
  const [interimTarget, setInterimTarget] = useState('')
  const idRef = useRef(0)
  const translatingRef = useRef<Set<number>>(new Set())
  const { supported, listening, interim, lastFinal, error, start, stop, reset } = useSpeechRecognition(sourceLang, true)
  const { speak, speaking, cancel } = useSpeechSynthesis()
  const { level, levels, active: micActive, start: startMic, stop: stopMic } = useAudioLevel()

  const swapLang = useCallback(() => {
    setSourceLang(prev => { const t = targetLang; setTargetLang(prev); return t })
  }, [targetLang])

  // 翻译 lastFinal
  useEffect(() => {
    if (!lastFinal) return
    const id = ++idRef.current
    const item: BilingualCaptionItem = {
      id, source: lastFinal, target: '', ts: Date.now(), translating: true,
    }
    setItems(prev => [item, ...prev].slice(0, 50))
    translatingRef.current.add(id)

    ;(async () => {
      try {
        const r = await fetch('/api/voice/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ text: lastFinal, sourceLang, targetLang }),
        })
        if (!r.ok) throw new Error(`translate ${r.status}`)
        const data = await r.json()
        const translation = data.translation || ''
        setItems(prev => prev.map(it => it.id === id ? { ...it, target: translation, translating: false } : it))
      } catch (e: any) {
        setItems(prev => prev.map(it => it.id === id ? { ...it, target: `(翻译失败: ${e.message})`, translating: false } : it))
      } finally {
        translatingRef.current.delete(id)
      }
    })()
  }, [lastFinal, sourceLang, targetLang])

  // 实时中间结果也走翻译（节流到 800ms 一次）
  useEffect(() => {
    if (!interim) { setInterimTarget(''); return }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/voice/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ text: interim, sourceLang, targetLang }),
        })
        if (!r.ok) return
        const data = await r.json()
        setInterimTarget(data.translation || '')
      } catch { /* ignore */ }
    }, 800)
    return () => clearTimeout(t)
  }, [interim, sourceLang, targetLang])

  const handleToggle = useCallback(async () => {
    if (listening) {
      stop()
      stopMic()
    } else {
      reset()
      setItems([])
      await startMic()
      start()
    }
  }, [listening, start, stop, reset, startMic, stopMic])

  const handleSpeak = useCallback((text: string, _side: string) => {
    if (speaking) { cancel(); return }
    speak(text, { lang: targetLang, mode: 'browser' })
  }, [speak, speaking, cancel, targetLang])

  const clearAll = useCallback(() => {
    reset(); setItems([]); setInterimTarget('')
  }, [reset])

  return (
    <>
      {/* 顶部控制条 */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--xf-border-light)',
        background: 'var(--xf-bg-subtle, var(--color-bg-subtle))',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <select
          className="xf-select"
          value={sourceLang}
          onChange={e => setSourceLang(e.target.value as LangCode)}
          style={{ minWidth: 140 }}
        >
          {Object.entries(LANG_LABEL).slice(0, 8).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <button className="xf-mini-btn" onClick={swapLang} title="交换语言">
          <ArrowRightIcon size={12} />
        </button>
        <select
          className="xf-select"
          value={targetLang}
          onChange={e => setTargetLang(e.target.value as LangCode)}
          style={{ minWidth: 140 }}
        >
          {Object.entries(LANG_LABEL).slice(0, 8).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        {items.length > 0 && (
          <button className="xf-mini-btn" onClick={clearAll}>
            <RefreshIcon size={12} /> 清空记录
          </button>
        )}
      </div>

      {error && (
        <div style={{
          padding: '8px 24px', background: 'var(--xf-danger-bg, var(--color-danger-bg))',
          borderBottom: '1px solid var(--xf-danger-border, var(--red-3))',
          color: 'var(--xf-danger, var(--color-danger))', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* 主体：上中央麦 + 下字幕流 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 麦克风区 */}
        <div style={{
          padding: '24px 24px 12px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 12, borderBottom: '1px solid var(--xf-border-light)',
        }}>
          <MicPulse
            active={listening}
            level={level}
            disabled={!supported}
            onClick={handleToggle}
            label={listening ? '停止' : '开始'}
          />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: listening ? 'var(--red-6)' : 'var(--xf-text-secondary, var(--color-text-secondary))' }}>
              {listening ? '正在聆听…' : supported ? '点击麦克风开始说话' : '浏览器不支持语音识别'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--xf-text-tertiary)', marginTop: 4 }}>
              {micActive && `音量 ${(level * 100).toFixed(0)}%`} · {items.length} 条已记录
            </div>
          </div>
          <div style={{ width: 320, maxWidth: '90%' }}>
            <WaveformBars levels={levels} active={micActive} height={50} />
          </div>
        </div>

        {/* 字幕流 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px 24px' }}>
          {items.length === 0 && !interim ? (
            <div style={{
              textAlign: 'center', padding: 60, color: 'var(--xf-text-tertiary)',
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎤</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>实时双语字幕</div>
              <div style={{ fontSize: 12 }}>
                支持 {LANG_LABEL[sourceLang]} → {LANG_LABEL[targetLang]} · 自动朗读译文（点击字幕右侧喇叭）
              </div>
            </div>
          ) : (
            <BilingualCaption
              items={items}
              interimSource={interim}
              interimTarget={interimTarget}
              onSpeak={handleSpeak}
              sourceLangLabel={LANG_LABEL[sourceLang]}
              targetLangLabel={LANG_LABEL[targetLang]}
            />
          )}
        </div>
      </div>
    </>
  )
}

/* ============ 文本朗读 TTS 模式 ============ */
function TtsMode() {
  const [text, setText] = useState('欢迎来到智能文档预览平台，这是一段示例文本，您可以编辑后点击朗读试听不同音色。')
  const [preset, setPreset] = useState<VoicePreset>(VOICE_PRESETS[0])
  const [rate, setRate] = useState(1.0)
  const [pitch, setPitch] = useState(1.0)
  const [volume, setVolume] = useState(1.0)
  const [mode, setMode] = useState<'browser' | 'server'>('browser')
  const [engineInfo, setEngineInfo] = useState<{ engine: string; ms: number; voice: string } | null>(null)
  const { speak, cancel, speaking, supported, voices } = useSpeechSynthesis()
  const { level, levels, active, start, stop } = useAudioLevel()

  const handleSpeak = useCallback(async () => {
    if (speaking) { cancel(); stop(); return }
    setEngineInfo(null)
    if (mode === 'browser') {
      await speak(text, { lang: 'zh-CN', rate, pitch, volume, mode: 'browser' })
      // 浏览器模式无法精确感知音量，开启 mic 仅用于可视化
      return
    }
    // server 模式：直接 fetch 并读取响应头
    const t0 = performance.now()
    try {
      if (!active) await start()
      await speak(text, {
        lang: 'zh-CN', rate, pitch, volume, voice: preset.voiceType, mode: 'server',
      })
      // 浏览器播放期间无法读取服务端响应头；估算
      setEngineInfo({
        engine: 'volc-seedtts',
        ms: Math.round(performance.now() - t0),
        voice: preset.voiceType,
      })
    } catch (e: any) {
      setEngineInfo({ engine: 'error', ms: 0, voice: preset.voiceType })
    }
  }, [speaking, cancel, speak, text, rate, pitch, volume, mode, preset, start, stop, active])

  useEffect(() => () => { cancel(); stop() }, [cancel, stop])

  return (
    <>
      {/* 顶部控制条 */}
      <div style={{
        padding: '16px 24px', borderBottom: '1px solid var(--xf-border-light)',
        background: 'var(--xf-bg-subtle)', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--xf-border)', borderRadius: 4, overflow: 'hidden' }}>
          {(['browser', 'server'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 16px', border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--xf-primary)' : '#fff',
                color: mode === m ? '#fff' : 'var(--xf-text-secondary)',
                fontSize: 13, fontWeight: 500,
              }}
            >
              {m === 'browser' ? '浏览器原生' : '火山引擎'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {engineInfo && (
          <span style={{ fontSize: 12, color: 'var(--xf-text-secondary)' }}>
            {engineInfo.engine} · {engineInfo.voice} · {engineInfo.ms}ms
          </span>
        )}
        <button
          className={speaking ? 'xf-mini-btn danger' : 'xf-btn-solid'}
          onClick={handleSpeak}
          disabled={!text.trim() || (mode === 'browser' && !supported)}
          style={{ minWidth: 110 }}
        >
          {speaking ? <><StopIcon size={14} /> 停止</> : <><VolumeIcon size={14} /> 朗读</>}
        </button>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', minHeight: 0 }}>
        {/* 左：文本 + 波形 */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--xf-border-light)' }}>
          <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--xf-text-tertiary)', letterSpacing: 1 }}>
              待朗读文本（最长 1024 字节）
            </label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={500}
              style={{
                flex: 1, width: '100%', resize: 'none',
                border: '1px solid var(--xf-border)', borderRadius: 8,
                padding: 16, fontSize: 16, lineHeight: 2,
                fontFamily: 'inherit', outline: 'none',
                background: '#fff', color: 'var(--xf-text)',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--xf-primary)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--xf-border)'}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--xf-text-tertiary)' }}>
              <span>{text.length} / 500 字符 · {Buffer_byteLength(text)} 字节</span>
              <span>音量 {(volume * 100).toFixed(0)}% · 语速 {rate.toFixed(2)} · 音调 {pitch.toFixed(2)}</span>
            </div>
          </div>
          {/* 波形 */}
          <div style={{
            padding: '12px 24px 20px', background: 'linear-gradient(to bottom, transparent, rgba(22,119,255,0.03))',
            borderTop: '1px solid var(--xf-border-light)',
          }}>
            <WaveformBars levels={levels} active={active || speaking} height={60} color="linear-gradient(90deg, var(--color-primary), var(--color-ai))" />
          </div>
        </div>

        {/* 右：音色预设 + 调音台 */}
        <div style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, background: '#fff' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--xf-text-tertiary)', letterSpacing: 1, marginBottom: 8 }}>
              音色预设
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {VOICE_PRESETS.map(p => (
                <div
                  key={p.id}
                  onClick={() => { setPreset(p); setRate(p.speed); setPitch(p.pitch); setVolume(p.volume) }}
                  style={{
                    cursor: 'pointer',
                    border: preset.id === p.id ? '2px solid var(--xf-primary)' : '1px solid var(--xf-border-light)',
                    borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 4,
                    background: preset.id === p.id ? 'var(--xf-primary-bg)' : '#fff',
                    transition: 'all 0.18s',
                  }}
                >
                  <div style={{
                    width: '100%', height: 36, borderRadius: 6,
                    background: p.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, color: '#fff',
                  }}>{p.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--xf-text)' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)' }}>{p.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--xf-text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
              音色 ID: <code style={{ background: 'var(--xf-bg-subtle)', padding: '1px 4px', borderRadius: 2 }}>{preset.voiceType}</code>
              <br />浏览器模式可选 {voices.length} 个系统音色；服务端模式由火山引擎合成。
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--xf-border-light)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--xf-text-tertiary)', letterSpacing: 1, marginBottom: 12 }}>
              调音台
            </div>
            <Slider label="语速" min={0.5} max={2.0} step={0.05} value={rate} onChange={setRate} format={v => `${v.toFixed(2)}x`} />
            <Slider label="音调" min={0.5} max={2.0} step={0.05} value={pitch} onChange={setPitch} format={v => v.toFixed(2)} />
            <Slider label="音量" min={0} max={1} step={0.05} value={volume} onChange={setVolume} format={v => `${(v * 100).toFixed(0)}%`} />
          </div>
        </div>
      </div>
    </>
  )
}

function Slider({ label, min, max, step, value, onChange, format }: {
  label: string; min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; format: (v: number) => string
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: 'var(--xf-text-secondary)' }}>{label}</span>
        <span style={{ color: 'var(--xf-primary)', fontFamily: 'monospace', fontWeight: 600 }}>{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--xf-primary)' }}
      />
    </div>
  )
}

// Buffer.byteLength polyfill（前端无 Node Buffer）
function Buffer_byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

interface VoiceSegment {
  start_ms: number
  end_ms: number
  source: string
  target: string
  engine?: string
}

/* ============ 音频/视频文件翻译模式 ============ */
function FileTranslateMode({ kind }: { kind: 'audio' | 'video' }) {
  const { tasks } = useStore()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [processing, setProcessing] = useState(false)
  const [segments, setSegments] = useState<VoiceSegment[]>([])
  const [hoveredSegIdx, setHoveredSegIdx] = useState<number | null>(null)
  const [activeSegIdx, setActiveSegIdx] = useState<number | null>(null)
  const [engine, setEngine] = useState<string>('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)

  const exts = kind === 'audio'
    ? ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'pcm', 'amr']
    : ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'm4v']
  const fileTasks = useMemo(() => tasks.filter(t => exts.includes(t.ext)), [tasks, exts])

  // 当前时刻所在段（基于 segments.start/end）
  const findSegmentAtTime = useCallback((ms: number) => {
    for (let i = 0; i < segments.length; i++) {
      if (ms >= segments[i].start_ms && ms < segments[i].end_ms) return i
    }
    return null
  }, [segments])

  // audio.timeupdate → 高亮当前段
  const onTimeUpdate = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    const ms = (a.currentTime || 0) * 1000
    setElapsedMs(ms)
    const idx = findSegmentAtTime(ms)
    setActiveSegIdx(idx)
  }, [findSegmentAtTime])

  // hover segment → 跳转音频到该段起始
  const handleSegmentEnter = useCallback((seg: VoiceSegment) => {
    const a = audioRef.current
    if (a && Number.isFinite(seg.start_ms)) {
      try { a.currentTime = seg.start_ms / 1000 } catch {}
    }
  }, [])

  const run = useCallback(async () => {
    if (!selectedTask) return
    setProcessing(true); setError(null); setSegments([])
    const t0 = performance.now()
    try {
      // 单次端点：ASR + 分段 + per-segment 翻译（避免前端两次请求）
      const res = await fetch('/api/speech/asr-segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          taskId: selectedTask.id,
          lang: 'zh-CN',
          sourceLang: 'zh',
          targetLang: 'en',
        }),
      })
      if (!res.ok) throw new Error(`ASR ${res.status}`)
      const data = await res.json()
      setSegments(data.segments || [])
      setEngine(data.engine || 'mock')
      setElapsedMs(Math.round(performance.now() - t0))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setProcessing(false)
    }
  }, [selectedTask])

  const audioSrc = selectedTask?.originalUrl || ''
  const fmtMs = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    const mmm = String(ms % 1000).padStart(3, '0').slice(0, 2)
    return `${mm}:${ss}.${mmm}`
  }

  return (
    <>
      <div style={{
        padding: '16px 24px', borderBottom: '1px solid var(--xf-border-light)',
        background: 'var(--xf-bg-subtle)', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          className="xf-btn-solid"
          onClick={run}
          disabled={!selectedTask || processing}
          style={{ minWidth: 120 }}
        >
          {processing ? <><span className="xf-loading" /> 处理中…</> : <><SparkleIcon size={14} /> ASR + 翻译</>}
        </button>
        {segments.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--xf-text-secondary)' }}>
            {engine} · {elapsedMs}ms · {segments.length} 段
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: '8px 24px', background: 'var(--xf-danger-bg)',
          borderBottom: '1px solid var(--xf-danger-border)',
          color: 'var(--xf-danger)', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
        {/* 左：文件选择 */}
        <div style={{ padding: 16, overflow: 'auto', borderRight: '1px solid var(--xf-border-light)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: 'var(--xf-text)' }}>
            选择{kind === 'audio' ? '音频' : '视频'}文件（支持 {exts.slice(0, 6).join('/')} 等）
          </div>
          {fileTasks.length === 0 ? (
            <div className="xf-empty" style={{ padding: 60, textAlign: 'center' }}>
              <UploadIcon size={32} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 500 }}>暂无可处理文件</div>
              <div style={{ fontSize: 12 }}>请先在「文档预览」上传 {kind === 'audio' ? '音频' : '视频'}文件</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {fileTasks.map(t => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTask(t)}
                  style={{
                    cursor: 'pointer', padding: 12, borderRadius: 8,
                    border: selectedTask?.id === t.id ? '2px solid var(--xf-primary)' : '1px solid var(--xf-border-light)',
                    background: selectedTask?.id === t.id ? 'var(--xf-primary-bg)' : '#fff',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                    background: kind === 'audio'
                      ? 'linear-gradient(135deg, var(--magenta-4), var(--red-5))'
                      : 'linear-gradient(135deg, var(--blue-4), var(--cyan-3))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  }}>
                    {kind === 'audio' ? <MusicIcon size={18} /> : <VideoIcon size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--xf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--xf-text-tertiary)' }}>
                      {t.ext.toUpperCase()} · {(t.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                  {selectedTask?.id === t.id && <CheckIcon size={16} style={{ color: 'var(--xf-primary)' }} />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右：音频 + 分段 + 翻译结果 */}
        <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {selectedTask && audioSrc && (
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--xf-border-light)',
                background: 'var(--color-bg-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <VolumeIcon size={14} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>原音回放</span>
                <span style={{ fontSize: 11, color: 'var(--xf-text-tertiary)' }}>
                  · 播放时高亮当前段 · hover 段跳转音频
                </span>
                {engine && (
                  <span style={{ fontSize: 11, color: 'var(--xf-text-tertiary)', marginLeft: 'auto' }}>
                    ASR={engine}
                  </span>
                )}
              </div>
              <audio
                ref={audioRef}
                data-testid="voice-audio"
                src={audioSrc}
                controls
                onTimeUpdate={onTimeUpdate}
                style={{ width: '100%', height: 36 }}
              />
            </div>
          )}

          {/* 可视化时间轴：每段一个彩色 marker，点击/hover 跳转音频 + 高亮段卡 */}
          {segments.length > 0 && (() => {
            const totalMs = Math.max(
              1,
              segments.reduce((m, s) => Math.max(m, s.end_ms || 0), 0)
            )
            const markerColors = ['var(--color-primary)', 'var(--color-info)', 'var(--color-ai)', 'var(--color-success)', 'var(--orange-6)', 'var(--magenta-6)', 'var(--orange-6)']
            return (
              <div
                data-testid="voice-timeline"
                style={{
                  padding: '10px 16px 12px',
                  borderBottom: '1px solid var(--xf-border-light)',
                  background: 'linear-gradient(180deg, var(--color-accent-bg) 0%, #fff 100%)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--xf-text-secondary)', letterSpacing: 0.5 }}>
                    ⏱ 段标记时间轴（点击跳转）
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--xf-text-tertiary)', fontFamily: 'SF Mono, Consolas, monospace' }}>
                    00:00 → {fmtMs(totalMs)}
                  </span>
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: 36,
                    background: 'linear-gradient(90deg, rgba(22,119,255,0.04), rgba(22,119,255,0.08))',
                    borderRadius: 6,
                    overflow: 'hidden',
                    border: '1px solid rgba(22,119,255,0.15)',
                  }}
                >
                  {/* 当前播放头 */}
                  {elapsedMs > 0 && (
                    <div
                      data-testid="voice-playhead"
                      style={{
                        position: 'absolute',
                        left: `${Math.min(100, (elapsedMs / totalMs) * 100)}%`,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        background: 'var(--color-primary)',
                        boxShadow: '0 0 6px rgba(22,119,255,0.7)',
                        pointerEvents: 'none',
                        zIndex: 3,
                      }}
                    />
                  )}
                  {segments.map((seg, i) => {
                    const left = (seg.start_ms / totalMs) * 100
                    const width = ((seg.end_ms - seg.start_ms) / totalMs) * 100
                    const active = activeSegIdx === i
                    const hovered = hoveredSegIdx === i
                    const color = markerColors[i % markerColors.length]
                    return (
                      <div
                        key={i}
                        data-testid={`voice-timeline-marker-${i}`}
                        data-start={seg.start_ms}
                        data-end={seg.end_ms}
                        onMouseEnter={() => { setHoveredSegIdx(i); handleSegmentEnter(seg) }}
                        onMouseLeave={() => setHoveredSegIdx(prev => prev === i ? null : prev)}
                        onClick={() => handleSegmentEnter(seg)}
                        title={`${fmtMs(seg.start_ms)} → ${fmtMs(seg.end_ms)} · ${seg.source.slice(0, 20)}${seg.source.length > 20 ? '…' : ''}`}
                        className={`voice-timeline-marker${active ? ' active' : ''}${hovered ? ' hovered' : ''}`}
                        style={{
                          position: 'absolute',
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 4,
                          bottom: 4,
                          background: active
                            ? color
                            : hovered ? `${color}cc` : `${color}55`,
                          border: active ? `2px solid ${color}` : `1px solid ${color}88`,
                          borderRadius: 3,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          color: active ? '#fff' : color,
                          fontWeight: 600,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          padding: '0 4px',
                          transition: 'all 120ms',
                          boxShadow: active ? `0 2px 8px ${color}66` : 'none',
                          zIndex: 2,
                        }}
                      >
                        {width > 5 ? seg.source : String(i + 1)}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          <div style={{ padding: 16, flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--xf-text-tertiary)', letterSpacing: 1, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              分段转写 + 译文（{segments.length} 段）
              {processing && <><span className="xf-loading" /> 处理中…</>}
              {elapsedMs > 0 && segments.length > 0 && !processing && (
                <span style={{ marginLeft: 'auto' }}>总耗时 {elapsedMs}ms</span>
              )}
            </div>

            {segments.length === 0 && !processing && (
              <div style={{
                fontSize: 14, lineHeight: 1.8, color: 'var(--xf-text-tertiary)',
                minHeight: 120, padding: 12, background: 'var(--xf-bg-subtle)', borderRadius: 6,
                whiteSpace: 'pre-wrap',
              }}>点击左侧文件 + ASR + 翻译 按钮开始识别</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {segments.map((seg, i) => {
                const active = activeSegIdx === i
                const hovered = hoveredSegIdx === i
                return (
                  <div
                    key={i}
                    data-testid={`voice-segment-${i}`}
                    data-start={seg.start_ms}
                    data-end={seg.end_ms}
                    onMouseEnter={() => { setHoveredSegIdx(i); handleSegmentEnter(seg) }}
                    onMouseLeave={() => setHoveredSegIdx(prev => prev === i ? null : prev)}
                    className={`voice-segment${active ? ' active' : ''}${hovered ? ' hovered' : ''}`}
                    style={{
                      padding: 12,
                      borderRadius: 6,
                      background: active
                        ? 'rgba(22,119,255,0.10)'
                        : hovered ? 'rgba(22,119,255,0.04)' : '#fff',
                      border: active
                        ? '1.5px solid var(--color-primary)'
                        : '1px solid var(--xf-border-light)',
                      cursor: 'pointer',
                      transition: 'all 120ms',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontFamily: 'SF Mono, Consolas, monospace',
                        fontSize: 11,
                        color: active ? 'var(--color-primary)' : 'var(--xf-text-tertiary)',
                        fontWeight: 600,
                      }}>
                        {fmtMs(seg.start_ms)} → {fmtMs(seg.end_ms)}
                      </span>
                      <span style={{
                        fontSize: 11,
                        color: 'var(--xf-text-tertiary)',
                      }}>
                        ({Math.round((seg.end_ms - seg.start_ms) / 100) / 10}s)
                      </span>
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--xf-text)', marginBottom: 4 }}>
                      {seg.source}
                    </div>
                    <div style={{
                      fontSize: 13, lineHeight: 1.6,
                      color: 'var(--color-ai)',
                      borderTop: '1px dashed var(--xf-border-light)',
                      paddingTop: 6,
                    }}>
                      {seg.target || '(无译文)'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ============ 声音复刻占位 ============ */
function CloneMode() {
  return (
    <div style={{ padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <div style={{
        width: 96, height: 96, borderRadius: 24,
        background: 'linear-gradient(135deg, var(--indigo-5), var(--purple-7))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', boxShadow: '0 12px 36px rgba(102,126,234,0.35)',
      }}>
        <WandVoiceIcon size={48} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--xf-text)', margin: 0 }}>
          声音复刻 2.0
        </h2>
        <p style={{ fontSize: 13, color: 'var(--xf-text-secondary)', marginTop: 8, maxWidth: 480, lineHeight: 1.7 }}>
          上传 10 秒至 5 分钟的训练样本，模型将训练出您的专属音色 ID，
          后续 TTS 可使用该音色合成自然流畅的语音。
        </p>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
        {[
          { n: '1', t: '上传样本', d: '10s - 5min 干净录音（16kHz 单声道）' },
          { n: '2', t: '训练模型', d: '服务端训练约 30-60 秒，等待完成' },
          { n: '3', t: '试听使用', d: '在文本朗读模块选择该音色合成' },
        ].map(s => (
          <div key={s.n} style={{
            width: 220, padding: 20, background: '#fff',
            border: '1px solid var(--xf-border-light)', borderRadius: 12,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--xf-primary-bg)', color: 'var(--xf-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14,
            }}>{s.n}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--xf-text)' }}>{s.t}</div>
            <div style={{ fontSize: 12, color: 'var(--xf-text-tertiary)', lineHeight: 1.5 }}>{s.d}</div>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 16, padding: '12px 20px', borderRadius: 8,
        background: 'rgba(250,173,20,0.08)', border: '1px solid rgba(250,173,20,0.3)',
        fontSize: 12, color: 'var(--amber-8)', maxWidth: 480, textAlign: 'center',
      }}>
        ⚠️ 该能力依赖火山引擎 voice_cloning.2_0 接口（VOLC_VOICE_CLONE_API_KEY）。
        当前未配置凭证，UI 已就绪；服务端凭证补齐后即可启用完整链路。
      </div>
    </div>
  )
}
