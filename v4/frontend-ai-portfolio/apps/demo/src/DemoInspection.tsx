/**
 * 智检标注 Demo — 设计图精确复刻
 *
 * 布局: 左侧白底文档 + 波浪线标注，右侧 280px 错误面板
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from '@portfolio/multimodal-render-engine/components/Toast';
import { CATEGORY_COLOR, WAVY_CLASSES } from '@portfolio/multimodal-render-engine/core/types';
import type { AnnotationType } from '@portfolio/multimodal-render-engine/core/types';

// 错误数据 (offset 精确对应文本)
interface Err { id: string; from: number; to: number; original: string; suggestion: string; type: AnnotationType; status: 'active' | 'accepted' | 'ignored' }

const TEXT = 'Artificial intelligence is transforming the way we build software. From inteligent code completion\nto automated testing, AI tools are becoming indispesible for modern developers.\n\nHowever, there are still many challanges to overcome. The modle\'s output is not always acurate,\nand we must carefully review AI-generated suggestions before accepting them. Misuse of AI tools\ncan lead to security vulnerabilities and quality issues.\n\nMultimodal AI systems can proces text, images, and audio simultaneously, opening up\nnew possibilties for human-computer interaction. These systems are particularly valuable\nin fields like healthcare, education, and legal services.\n\nThe future of AI develpment lies in creating systems that are not only powerful\nbut also transparant and accountable. Ethical considerations must be at the forefront\nof our innovation efforts.';

const INIT: Err[] = [
  { id:'e0', from:72, to:82, original:'inteligent', suggestion:'intelligent', type:'error-spelling', status:'active' },
  { id:'e1', from:143, to:155, original:'indispesible', suggestion:'indispensable', type:'error-spelling', status:'active' },
  { id:'e2', from:210, to:220, original:'challanges', suggestion:'challenges', type:'error-spelling', status:'active' },
  { id:'e3', from:238, to:243, original:'modle', suggestion:'model', type:'error-spelling', status:'active' },
  { id:'e4', from:267, to:274, original:'acurate', suggestion:'accurate', type:'error-spelling', status:'active' },
  { id:'e5', from:353, to:359, original:'Misuse', suggestion:'The misuse', type:'error-grammar', status:'active' },
  { id:'e6', from:456, to:462, original:'proces', suggestion:'process', type:'error-spelling', status:'active' },
  { id:'e7', from:518, to:530, original:'possibilties', suggestion:'possibilities', type:'error-spelling', status:'active' },
  { id:'e8', from:679, to:689, original:'develpment', suggestion:'development', type:'error-spelling', status:'active' },
  { id:'e9', from:751, to:762, original:'transparant', suggestion:'transparent', type:'error-spelling', status:'active' },
  { id:'e10', from:780, to:787, original:'Ethical', suggestion:'ethical', type:'error-grammar', status:'active' },
];

const TYPE_LABEL: Record<string,string> = { 'error-spelling':'拼写','error-grammar':'语法','error-punctuation':'标点','error-number':'数字','error-political':'涉政', };
const FILTERS = ['all','error-spelling','error-grammar','error-punctuation','error-number','error-political'];

export function DemoInspection() {
  const [errors, setErrors] = useState<Err[]>(INIT);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => filter==='all' ? errors : errors.filter(e=>e.type===filter), [errors,filter]);
  const counts: Record<string,number> = useMemo(() => { const m:Record<string,number>={}; errors.filter(e=>e.status==='active').forEach(e=>{m[e.type]=(m[e.type]||0)+1}); return m; }, [errors]);

  const accept = useCallback((id:string) => {
    const e = errors.find(x=>x.id===id);
    setErrors(prev=>prev.map(x=>x.id===id?{...x,status:'accepted' as const}:x));
    toast.success(`已接受: "${e?.original}" → "${e?.suggestion}"`);
  },[errors]);
  const ignore = useCallback((id:string) => { setErrors(prev=>prev.map(x=>x.id===id?{...x,status:'ignored' as const}:x)); },[]);

  const focusNext = useCallback(() => { const a=filtered.filter(e=>e.status==='active'); if(!a.length)return; const i=activeId?a.findIndex(e=>e.id===activeId):-1; setActiveId(a[(i+1)%a.length].id); },[filtered,activeId]);
  const focusPrev = useCallback(() => { const a=filtered.filter(e=>e.status==='active'); if(!a.length)return; const i=activeId?a.findIndex(e=>e.id===activeId):a.length; setActiveId(a[(i-1+a.length)%a.length].id); },[filtered,activeId]);

  useEffect(() => { const h=(e:KeyboardEvent)=>{ if(e.key==='F8'){e.preventDefault();e.shiftKey?focusPrev():focusNext();} }; addEventListener('keydown',h); return ()=>removeEventListener('keydown',h); },[focusNext,focusPrev]);

  // 高亮文本
  const html = useMemo(() => {
    const segs:React.ReactNode[]=[]; let last=0;
    const sorted=[...errors].sort((a,b)=>a.from-b.from);
    for(const e of sorted){
      if(e.from>last) segs.push(<span key={`t${last}`}>{TEXT.slice(last,e.from)}</span>);
      const cls=e.status==='ignored'?'wavy-muted':(WAVY_CLASSES[e.type]??'wavy-red');
      const c=CATEGORY_COLOR[e.type];
      segs.push(<span key={e.id} className={cls} title={e.suggestion?`${e.original} → ${e.suggestion}`:e.original}
        onClick={()=>setActiveId(e.id)}
        style={{background:activeId===e.id?`${c}20`:'transparent',borderRadius:2,padding:'0 1px',cursor:'pointer',outline:activeId===e.id?`2px solid ${c}40`:'none'}}>
        {TEXT.slice(e.from,e.to)}</span>);
      last=e.to;
    }
    if(last<TEXT.length) segs.push(<span key="tend">{TEXT.slice(last)}</span>);
    return segs;
  },[errors,activeId]);

  const activeCount = errors.filter(e=>e.status==='active').length;

  return (
    <div style={{display:'flex',height:'100%',background:'#f5f5f5'}}>
      {/* 文档区 */}
      <div style={{flex:1,overflow:'auto',display:'flex',justifyContent:'center',padding:'24px 0'}}>
        <div style={{width:680,background:'#fff',borderRadius:4,boxShadow:'0 1px 4px rgba(0,0,0,0.08)',padding:'48px 44px',fontFamily:'"Georgia",serif',fontSize:15,lineHeight:2.2,color:'#1a1a1a',whiteSpace:'pre-wrap'}}>
          {html}
        </div>
      </div>
      {/* 错误面板 */}
      <div style={{width:280,borderLeft:'1px solid #e8e8e8',display:'flex',flexDirection:'column',background:'#fff',fontSize:13,fontFamily:'system-ui,sans-serif'}}>
        <div style={{padding:'12px 14px',borderBottom:'1px solid #f0f0f0',fontWeight:500,fontSize:14,flexShrink:0}}>
          <span role="status" aria-live="polite">共检测到 {activeCount} 个错误</span>
        </div>
        <div style={{display:'flex',gap:4,padding:'8px 10px',borderBottom:'1px solid #f0f0f0',flexWrap:'wrap',flexShrink:0}}>
          {FILTERS.map(t=>{const c=t==='all'?activeCount:(counts[t]||0);const color=t==='all'?'#666':CATEGORY_COLOR[t as AnnotationType];return(
            <button key={t} onClick={()=>setFilter(t)} style={{padding:'2px 8px',borderRadius:10,fontSize:11,border:filter===t?`1px solid ${color}`:'1px solid #e8e8e8',background:filter===t?`${color}12`:'#fff',color:filter===t?color:'#888',cursor:'pointer'}}>{t==='all'?'全部':TYPE_LABEL[t]} {c}</button>
          );})}
        </div>
        <div style={{flex:1,overflow:'auto'}}>
          <ul style={{margin:0,padding:'8px 6px',listStyle:'none'}}>
            {filtered.map(e=>{const color=CATEGORY_COLOR[e.type];const isActive=activeId===e.id;const muted=e.status==='ignored';return(
              <li key={e.id} tabIndex={0} onClick={()=>setActiveId(e.id)} onKeyDown={ev=>{if(ev.key==='Enter')setActiveId(e.id);}} style={{padding:'10px 10px',marginBottom:4,borderRadius:6,border:isActive?`2px solid ${color}`:'1px solid #f0f0f0',background:isActive?`${color}08`:'#fff',opacity:muted?0.5:1,cursor:'pointer',outline:'none'}}>
                <div style={{fontWeight:500,marginBottom:4,textDecoration:muted?'none':'underline',textDecorationColor:color,textDecorationStyle:'wavy',textUnderlineOffset:'3px',fontSize:13}}>{e.original}</div>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                  <span style={{fontSize:10,padding:'0 6px',borderRadius:3,background:`${color}20`,color,fontWeight:500}}>{TYPE_LABEL[e.type]}</span>
                  {e.suggestion&&<span style={{color:'#999',fontSize:12}}>→ {e.suggestion}</span>}
                </div>
                {e.status!=='ignored'&&(
                  <div style={{display:'flex',gap:6}}>
                    {e.suggestion&&<button onClick={ev=>{ev.stopPropagation();accept(e.id);}} style={{padding:'2px 10px',borderRadius:3,border:'none',background:'#1890ff',color:'#fff',cursor:'pointer',fontSize:11}}>接受</button>}
                    <button onClick={ev=>{ev.stopPropagation();ignore(e.id);}} style={{padding:'2px 10px',borderRadius:3,border:'1px solid #d9d9d9',background:'#fff',color:'#666',cursor:'pointer',fontSize:11}}>忽略</button>
                  </div>
                )}
              </li>
            );})}
            {filtered.length===0&&<div style={{textAlign:'center',padding:30,color:'#999'}}>未发现错误</div>}
          </ul>
        </div>
        <div style={{padding:'6px 10px',borderTop:'1px solid #f0f0f0',fontSize:11,color:'#999',flexShrink:0}}>F8 下一个 · Shift+F8 上一个</div>
      </div>
    </div>
  );
}