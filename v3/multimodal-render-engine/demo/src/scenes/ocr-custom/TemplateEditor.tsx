/**
 * OCR 自定义模板编辑器 — 对标讯飞 / 百度 iOCR
 *
 * Tab 1：框选参照字段（蓝色框）
 * Tab 2：框选识别区（红色框）
 * 两个 Tab 完全对称：多框 / 拖拽 / 8向 resize / 旋转 handle / hover & 选中高亮
 * 右侧：字段名称（可编辑）/ 字段类型 / 识别结果 / 选中时显示坐标
 */
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'

// ──────────────────── Types ────────────────────

interface FieldBox {
  id: string
  num: number
  name: string          // 用户可编辑
  fieldType: string
  x: number; y: number; w: number; h: number   // 自然像素
  rotation: number      // degrees
  ocrText: string
}

type Mode = 'select' | 'draw'
type HandleDir = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'

interface DrawState { sx:number; sy:number; ex:number; ey:number }
interface DragState {
  fieldId: string
  handle: HandleDir | 'move'
  origBox: FieldBox
  startX: number; startY: number
}
interface RotState {
  fieldId: string
  cx: number; cy: number
  startRotation: number
  startPointerAngle: number
}

// ──────────────────── Constants ────────────────────

const TAB_COLOR: Record<1|2, string> = { 1:'#1890ff', 2:'#f5222d' }
const TAB1_TYPES = ['文本','数字','日期','金额','选框','图片']
const TAB2_TYPES = ['通用识别','纯数字','长串数字','日期','金额','表格']
const HANDLE_DIRS: HandleDir[] = ['nw','n','ne','e','se','s','sw','w']
const HANDLE_CURSORS: Record<HandleDir,string> = {
  nw:'nw-resize', n:'n-resize', ne:'ne-resize', e:'e-resize',
  se:'se-resize', s:'s-resize', sw:'sw-resize', w:'w-resize',
}
const MIN_BOX  = 20
const MIN_AREA = 400
const BASE_W   = 620

// ──────────────────── Sample image + mock OCR ────────────────────

const SAMPLE_ROWS = [
  { x:20,  y:58,  w:280, h:28, text:'1100161430' },
  { x:320, y:58,  w:280, h:28, text:'08765432' },
  { x:20,  y:100, w:580, h:28, text:'2024年03月15日' },
  { x:20,  y:142, w:580, h:28, text:'北京某某科技有限公司' },
  { x:20,  y:184, w:580, h:28, text:'上海某供应链管理有限公司' },
  { x:20,  y:226, w:580, h:28, text:'软件开发服务' },
  { x:20,  y:268, w:280, h:28, text:'¥ 85,000.00' },
  { x:320, y:268, w:280, h:28, text:'¥ 5,100.00' },
  { x:20,  y:310, w:580, h:28, text:'捌万玖仟壹佰元整' },
  { x:20,  y:352, w:280, h:28, text:'¥ 90,100.00' },
  { x:320, y:352, w:280, h:28, text:'请妥善保管，遗失不补' },
]

function mockOCR(box: {x:number;y:number;w:number;h:number}): string {
  let best='', bestArea=0
  for (const row of SAMPLE_ROWS) {
    const ix = Math.max(0, Math.min(box.x+box.w, row.x+row.w) - Math.max(box.x, row.x))
    const iy = Math.max(0, Math.min(box.y+box.h, row.y+row.h) - Math.max(box.y, row.y))
    const a = ix*iy
    if (a > bestArea) { bestArea=a; best=row.text }
  }
  return best
}

