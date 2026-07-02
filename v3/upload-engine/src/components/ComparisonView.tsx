// ============================================================
// 技术点对比视图 —— 每个技术点一张统一卡片
//   结构：问题 → 方案A vs 方案B → 数据 → 结论 → 可抄的简历表述
//   图片/安全为浏览器实测；网络类为透明模型估算
// ============================================================

import React, { useState, useCallback, useRef, useMemo } from 'react'
import { formatSize } from '../validator'
import {
  benchImageCases, benchHashCase, benchMagicCase, benchMerkleCase,
  makeSampleImage, makeLargeBlobFile,
  type BenchCase,
} from '../benchmarks'
import { simNetworkCases } from '../bench-sim'

const D = {
  purple: '#7c3aed', purpleLight: '#ede9fe',
  green: '#059669', greenBg: '#ecfdf5',
  red: '#dc2626', amber: '#d97706', blue: '#2563eb',
  gray50: '#f9fafb', gray100: '#f3f4f6', gray200: '#e5e7eb',
  gray300: '#d1d5db', gray400: '#9ca3af', gray500: '#6b7280',
  gray700: '#374151', gray900: '#111827',
}

const GROUPS = ['图片处理', '安全与完整性', '网络与可靠性'] as const
const GROUP_DESC: Record<string, string> = {
  '图片处理': '浏览器内真实实测 · 选图或生成示例后自动运行',
  '安全与完整性': '浏览器内真实实测 · 校验与去重的正确性/性能',
  '网络与可靠性': '受控模型估算 · 输入参数与公式均透明可复核',
}

