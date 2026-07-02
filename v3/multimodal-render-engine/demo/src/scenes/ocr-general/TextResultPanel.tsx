import React, { useCallback, useRef, useEffect } from 'react'
import type { Annotation } from '../../core/types'
import { CATEGORY_COLOR } from '../../layers/SVGLayer'

const CIRCLED = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳']
function getCircled(i: number) { return CIRCLED[i] ?? `(${i+1})` }

interface TextResultPanelProps {
  regions: Annotation[]
  activeId: string | null
  onHover: (id: string | null) => void
  onCopyAll: () => void
}

export const TextResultPanel: React.FC<TextResultPanelProps> = ({ regions, activeId, onHover, onCopyAll }) => {
  const [copiedId, setCopiedId] = React.useState<string|null>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  // Auto-scroll active item into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior:'smooth', block:'nearest' })
  }, [activeId])

  const copyLine = useCallback(async (text:string, id:string) => {
    try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(()=>setCopiedId(null),1500) }
    catch { /* no-op */ }
  }, [])

  const color = CATEGORY_COLOR['ocr-region']

  // Check if we have structured (formatted) data
  const hasStructured = regions.some(r => r.meta?.role)

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#fafafa',borderLeft:'1px solid #f0f0f0',overflow:'hidden'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderBottom:'1px solid #f0f0f0',background:'#fff',flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:600,color:'#333'}}>
          识别结果
          {regions.length > 0 && <span style={{marginLeft:8,fontSize:12,fontWeight:400,color:'#999'}}>共 {regions.filter(r=>r.meta?.role!=='separator').length} 处</span>}
        </span>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {hasStructured && (
            <span style={{fontSize:11,background:'#f6ffed',color:'#52c41a',padding:'2px 6px',borderRadius:8,border:'1px solid #b7eb8f'}}>保留原格式</span>
          )}
          <button onClick={onCopyAll} style={{padding:'4px 12px',border:'1px solid #d9d9d9',borderRadius:4,background:'#fff',color:'#555',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
            <span>⎘</span>复制全文
          </button>
        </div>
      </div>

      {/* Result list */}
      <div style={{flex:1,overflowY:'auto',padding:hasStructured?'12px 0':'8px 0'}}>
        {regions.length === 0 && (
          <div style={{textAlign:'center',color:'#bbb',fontSize:13,padding:'60px 20px'}}>上传图片后将显示识别结果</div>
        )}

        {hasStructured ? (
          // ── Formatted layout ──
          <div style={{padding:'0 16px'}}>
            {regions.map((ann, idx) => {
              const role = ann.meta?.role as string|undefined
              const isActive = ann.id === activeId

              if (role === 'separator') {
                return <hr key={ann.id} style={{border:'none',borderTop:'1px solid #f0f0f0',margin:'10px 0'}} />
              }

              if (role === 'title') {
                return (
                  <div key={ann.id}
                    ref={isActive ? activeRef : undefined}
                    onMouseEnter={()=>onHover(ann.id)} onMouseLeave={()=>onHover(null)}
                    style={{
                      textAlign:'center',fontWeight:700,fontSize:17,color:'#1a1a1a',
                      padding:'14px 0 8px',borderBottom:'2px solid #f0f0f0',marginBottom:8,
                      background:isActive?'#e6f7ff':'transparent',
                      borderRadius:4,transition:'background .15s',cursor:'default',
                    }}
                  >{ann.content.original}</div>
                )
              }

              if (role === 'subtitle') {
                return (
                  <div key={ann.id}
                    ref={isActive ? activeRef : undefined}
                    onMouseEnter={()=>onHover(ann.id)} onMouseLeave={()=>onHover(null)}
                    style={{
                      fontWeight:600,fontSize:14,color:'#262626',padding:'8px 0 4px',
                      background:isActive?'#e6f7ff':'transparent',
                      borderLeft:isActive?`3px solid ${color}`:'3px solid transparent',
                      paddingLeft:isActive?8:0,borderRadius:2,
                      transition:'all .15s',cursor:'default',
                    }}
                  >{ann.content.original}</div>
                )
              }

              if (role === 'field') {
                const label = ann.meta?.label as string|undefined
                const conf  = ann.content.confidence ?? 1
                const confColor = conf>=0.9?'#52c41a':conf>=0.7?'#faad14':'#ff4d4f'
                return (
                  <div key={ann.id}
                    ref={isActive ? activeRef : undefined}
                    onMouseEnter={()=>onHover(ann.id)} onMouseLeave={()=>onHover(null)}
                    style={{
                      display:'flex',alignItems:'baseline',gap:6,
                      padding:'5px 8px',borderRadius:4,
                      background:isActive?`${color}12`:'transparent',
                      borderLeft:isActive?`3px solid ${color}`:'3px solid transparent',
                      transition:'all .15s',cursor:'default',marginBottom:2,
                    }}
                  >
                    {label && <span style={{fontSize:12,color:'#888',flexShrink:0,minWidth:90}}>{label}：</span>}
                    <span style={{fontSize:13,color:'#1a1a1a',flex:1,wordBreak:'break-all'}}>{ann.content.original}</span>
                    <span style={{width:6,height:6,borderRadius:'50%',background:confColor,flexShrink:0,marginTop:2}} title={`${Math.round(conf*100)}%`} />
                    <button
                      onClick={()=>copyLine(ann.content.original,ann.id)}
                      style={{
                        border:'none',background:'none',cursor:'pointer',color:copiedId===ann.id?'#52c41a':'#bbb',
                        fontSize:12,padding:'0 2px',opacity:isActive?1:0,transition:'opacity .15s',flexShrink:0,
                      }}
                    >{copiedId===ann.id?'✓':'⎘'}</button>
                  </div>
                )
              }

              // Default (body text)
              const confidence = ann.content.confidence ?? 1
              const isCopied = copiedId === ann.id
              return (
                <div key={ann.id}
                  ref={isActive ? activeRef : undefined}
                  onMouseEnter={()=>onHover(ann.id)} onMouseLeave={()=>onHover(null)}
                  style={{
                    display:'flex',alignItems:'flex-start',gap:10,padding:'7px 8px',marginBottom:2,
                    background:isActive?`${color}12`:'transparent',
                    borderLeft:isActive?`3px solid ${color}`:'3px solid transparent',
                    borderRadius:4,transition:'all .15s',cursor:'default',
                  }}
                >
                  <span style={{flexShrink:0,fontSize:15,color:isActive?color:'#ccc',lineHeight:1.4,fontWeight:600,minWidth:22}}>{getCircled(idx)}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,color:'#333',lineHeight:1.6,wordBreak:'break-all',marginBottom:3}}>{ann.content.original}</div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{flex:1,height:3,background:'#f0f0f0',borderRadius:2,overflow:'hidden'}}>
                        <div style={{width:`${confidence*100}%`,height:'100%',borderRadius:2,
                          background:confidence>=0.9?'#52c41a':confidence>=0.7?'#faad14':'#ff4d4f',
                          transition:'width .3s'}} />
                      </div>
                      <span style={{fontSize:11,color:'#aaa',flexShrink:0,minWidth:32,textAlign:'right'}}>{Math.round(confidence*100)}%</span>
                    </div>
                  </div>
                  <button onClick={()=>copyLine(ann.content.original,ann.id)}
                    style={{flexShrink:0,padding:'2px 6px',border:'1px solid #e8e8e8',borderRadius:3,background:'#fff',
                      color:isCopied?'#52c41a':'#aaa',fontSize:12,cursor:'pointer',
                      opacity:isActive?1:0,transition:'opacity .15s',alignSelf:'center'}}>
                    {isCopied?'✓':'⎘'}
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          // ── Flat list layout (no meta.role) ──
          regions.map((ann, index) => {
            const isActive = ann.id === activeId
            const confidence = ann.content.confidence ?? 1
            const isLowConf = confidence < 0.7
            const isCopied = copiedId === ann.id
            return (
              <div key={ann.id}
                ref={isActive ? activeRef : undefined}
                onMouseEnter={()=>onHover(ann.id)} onMouseLeave={()=>onHover(null)}
                style={{
                  display:'flex',alignItems:'flex-start',gap:10,padding:'8px 16px',margin:'2px 0',
                  background:isActive?`${color}12`:'transparent',
                  borderLeft:isActive?`3px solid ${color}`:'3px solid transparent',
                  transition:'background .15s',cursor:'default',position:'relative',
                }}
              >
                <span style={{flexShrink:0,fontSize:16,color:isActive?color:'#aaa',lineHeight:1.4,fontWeight:600,minWidth:22}}>{getCircled(index)}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:isLowConf?'#bbb':'#333',lineHeight:1.6,wordBreak:'break-all',marginBottom:4}}>{ann.content.original||'(空)'}</div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <div style={{flex:1,height:3,background:'#f0f0f0',borderRadius:2,overflow:'hidden'}}>
                      <div style={{width:`${confidence*100}%`,height:'100%',
                        background:confidence>=0.9?'#52c41a':confidence>=0.7?'#faad14':'#ff4d4f',
                        borderRadius:2,transition:'width .3s'}} />
                    </div>
                    <span style={{fontSize:11,color:'#aaa',flexShrink:0,minWidth:32,textAlign:'right'}}>{Math.round(confidence*100)}%</span>
                  </div>
                </div>
                <button onClick={()=>copyLine(ann.content.original,ann.id)}
                  style={{flexShrink:0,padding:'2px 6px',border:'1px solid #e8e8e8',borderRadius:3,background:'#fff',
                    color:isCopied?'#52c41a':'#aaa',fontSize:12,cursor:'pointer',
                    opacity:isActive?1:0,transition:'opacity .15s',alignSelf:'center'}}>
                  {isCopied?'✓':'⎘'}
                </button>
              </div>
            )
          })
        )}
      </div>

      <style>{`div:hover > button { opacity: 1 !important; }`}</style>
    </div>
  )
}