function buildSampleImage(): string {
  const W=620, H=420
  const cv = document.createElement('canvas')
  cv.width=W; cv.height=H
  const c = cv.getContext('2d')!
  c.fillStyle='#fff'; c.fillRect(0,0,W,H)
  c.strokeStyle='#e0e0e0'; c.strokeRect(0,0,W,H)
  c.fillStyle='#1677ff'; c.fillRect(0,0,W,44)
  c.fillStyle='#fff'; c.font='bold 18px sans-serif'; c.textAlign='center'
  c.fillText('增值税专用发票', W/2, 28)
  c.fillStyle='#ff4d4f'; c.fillRect(W-90,4,86,36)
  c.fillStyle='#fff'; c.font='12px sans-serif'; c.textAlign='center'
  c.fillText('专票', W-47, 26)
  const rows = [
    {x:20,  y:58,  w:280, h:28, label:'发票代码',      value:'1100161430'},
    {x:320, y:58,  w:280, h:28, label:'发票号码',      value:'08765432'},
    {x:20,  y:100, w:580, h:28, label:'开票日期',      value:'2024年03月15日'},
    {x:20,  y:142, w:580, h:28, label:'购买方名称',    value:'北京某某科技有限公司'},
    {x:20,  y:184, w:580, h:28, label:'销售方名称',    value:'上海某供应链管理有限公司'},
    {x:20,  y:226, w:580, h:28, label:'商品/服务名称', value:'软件开发服务'},
    {x:20,  y:268, w:280, h:28, label:'不含税金额',    value:'¥ 85,000.00'},
    {x:320, y:268, w:280, h:28, label:'税额',          value:'¥ 5,100.00'},
    {x:20,  y:310, w:580, h:28, label:'价税合计(大写)', value:'捌万玖仟壹佰元整'},
    {x:20,  y:352, w:280, h:28, label:'价税合计(小写)', value:'¥ 90,100.00'},
    {x:320, y:352, w:280, h:28, label:'备注',          value:'请妥善保管，遗失不补'},
  ]
  c.textAlign='left'
  rows.forEach(({x,y,w,h,label,value}) => {
    c.fillStyle='#fafafa'; c.fillRect(x,y,w,h)
    c.strokeStyle='#e8e8e8'; c.strokeRect(x,y,w,h)
    c.fillStyle='#888'; c.font='10px sans-serif'; c.fillText(label, x+6, y+11)
    c.fillStyle='#1a1a1a'; c.font='13px sans-serif'; c.fillText(value, x+6, y+24)
  })
  c.fillStyle='#f5f5f5'; c.fillRect(20,390,580,24)
  c.fillStyle='#aaa'; c.font='11px sans-serif'; c.textAlign='center'
  c.fillText('销货单位签章：___________    购货单位签章：___________', W/2, 406)
  return cv.toDataURL('image/png')
}

// ──────────────────── Coord helpers ────────────────────

function getScale(img: HTMLImageElement|null): number {
  if (!img || !img.naturalWidth) return 1
  return img.offsetWidth / img.naturalWidth
}

function handlePos(b: FieldBox, dir: HandleDir, s: number): [number,number] {
  const [x,y,w,h]=[b.x*s, b.y*s, b.w*s, b.h*s]
  const m: Record<HandleDir,[number,number]> = {
    nw:[x,y], n:[x+w/2,y], ne:[x+w,y], e:[x+w,y+h/2],
    se:[x+w,y+h], s:[x+w/2,y+h], sw:[x,y+h], w:[x,y+h/2],
  }
  return m[dir]
}

function toLocal(dx:number, dy:number, rot:number): [number,number] {
  if (rot===0) return [dx,dy]
  const r=-rot*Math.PI/180
  return [dx*Math.cos(r)-dy*Math.sin(r), dx*Math.sin(r)+dy*Math.cos(r)]
}

function applyDrag(orig: FieldBox, dir: HandleDir|'move', ldx:number, ldy:number, s:number): FieldBox {
  const nx=ldx/s, ny=ldy/s, MIN=MIN_BOX/s
  let {x,y,w,h}=orig
  if (dir==='move') return {...orig, x:x+nx, y:y+ny}
  if (dir.includes('n')) { const d=Math.min(ny,h-MIN); y+=d; h-=d }
  if (dir.includes('s')) { h=Math.max(h+ny,MIN) }
  if (dir.includes('w')) { const d=Math.min(nx,w-MIN); x+=d; w-=d }
  if (dir.includes('e')) { w=Math.max(w+nx,MIN) }
  return {...orig, x,y,w,h}
}

// ──────────────────── Main component ────────────────────