export const ComparisonView: React.FC = () => {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [imgName, setImgName] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [real, setReal] = useState<BenchCase[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const sims = useMemo(() => simNetworkCases(), [])

  const runReal = useCallback(async (file: File) => {
    setImgName(file.name)
    setImgUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    setBusy('正在运行图片与完整性实测…')
    try {
      const imgCases = await benchImageCases(file)
      const magic = await benchMagicCase()
      const merkle = await benchMerkleCase()
      setReal([...imgCases, magic, merkle])
    } finally {
      setBusy(null)
    }
  }, [])

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) runReal(f)
  }, [runReal])

  const onGenerate = useCallback(async () => {
    setBusy('正在生成示例大图…')
    const f = await makeSampleImage(4000, 3000)
    await runReal(f)
  }, [runReal])

  const onHash = useCallback(async () => {
    setBusy('正在生成 50MB 文件并测指纹…')
    try {
      const f = makeLargeBlobFile(50)
      const h = await benchHashCase(f)
      setReal(prev => [...prev.filter(c => c.id !== 'hash'), h])
    } finally {
      setBusy(null)
    }
  }, [])

  const allCases = useMemo(() => [...real, ...sims], [real, sims])
  const resumeLines = useMemo(() => allCases.map(c => c.resume), [allCases])

  return (
    <div style={s.wrap}>
      <div style={s.intro}>
        <div style={s.h1}>技术点对比 · 每个技术点一张卡片</div>
        <div style={s.sub}>图片/安全为当前浏览器实测；网络类为透明模型估算（参数公式见卡片）。先「生成示例大图」即可填充实测数据。</div>
      </div>

      <div style={s.toolbar}>
        <button style={s.btnPrimary} onClick={onGenerate}>① 生成示例大图并实测</button>
        <button style={s.btn} onClick={() => fileInput.current?.click()}>选择本地图片</button>
        <button style={s.btn} onClick={onHash}>② 指纹对比（50MB）</button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={onPick} />
        {busy && <span style={s.busy}>⏳ {busy}</span>}
        {imgName && !busy && (
          <span style={s.fileTag}>
            {imgUrl && <img src={imgUrl} alt="" style={s.miniThumb} />}{imgName}
          </span>
        )}
      </div>

      {/* 简历量化汇总 */}
      <ResumePanel lines={resumeLines} />

      {/* 分组卡片 */}
      {GROUPS.map(group => {
        const cards = allCases.filter(c => c.group === group)
        return (
          <div key={group} style={s.section}>
            <div style={s.sectionHead}>
              <span style={s.sectionTitle}>{group}</span>
              <span style={s.sectionDesc}>{GROUP_DESC[group]}</span>
            </div>
            {cards.length === 0 ? (
              <div style={s.placeholder}>点上方「生成示例大图并实测」后显示</div>
            ) : (
              <div style={s.grid}>
                {cards.map(c => <CaseCard key={c.id} c={c} />)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---- 单个对比卡片 ----
function CaseCard({ c }: { c: BenchCase }) {
  const max = Math.max(...c.bars.map(b => b.value), 1)
  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        <span style={s.cardTitle}>{c.title}</span>
        <span style={c.kind === '实测' ? s.badgeReal : s.badgeSim}>{c.kind}</span>
      </div>
      <div style={s.problem}>{c.problem}</div>

      <div style={{ margin: '12px 0' }}>
        {c.bars.map((b, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={s.barHead}>
              <span style={{ color: D.gray500 }}>{b.label}</span>
              <span style={{ fontFamily: 'monospace', color: D.gray900, fontWeight: 600 }}>{b.display}</span>
            </div>
            <div style={s.barTrack}>
              <div style={{ ...s.barFill, width: `${Math.max(3, Math.round((b.value / max) * 100))}%`, background: b.color }} />
            </div>
          </div>
        ))}
      </div>

      <div style={s.headlineRow}>
        <span style={s.headline}>{c.headline}</span>
      </div>
      <div style={s.concl}>{c.conclusion}</div>

      <div style={s.resumeBox}>
        <span style={s.resumeTag}>简历表述</span>
        <span style={s.resumeText}>{c.resume}</span>
        <CopyBtn text={c.resume} />
      </div>
    </div>
  )
}

function ResumePanel({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  const all = lines.map(l => `· ${l}`).join('\n')
  return (
    <div style={s.resumePanel}>
      <div style={s.resumePanelHead}>
        <span style={s.resumePanelTitle}>📋 简历量化清单（{lines.length} 条，可整段复制）</span>
        <CopyBtn text={all} label="复制全部" />
      </div>
      <ul style={s.resumeList}>
        {lines.map((l, i) => <li key={i} style={s.resumeLi}>{l}</li>)}
      </ul>
    </div>
  )
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      style={s.copyBtn}
      onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200) }}
    >{ok ? '已复制 ✓' : (label ?? '复制')}</button>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { padding: 20, maxWidth: 1180, margin: '0 auto', width: '100%' },
  intro: { marginBottom: 16 },
  h1: { fontSize: 18, fontWeight: 700, color: D.gray900 },
  sub: { fontSize: 13, color: D.gray500, marginTop: 4, lineHeight: 1.5 },
  toolbar: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' },
  btnPrimary: { padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: D.purple, color: '#fff' },
  btn: { padding: '8px 16px', border: `1px solid ${D.gray300}`, borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, background: '#fff', color: D.gray700 },
  busy: { fontSize: 13, color: D.amber, fontWeight: 500 },
  fileTag: { fontSize: 12, color: D.gray500, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 },
  miniThumb: { width: 24, height: 24, objectFit: 'cover', borderRadius: 4 },

  resumePanel: { background: D.gray900, borderRadius: 12, padding: 16, marginBottom: 22 },
  resumePanelHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  resumePanelTitle: { fontSize: 14, fontWeight: 700, color: '#fff' },
  resumeList: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 },
  resumeLi: { fontSize: 12.5, color: '#d1d5db', lineHeight: 1.6 },

  section: { marginBottom: 26 },
  sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${D.gray200}` },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: D.gray900 },
  sectionDesc: { fontSize: 12, color: D.gray400 },
  placeholder: { fontSize: 12, color: D.gray400, padding: '20px 0', textAlign: 'center', background: D.gray50, borderRadius: 10 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16 },

  card: { background: '#fff', borderRadius: 12, padding: 18, border: `1px solid ${D.gray200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: D.gray900 },
  badgeReal: { fontSize: 10, fontWeight: 700, color: D.green, background: D.greenBg, padding: '2px 8px', borderRadius: 20 },
  badgeSim: { fontSize: 10, fontWeight: 700, color: D.purple, background: D.purpleLight, padding: '2px 8px', borderRadius: 20 },
  problem: { fontSize: 12.5, color: D.gray500, marginTop: 6, lineHeight: 1.55 },

  barHead: { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 },
  barTrack: { height: 10, borderRadius: 5, background: D.gray100, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5, transition: 'width .5s cubic-bezier(0.4,0,0.2,1)' },

  headlineRow: { marginBottom: 8 },
  headline: { fontSize: 20, fontWeight: 800, color: D.green, letterSpacing: -0.5 },
  concl: { fontSize: 12, color: D.gray700, lineHeight: 1.55, background: D.gray50, padding: '8px 10px', borderRadius: 8, marginBottom: 10 },

  resumeBox: { marginTop: 'auto', display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fffbeb', border: `1px solid #fde68a`, borderRadius: 8, padding: '8px 10px' },
  resumeTag: { fontSize: 10, fontWeight: 700, color: D.amber, flexShrink: 0, marginTop: 2 },
  resumeText: { fontSize: 12, color: '#92400e', lineHeight: 1.5, flex: 1 },
  copyBtn: { fontSize: 11, fontWeight: 600, color: D.gray700, background: '#fff', border: `1px solid ${D.gray300}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer', flexShrink: 0 },
}