export function TemplateEditor() {
  const imgRef    = useRef<HTMLImageElement>(null)
  const svgRef    = useRef<SVGSVGElement>(null)
  const fileRef   = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)
  const dragRef   = useRef<DragState|null>(null)
  const rotRef    = useRef<RotState|null>(null)

  const [imgUrl,    setImgUrl]    = useState<string|null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [step,      setStep]      = useState<1|2>(1)
  const [tab1,      setTab1]      = useState<FieldBox[]>([])
  const [tab2,      setTab2]      = useState<FieldBox[]>([])
  const [mode,      setMode]      = useState<Mode>('select')
  const [selectedId,setSelectedId]= useState<string|null>(null)
  const [hoveredId, setHoveredId] = useState<string|null>(null)
  const [drawing,   setDrawing]   = useState<DrawState|null>(null)
  const [toast,     setToast]     = useState<string|null>(null)
  const [canvasZoom,setCanvasZoom]= useState(1)
  const [next1,     setNext1]     = useState(1)
  const [next2,     setNext2]     = useState(1)

  // Derived active / ghost sets
  const activeFields    = step===1 ? tab1 : tab2
  const setActiveFields = step===1 ? setTab1 : setTab2
  const activeColor     = TAB_COLOR[step]
  const fieldTypes      = step===1 ? TAB1_TYPES : TAB2_TYPES
  const tabLabel        = step===1 ? '参照字段' : '识别区'
  const nextNum         = step===1 ? next1 : next2
  const setNextNum      = step===1 ? setNext1 : setNext2

  const scale = imgLoaded ? getScale(imgRef.current) : 1
  const selectedField = activeFields.find(f=>f.id===selectedId) ?? null

  useEffect(() => { setImgUrl(buildSampleImage()) }, [])

  // Canvas wheel zoom
  useEffect(() => {
    const el = canvasRef.current; if (!el) return
    const fn = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setCanvasZoom(z => Math.min(3, Math.max(0.3, +(z - e.deltaY*0.002).toFixed(2))))
    }
    el.addEventListener('wheel', fn, {passive:false})
    return () => el.removeEventListener('wheel', fn)
  }, [imgLoaded])

  function showToast(msg:string) { setToast(msg); setTimeout(()=>setToast(null),2000) }

  function switchTab(s: 1|2) {
    setStep(s); setSelectedId(null); setHoveredId(null); setDrawing(null); setMode('select')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f=e.target.files?.[0]; if (!f) return
    setImgUrl(URL.createObjectURL(f)); setImgLoaded(false)
    setTab1([]); setTab2([]); setSelectedId(null); setNext1(1); setNext2(1)
    e.target.value=''
  }

  // ── SVG helpers ──

  const svgPoint = useCallback((e: React.PointerEvent) => {
    const b = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX-b.left, y: e.clientY-b.top }
  }, [])

  // ── Pointer down ──
  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const target  = e.target as SVGElement
    const fieldId = target.closest('[data-fid]')?.getAttribute('data-fid') ?? null
    const hdl     = target.getAttribute('data-handle')
    const svgEl   = e.currentTarget

    // ── Rotation handle ──
    if (hdl==='rotate' && fieldId) {
      const field = activeFields.find(f=>f.id===fieldId); if (!field) return
      e.preventDefault(); svgEl.setPointerCapture(e.pointerId)
      const s=getScale(imgRef.current)
      const cx=field.x*s+field.w*s/2, cy=field.y*s+field.h*s/2
      const pt=svgPoint(e)
      const state: RotState = {
        fieldId, cx, cy,
        startRotation: field.rotation,
        startPointerAngle: Math.atan2(pt.y-cy, pt.x-cx)*180/Math.PI,
      }
      rotRef.current=state; return
    }

    // ── Resize handle ──
    if (hdl && hdl!=='rotate' && fieldId) {
      const field = activeFields.find(f=>f.id===fieldId); if (!field) return
      e.preventDefault(); svgEl.setPointerCapture(e.pointerId)
      const pt=svgPoint(e)
      dragRef.current = {fieldId, handle:hdl as HandleDir, origBox:field, startX:pt.x, startY:pt.y}
      return
    }

    // ── Click on existing box → select + move (works in BOTH modes) ──
    if (fieldId && activeFields.some(f=>f.id===fieldId)) {
      e.preventDefault(); svgEl.setPointerCapture(e.pointerId)
      const field = activeFields.find(f=>f.id===fieldId)!
      const pt=svgPoint(e)
      dragRef.current = {fieldId, handle:'move', origBox:field, startX:pt.x, startY:pt.y}
      setSelectedId(fieldId)
      return
    }

    // ── Draw new box (empty canvas area) ──
    if (mode==='draw') {
      e.preventDefault(); svgEl.setPointerCapture(e.pointerId)
      const pt=svgPoint(e)
      setDrawing({sx:pt.x, sy:pt.y, ex:pt.x, ey:pt.y})
      setSelectedId(null)
      return
    }

    // Deselect
    setSelectedId(null)
  }, [mode, activeFields, svgPoint])

  // ── Pointer move ──
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (drawing) {
      const pt=svgPoint(e)
      setDrawing(d=>d?{...d, ex:pt.x, ey:pt.y}:null)
      return
    }
    const rot=rotRef.current
    if (rot) {
      const pt=svgPoint(e)
      const cur=Math.atan2(pt.y-rot.cy, pt.x-rot.cx)*180/Math.PI
      const newRot=((rot.startRotation+(cur-rot.startPointerAngle))%360+360)%360
      setActiveFields(fs=>fs.map(f=>f.id===rot.fieldId?{...f,rotation:newRot}:f))
      return
    }
    const drag=dragRef.current; if (!drag) return
    const pt=svgPoint(e)
    const s=getScale(imgRef.current)
    const [ldx,ldy]=drag.handle==='move'
      ? [pt.x-drag.startX, pt.y-drag.startY]
      : toLocal(pt.x-drag.startX, pt.y-drag.startY, drag.origBox.rotation)
    const newBox=applyDrag(drag.origBox, drag.handle, ldx, ldy, s)
    setActiveFields(fs=>fs.map(f=>f.id===drag.fieldId?{...f,...newBox}:f))
  }, [drawing, svgPoint, setActiveFields])

  // ── Pointer up ──
  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    if (rotRef.current) { rotRef.current=null; return }
    if (dragRef.current) { dragRef.current=null; return }
    if (!drawing) return
    const s=getScale(imgRef.current)
    const {sx,sy,ex,ey}=drawing
    const rx=Math.min(sx,ex), ry=Math.min(sy,ey)
    const rw=Math.abs(ex-sx), rh=Math.abs(ey-sy)
    setDrawing(null)
    if (rw*rh<MIN_AREA) return
    const id=`f-${Date.now()}`
    const nb={x:rx/s, y:ry/s, w:rw/s, h:rh/s}
    const field: FieldBox = {
      id, num:nextNum, name:'', fieldType:fieldTypes[0],
      rotation:0, ocrText:mockOCR(nb), ...nb,
    }
    setActiveFields(fs=>[...fs, field])
    setNextNum(n=>n+1)
    setSelectedId(id)
    setTimeout(()=>listRef.current?.querySelector(`[data-card="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest'}), 50)
  }, [drawing, nextNum, fieldTypes, setActiveFields, setNextNum])

  // ── Field helpers ──
  const updateField = (id:string, patch: Partial<FieldBox>) =>
    setActiveFields(fs=>fs.map(f=>f.id===id?{...f,...patch}:f))

  const deleteField = (id:string) => {
    setActiveFields(fs=>fs.filter(f=>f.id!==id))
    if (selectedId===id) setSelectedId(null)
  }

  // ── Keyboard ──
  useEffect(()=>{
    const fn=(e:KeyboardEvent)=>{
      if (e.key==='Escape') { setDrawing(null); setMode('select') }
      if ((e.key==='Delete'||e.key==='Backspace') && selectedId) {
        const tag=(document.activeElement as HTMLElement)?.tagName
        if (tag!=='INPUT'&&tag!=='TEXTAREA'&&tag!=='SELECT') deleteField(selectedId)
      }
    }
    window.addEventListener('keydown',fn)
    return ()=>window.removeEventListener('keydown',fn)
  },[selectedId]) // eslint-disable-line

  // Auto-scroll panel card into view when selection changes (canvas click or draw)
  useEffect(()=>{
    if (!selectedId) return
    const t=setTimeout(()=>{
      listRef.current?.querySelector(`[data-card="${selectedId}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest'})
    },50)
    return ()=>clearTimeout(t)
  },[selectedId])

  const exportTemplate = () => {
    const name=prompt('请输入模板名称：','未命名模板'); if (!name) return
    const a=document.createElement('a')
    a.href=URL.createObjectURL(new Blob([JSON.stringify({
      name,
      参照字段: tab1.map(({num,name,fieldType,rotation,x,y,w,h})=>({num,name,fieldType,rotation,x,y,w,h})),
      识别区:   tab2.map(({num,name,fieldType,rotation,x,y,w,h})=>({num,name,fieldType,rotation,x,y,w,h})),
    },null,2)],{type:'application/json'}))
    a.download=`${name}.json`; a.click(); showToast(`模板「${name}」已导出`)
  }

  // ── Draw preview ──
  const drawPreview = useMemo(()=>{
    if (!drawing) return null
    const {sx,sy,ex,ey}=drawing
    const x=Math.min(sx,ex), y=Math.min(sy,ey), w=Math.abs(ex-sx), h=Math.abs(ey-sy)
    return <rect x={x} y={y} width={w} height={h}
      stroke={activeColor} strokeWidth={1.5} strokeDasharray="5 3"
      fill={`${activeColor}0d`} style={{pointerEvents:'none'}} />
  },[drawing, activeColor])

  // ── Box renderer ──
  function renderBox(f: FieldBox, isActive: boolean) {
    const s=scale
    const [sx,sy,sw,sh]=[f.x*s, f.y*s, f.w*s, f.h*s]
    const cx=sx+sw/2, cy=sy+sh/2
    const isSel = isActive && f.id===selectedId
    const isHov = isActive && f.id===hoveredId && !dragRef.current && !rotRef.current
    const color  = activeColor

    const fill = isSel
      ? `${color}28`
      : isHov
        ? `${color}20`
        : `${color}0d`
    const strokeDash = isSel ? '6 3' : undefined
    const sw2        = isSel ? 2.5 : isHov ? 2 : 1.5

    return (
      <g key={f.id}
        transform={`rotate(${f.rotation},${cx},${cy})`}
        style={{opacity: isActive?1:0.35}}
        onMouseEnter={isActive ? ()=>setHoveredId(f.id) : undefined}
        onMouseLeave={isActive ? ()=>setHoveredId(h=>h===f.id?null:h) : undefined}
      >
        {/* Main box */}
        <rect
          data-fid={isActive?f.id:undefined}
          x={sx} y={sy} width={sw} height={sh}
          stroke={color} strokeWidth={sw2}
          fill={fill}
          strokeDasharray={strokeDash}
          style={{cursor:isActive?'move':'default', pointerEvents:isActive?'all':'none'}}
        />
        {/* Sequence badge */}
        <circle cx={sx+sw-12} cy={sy+12} r={11} fill={color} style={{pointerEvents:'none'}} />
        <text x={sx+sw-12} y={sy+16} textAnchor="middle" fill="#fff"
          fontSize={10} fontFamily="sans-serif" fontWeight="bold"
          style={{pointerEvents:'none',userSelect:'none'}}>
          {f.num}
        </text>
        {/* Rotation angle tag */}
        {isSel && f.rotation!==0 && (
          <text x={sx+4} y={sy-6} fill={color} fontSize={10} fontFamily="sans-serif"
            style={{pointerEvents:'none',userSelect:'none'}}>
            {Math.round(f.rotation)}°
          </text>
        )}
        {/* Controls — selected only */}
        {isSel && <>
          {HANDLE_DIRS.map(dir=>{
            const [hx,hy]=handlePos(f,dir,s)
            return <circle key={dir} data-fid={f.id} data-handle={dir}
              cx={hx} cy={hy} r={5}
              fill="#fff" stroke={color} strokeWidth={1.5}
              style={{cursor:HANDLE_CURSORS[dir],pointerEvents:'all'}} />
          })}
          {/* Rotation handle */}
          <line x1={cx} y1={sy} x2={cx} y2={sy-28}
            stroke={color} strokeWidth={1.5} strokeDasharray="3 2"
            style={{pointerEvents:'none'}} />
          <circle data-fid={f.id} data-handle="rotate"
            cx={cx} cy={sy-28} r={7}
            fill="#fff" stroke={color} strokeWidth={1.5}
            style={{cursor:'grab',pointerEvents:'all'}} />
          <text x={cx} y={sy-24} textAnchor="middle" fontSize={9} fill={color}
            fontFamily="sans-serif" style={{pointerEvents:'none',userSelect:'none'}}>↺</text>
        </>}
      </g>
    )
  }

  // ── Right panel field card ──
  function renderCard(f: FieldBox) {
    const isSel = f.id===selectedId
    const isHov = f.id===hoveredId && !isSel
    const isEmpty = f.name.trim()===''
    const color = activeColor
    return (
      <div key={f.id} data-card={f.id}
        onClick={()=>setSelectedId(isSel?null:f.id)}
        onMouseEnter={()=>setHoveredId(f.id)}
        onMouseLeave={()=>setHoveredId(h=>h===f.id?null:h)}
        style={{
          margin:'0 10px 8px', borderRadius:6, cursor:'pointer',
          border: isSel?`1.5px solid ${color}`:isHov?`1.5px solid ${color}80`:'1px solid #e8e8e8',
          background: isSel?`${color}08`:isHov?`${color}05`:'#fff',
          boxShadow: isSel?`0 0 0 3px ${color}15`:isHov?`0 2px 8px ${color}20`:'none',
          transition:'border .15s, box-shadow .15s, background .15s',
          overflow:'hidden',
        }}
      >
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',padding:'8px 10px 6px',gap:6}}>
          <span style={{width:10,height:10,borderRadius:2,background:color,flexShrink:0}} />
          <span style={{fontWeight:600,color:'#262626',flex:1,fontSize:13}}>
            {tabLabel}{f.num}
          </span>
          {f.rotation!==0&&<span style={{fontSize:10,color,border:`1px solid ${color}`,borderRadius:3,padding:'0 4px'}}>{Math.round(f.rotation)}°</span>}
          <button
            onClick={e=>{e.stopPropagation();deleteField(f.id)}}
            style={{border:'none',background:'none',cursor:'pointer',color:'#bbb',fontSize:16,lineHeight:1,padding:'0 2px'}}
          >×</button>
        </div>

        {/* Fields */}
        <div onClick={e=>e.stopPropagation()} style={{padding:'0 10px 10px'}}>
          {/* 字段名称 */}
          <div style={{marginBottom:6}}>
            <label style={labelStyle}>字段名称</label>
            <input
              value={f.name}
              onChange={e=>updateField(f.id,{name:e.target.value})}
              placeholder="此处最多输入20个字符（中/英）"
              maxLength={20}
              style={{...inputStyle, borderColor: isEmpty?'#ffbb96':'#d9d9d9'}}
            />
            {isEmpty && <div style={{fontSize:11,color:'#fa541c',marginTop:3}}>识别字段名称不能为空</div>}
          </div>

          {/* 字段类型 */}
          <div style={{marginBottom:6}}>
            <label style={labelStyle}>字段类型</label>
            <select
              value={f.fieldType}
              onChange={e=>updateField(f.id,{fieldType:e.target.value})}
              style={selectStyle}
            >
              {fieldTypes.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>

          {/* 识别结果 */}
          <div style={{marginBottom: isSel?8:0}}>
            <label style={labelStyle}>识别结果</label>
            <div style={{fontSize:12,color:f.ocrText?'#1a1a1a':'#bbb',lineHeight:1.5,wordBreak:'break-all'}}>
              {f.ocrText||'（未识别到内容）'}
            </div>
            {!f.ocrText&&<div style={{fontSize:11,color:'#fa8c16',marginTop:3}}>请调整选框范围确保框内有有效内容</div>}
          </div>

          {/* 坐标（仅选中时显示） */}
          {isSel&&(
            <div style={{
              marginTop:8,padding:'8px 10px',background:'#f5f5f5',borderRadius:4,
              borderTop:`1px solid ${color}20`,
            }}>
              <div style={{fontSize:11,color:'#8c8c8c',display:'flex',gap:12,flexWrap:'wrap'}}>
                <span><b style={{color:'#595959'}}>X:</b> {Math.round(f.x)}px</span>
                <span><b style={{color:'#595959'}}>Y:</b> {Math.round(f.y)}px</span>
                <span><b style={{color:'#595959'}}>W:</b> {Math.round(f.w)}px</span>
                <span><b style={{color:'#595959'}}>H:</b> {Math.round(f.h)}px</span>
              </div>
              {/* Rotation slider */}
              <div style={{marginTop:8}}>
                <div style={{fontSize:11,color:'#8c8c8c',marginBottom:4}}>旋转角度</div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <input type="range" min={0} max={359} step={1}
                    value={Math.round(f.rotation)}
                    onChange={e=>updateField(f.id,{rotation:+e.target.value})}
                    style={{flex:1,accentColor:color}} />
                  <input type="number" min={0} max={359}
                    value={Math.round(f.rotation)}
                    onChange={e=>updateField(f.id,{rotation:((+e.target.value)%360+360)%360})}
                    style={{width:48,padding:'3px 5px',border:'1px solid #d9d9d9',borderRadius:4,fontSize:12,textAlign:'right'}} />
                  <span style={{fontSize:11,color:'#888'}}>°</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const zoomIn    = ()=>setCanvasZoom(z=>Math.min(3,  +(z+0.25).toFixed(2)))
  const zoomOut   = ()=>setCanvasZoom(z=>Math.max(0.3,+(z-0.25).toFixed(2)))
  const zoomReset = ()=>setCanvasZoom(1)

  // ──────────────────── Render ────────────────────
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',fontFamily:'sans-serif',fontSize:13}}>

      {/* ── Top bar ── */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',borderBottom:'1px solid #e8e8e8',background:'#fff',flexShrink:0}}>
        <button onClick={()=>fileRef.current?.click()} style={tbtn('#fff','#595959')}>📁 上传图片</button>
        <div style={sep} />
        <button onClick={()=>setMode('select')} style={tbtn(mode==='select'?'#e6f7ff':'#fff', mode==='select'?activeColor:'#595959', mode==='select'?`1px solid ${activeColor}50`:undefined)}>↖ 选择</button>
        <button onClick={()=>{setMode('draw');setSelectedId(null)}} style={tbtn(mode==='draw'?`${activeColor}18`:'#fff', mode==='draw'?activeColor:'#595959', mode==='draw'?`1px solid ${activeColor}50`:undefined)}>□+ 画框</button>
        {selectedId&&<button onClick={()=>deleteField(selectedId)} style={tbtn('#fff5f5','#ff4d4f','1px solid #ffccc7')}>🗑 删除</button>}
        <div style={sep} />
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <button onClick={zoomOut}  style={tbtn('#fff','#595959')} title="缩小">−</button>
          <button onClick={zoomReset} style={{...tbtn('#fff',activeColor),minWidth:52,justifyContent:'center'}}>{Math.round(canvasZoom*100)}%</button>
          <button onClick={zoomIn}   style={tbtn('#fff','#595959')} title="放大">+</button>
        </div>
        <div style={{flex:1}} />
        <button onClick={exportTemplate} style={{...tbtn('#1890ff','#fff'),padding:'5px 16px'}}>💾 导出模板</button>
        <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleFileChange} />
      </div>

      {/* ── Body ── */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* ── Canvas ── */}
        <div ref={canvasRef} style={{flex:1,overflow:'auto',background:'#f0f2f5',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:24}}>
          <div style={{position:'relative',display:'inline-block',boxShadow:'0 2px 16px rgba(0,0,0,.14)'}}>
            {imgUrl&&(
              <img ref={imgRef} src={imgUrl} alt="" draggable={false}
                style={{display:'block',width:BASE_W*canvasZoom}}
                onLoad={()=>setImgLoaded(true)} />
            )}
            {imgLoaded&&(
              <svg ref={svgRef}
                style={{position:'absolute',inset:0,width:'100%',height:'100%',overflow:'visible',
                  cursor:mode==='draw'?'crosshair':'default'}}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                {/* Active boxes — only current tab shown */}
                {activeFields.map(f=>renderBox(f, true))}
                {drawPreview}
              </svg>
            )}
            {!imgLoaded&&imgUrl&&(
              <div style={{width:BASE_W*canvasZoom,height:420,display:'flex',alignItems:'center',justifyContent:'center',color:'#bbb',background:'#f8f8f8'}}>加载中...</div>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div style={{width:320,borderLeft:'1px solid #e8e8e8',display:'flex',flexDirection:'column',background:'#fff',flexShrink:0,overflow:'hidden'}}>

          {/* Step breadcrumb */}
          <div style={{display:'flex',alignItems:'center',borderBottom:'1px solid #e8e8e8',flexShrink:0}}>
            <StepTab active={step===1} color={TAB_COLOR[1]} onClick={()=>switchTab(1)}>第1步：框选参照字段</StepTab>
            <span style={{color:'#d9d9d9',fontSize:16,flexShrink:0}}>›</span>
            <StepTab active={step===2} color={TAB_COLOR[2]} onClick={()=>switchTab(2)}>第2步：框选识别区</StepTab>
          </div>

          {/* Warning banner */}
          {step===2 && tab1.length<4 && (
            <div style={{background:'#fff7e6',borderBottom:'1px solid #ffd591',padding:'8px 12px',fontSize:12,color:'#d46b08',flexShrink:0}}>
              ⚠ 至少设置4个参照字段（当前 {tab1.length} 个）
            </div>
          )}

          {/* Field list */}
          <div ref={listRef} style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
            {activeFields.length===0&&(
              <div style={{textAlign:'center',color:'#bbb',padding:'40px 16px'}}>
                <div style={{fontSize:36,marginBottom:10}}>⬜</div>
                <div style={{fontSize:12,lineHeight:1.8}}>
                  切换「画框」模式<br/>在图片上拖拽框选{tabLabel}区域
                </div>
              </div>
            )}
            {activeFields.map(f=>renderCard(f))}
          </div>

          {/* Add field button */}
          <div style={{padding:10,borderTop:'1px solid #f0f0f0',flexShrink:0}}>
            <button
              onClick={()=>{setMode('draw');setSelectedId(null)}}
              style={{
                width:'100%',padding:'8px 0',
                border:`1px dashed ${mode==='draw'?activeColor:'#d9d9d9'}`,
                borderRadius:6,fontSize:13,cursor:'pointer',
                background:mode==='draw'?`${activeColor}10`:'#fafafa',
                color:mode==='draw'?activeColor:'#595959',
                display:'flex',alignItems:'center',justifyContent:'center',gap:4,
                transition:'all .15s',
              }}
            >
              <span style={{fontSize:16,lineHeight:1}}>+</span>
              {mode==='draw'?`在图片上拖拽画框...`:`添加${tabLabel}`}
            </button>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{padding:'4px 14px',borderTop:'1px solid #f0f0f0',background:'#fafafa',fontSize:11,color:'#aaa',flexShrink:0}}>
        {mode==='draw'
          ? `🖊 拖拽画框（${tabLabel}） · 已有框上单击可直接拖动 · ESC 取消`
          : selectedField
            ? `已选中 ${tabLabel}${selectedField.num} · 拖动↺旋转 · Delete 删除 · Ctrl+滚轮 缩放`
            : `共 ${activeFields.length} 个${tabLabel} · 点击已有框选中 · Ctrl+滚轮 缩放画布`}
      </div>

      {/* Toast */}
      {toast&&(
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',
          background:'rgba(0,0,0,.72)',color:'#fff',padding:'8px 20px',
          borderRadius:20,fontSize:13,zIndex:9999,pointerEvents:'none'}}>
          {toast}
        </div>
      )}
    </div>
  )
}

// ──────────────────── Sub-components ────────────────────

const StepTab: React.FC<{active:boolean;color:string;onClick:()=>void;children:React.ReactNode}> = ({active,color,onClick,children})=>(
  <div onClick={onClick} style={{
    flex:1,padding:'10px 6px',textAlign:'center',cursor:'pointer',
    fontSize:11.5,fontWeight:active?600:400,
    color:active?color:'#8c8c8c',
    borderBottom:active?`2px solid ${color}`:'2px solid transparent',
    background:active?`${color}08`:'transparent',
    lineHeight:1.3,transition:'all .15s',
  }}>
    {children}
  </div>
)

// ──────────────────── Styles ────────────────────

const sep: React.CSSProperties = {width:1,height:20,background:'#e8e8e8'}

function tbtn(bg:string, color:string, border?:string): React.CSSProperties {
  return {padding:'5px 10px',border:border??'1px solid #d9d9d9',borderRadius:4,background:bg,color,fontSize:12,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}
}

const labelStyle: React.CSSProperties = {
  display:'block',fontSize:11,color:'#8c8c8c',marginBottom:3,
}

const inputStyle: React.CSSProperties = {
  width:'100%',padding:'5px 8px',border:'1px solid #d9d9d9',borderRadius:4,
  fontSize:12,outline:'none',boxSizing:'border-box',background:'#fff',
}

const selectStyle: React.CSSProperties = {
  width:'100%',padding:'5px 6px',border:'1px solid #d9d9d9',
  borderRadius:4,fontSize:12,background:'#fff',
}
