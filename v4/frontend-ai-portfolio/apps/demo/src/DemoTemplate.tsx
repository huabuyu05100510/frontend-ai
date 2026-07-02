/**
 * OCR 自定义模板 Demo — 按设计图 OCR框选.png 精确实现
 *
 * 特性:
 * - 左侧: 图片编辑区 (支持缩放/旋转)
 * - 右侧: 字段配置列表 (列表项点击 → 左侧对应框高亮)
 * - 工具栏: 选择/画框/删除 + 缩放旋转控制
 * - 画框交互: 拖拽绘制, 自动进入字段配置
 */
import React, { useState, useCallback, useRef } from 'react';
import { toast } from '@portfolio/multimodal-render-engine/components/Toast';
import { useAutoSave } from '@portfolio/multimodal-render-engine/hooks/useAutoSave';
import type { FieldConfig, Point } from '@portfolio/multimodal-render-engine/core/types';

// ---- 类型 ----
interface FieldBox {
  id: string; label: string; dataType: string; required: boolean;
  x: number; y: number; w: number; h: number;
}

// ---- 常量 ----
const IMG_W = 800, IMG_H = 360;

export function DemoTemplate() {
  // 缩放/旋转
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // 字段列表
  const [fields, setFields] = useState<FieldBox[]>([]);

  // 编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'draw' | 'delete'>('select');
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [dirty, setDirty] = useState(false);
  const { saveDraft, clearDraft } = useAutoSave(() => fields, dirty);

  // 编辑面板数据
  const [editLabel, setEditLabel] = useState('');
  const [editType, setEditType] = useState('text');
  const [editRequired, setEditRequired] = useState(false);
  const [editRegex, setEditRegex] = useState('');

  // 选中字段
  const selected = fields.find(f => f.id === editingId);

  // ---- 坐标转换 ----
  const toRel = useCallback((e: React.MouseEvent): Point => {
    const el = (e.currentTarget as HTMLElement).querySelector('[data-canvas]');
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.x) / zoom, y: (e.clientY - r.y) / zoom };
  }, [zoom]);

  // ---- 画布操作 ----
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'select') return;
    const pt = toRel(e);
    for (let i = fields.length - 1; i >= 0; i--) {
      const f = fields[i];
      if (pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + f.h) {
        setEditingId(f.id);
        setEditLabel(f.label);
        setEditType(f.dataType);
        setEditRequired(f.required);
        return;
      }
    }
    setEditingId(null);
  }, [activeTool, fields, toRel]);

  const handleMDown = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'draw') return;
    setDrawStart(toRel(e));
  }, [activeTool, toRel]);

  const handleMMove = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'draw' || !drawStart) return;
    const cur = toRel(e);
    setPreview({ x: Math.min(drawStart.x, cur.x), y: Math.min(drawStart.y, cur.y), w: Math.abs(cur.x - drawStart.x), h: Math.abs(cur.y - drawStart.y) });
  }, [activeTool, drawStart, toRel]);

  const handleMUp = useCallback(() => {
    if (activeTool !== 'draw' || !preview) return;
    setDrawStart(null); setPreview(null);
    if (preview.w * preview.h < 400) { toast.warning('区域过小，请重新绘制'); return; }
    const id = `f_${Date.now()}`;
    setFields(prev => [...prev, { id, label: '', dataType: 'text', required: false, ...preview }]);
    setEditingId(id); setEditLabel(''); setEditType('text'); setEditRequired(false); setEditRegex('');
    setActiveTool('select'); setDirty(true);
  }, [activeTool, preview]);

  // ---- 字段操作 ----
  const saveField = useCallback(() => {
    if (!editingId) return;
    const name = editLabel.trim();
    if (!name) { toast.warning('请输入字段名'); return; }
    setFields(prev => prev.map(f => f.id === editingId ? { ...f, label: name, dataType: editType, required: editRequired } : f));
    setDirty(true); saveDraft();
    toast.success('字段已保存');
  }, [editingId, editLabel, editType, editRequired, saveDraft]);

  const deleteField = useCallback(() => {
    if (!editingId) return;
    if (!confirm(`确认删除字段「${selected?.label || '未命名'}」？`)) return;
    setFields(prev => prev.filter(f => f.id !== editingId));
    setEditingId(null); setDirty(true);
  }, [editingId, selected]);

  const handleFieldClick = useCallback((id: string) => {
    const f = fields.find(x => x.id === id);
    if (f) {
      setEditingId(id); setEditLabel(f.label); setEditType(f.dataType); setEditRequired(f.required);
    }
  }, [fields]);

  // ---- 缩放旋转 ----
  const zoomIn = () => setZoom(z => Math.min(z + 0.2, 3));
  const zoomOut = () => setZoom(z => Math.max(z - 0.2, 0.4));
  const rotateCW = () => setRotation(r => r + 90);
  const rotateCCW = () => setRotation(r => r - 90);

  // ---- 模板操作 ----
  const saveTpl = useCallback(() => {
    const n = prompt('模板名称：');
    if (!n) return;
    try {
      // 保存到 localStorage
      localStorage.setItem(`ocr_template_${n}`, JSON.stringify({ name: n, fields, createdAt: Date.now() }));
      clearDraft(); setDirty(false);
      toast.success(`模板「${n}」已保存`);
    } catch { toast.error('保存失败'); }
  }, [fields, clearDraft]);

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'system-ui, sans-serif', background: '#f5f5f5' }}>
      {/* ========== 左侧编辑区 ========== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 16px',
          borderBottom: '1px solid #e8e8e8', background: '#fff', flexShrink: 0,
        }}>
          <ToolBtn icon="🖱" label="选择" active={activeTool === 'select'} onClick={() => setActiveTool('select')} />
          <ToolBtn icon="+" label="画框" active={activeTool === 'draw'} onClick={() => { setActiveTool('draw'); setEditingId(null); }} />
          <ToolBtn icon="🗑" label="删除" active={false} disabled={!editingId} onClick={() => { if (editingId) deleteField(); }} />
          <div style={{ width: 1, height: 20, background: '#e8e8e8', margin: '0 6px' }} />
          <button onClick={zoomOut} style={iconBtn} title="缩小">🔍-</button>
          <span style={{ fontSize: 12, color: '#666', minWidth: 38, textAlign: 'center', fontWeight: 500 }}>{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} style={iconBtn} title="放大">🔍+</button>
          <button onClick={rotateCCW} style={iconBtn} title="逆时针旋转">↺</button>
          <button onClick={rotateCW} style={iconBtn} title="顺时针旋转">↻</button>
          <div style={{ flex: 1 }} />
          <button onClick={saveTpl} style={{ padding: '5px 16px', border: 'none', borderRadius: 4, background: '#1890ff', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>保存模板</button>
          {activeTool === 'draw' && <span style={{ color: '#1890ff', fontSize: 11, fontWeight: 500, marginLeft: 8 }}>拖拽框选区域</span>}
        </div>

        {/* 图片画布区 */}
        <div style={{
          flex: 1, overflow: 'auto', background: '#e0e0e0',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          padding: 16,
        }}>
          <div style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: 'transform 0.2s ease',
          }}>
            <div data-canvas style={{
              position: 'relative', width: IMG_W, height: IMG_H,
              background: '#fff', border: '2px solid #ccc', borderRadius: 6,
              boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
              cursor: activeTool === 'draw' ? 'crosshair' : (activeTool === 'delete' ? 'not-allowed' : 'default'),
            }}
              onMouseDown={handleMDown} onMouseMove={handleMMove} onMouseUp={handleMUp} onClick={handleClick}>
              {/* 发票表面内容 */}
              <div style={{ padding: '14px 60px 0' }}>
                <div style={{ fontSize: 14, color: '#888', marginBottom: 12, display: 'flex', gap: 60 }}>
                  <span>发票号码: ___________</span>
                  <span>开票日期: ___________</span>
                </div>
                <div style={{ fontSize: 14, color: '#888', marginBottom: 12 }}>购买方: __________________________</div>
                <div style={{ fontSize: 14, color: '#888', marginBottom: 12 }}>销售方: __________________________</div>
                <Hr />
                <div style={{ fontSize: 14, color: '#888', marginBottom: 12, display: 'flex', gap: 60 }}>
                  <span>金额: ___________</span>
                  <span>税率: ___________</span>
                </div>
                <div style={{ fontSize: 14, color: '#888' }}>备注: __________________________</div>
              </div>

              {/* 已绘制字段框 */}
              {fields.map(f => {
                const sel = editingId === f.id;
                return (
                  <div key={f.id} style={{
                    position: 'absolute', left: f.x, top: f.y, width: f.w, height: f.h,
                    border: sel ? '2.5px solid #1890ff' : '1.5px dashed #b0d4ff',
                    background: sel ? 'rgba(24,144,255,0.08)' : 'rgba(24,144,255,0.02)',
                    borderRadius: 2, pointerEvents: 'none',
                  }}>
                    {f.label && (
                      <span style={{
                        position: 'absolute', top: -18, left: -1, fontSize: 10, fontWeight: 600,
                        color: '#fff', background: sel ? '#1890ff' : '#91caff',
                        padding: '1px 6px', borderRadius: 2, whiteSpace: 'nowrap',
                      }}>{f.label}</span>
                    )}
                    {!f.label && sel && (
                      <span style={{ position: 'absolute', top: -18, left: -1, fontSize: 10, color: '#1890ff', background: '#e6f7ff', padding: '1px 6px', borderRadius: 2, whiteSpace: 'nowrap' }}>未命名</span>
                    )}
                  </div>
                );
              })}

              {/* 预览矩形 */}
              {preview && (
                <div style={{ position: 'absolute', left: preview.x, top: preview.y, width: preview.w, height: preview.h, border: '2px dashed #1890ff', borderRadius: 2, pointerEvents: 'none' }} />
              )}
            </div>
          </div>
        </div>

        {/* 底部状态栏 */}
        <div style={{ padding: '5px 16px', borderTop: '1px solid #e8e8e8', fontSize: 11, color: '#999', background: '#fff', flexShrink: 0 }}>
          已配置 {fields.length} 个字段 · 缩放 {Math.round(zoom * 100)}% · 旋转 {rotation}° · {dirty ? '有未保存修改' : '已保存'}
        </div>
      </div>

      {/* ========== 右侧面板 ========== */}
      <div style={{ width: 300, borderLeft: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: '#fff', fontSize: 13 }}>
        {/* 字段列表 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0', fontWeight: 500, fontSize: 13, flexShrink: 0 }}>
            字段列表 ({fields.length})
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
            {fields.map((f, i) => {
              const sel = editingId === f.id;
              return (
                <div key={f.id}
                  onClick={() => handleFieldClick(f.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', marginBottom: 2, borderRadius: 5,
                    border: sel ? '1.5px solid #1890ff' : '1px solid #f0f0f0',
                    background: sel ? '#e6f7ff' : '#fff',
                    cursor: 'pointer', transition: 'background 0.15s',
                  }}>
                  <span style={{ color: '#1890ff', fontWeight: 600, fontSize: 12, minWidth: 18 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, color: '#333' }}>{f.label || '未命名'}</div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>
                      {f.dataType === 'text' ? '文本' : f.dataType === 'number' ? '数字' : f.dataType === 'date' ? '日期' : f.dataType} {f.required ? '· 必填' : ''}
                    </div>
                  </div>
                  {sel && <span style={{ fontSize: 11, color: '#1890ff' }}>▶</span>}
                </div>
              );
            })}
            {fields.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: '#ccc', fontSize: 13 }}>
                点击「+ 画框」开始绘制识别区域
              </div>
            )}
          </div>
        </div>

        {/* 字段编辑区 */}
        {editingId && (
          <div style={{ borderTop: '1px solid #f0f0f0', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 12, color: '#666', marginBottom: 2 }}>字段配置</div>
            <input type="text" value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="字段名（如：发票号码）" autoFocus
              style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid #d9d9d9', fontSize: 12, outline: 'none' }} />
            <select value={editType} onChange={e => setEditType(e.target.value)}
              style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid #d9d9d9', fontSize: 12, outline: 'none' }}>
              <option value="text">文本</option>
              <option value="number">数字</option>
              <option value="date">日期</option>
              <option value="checkbox">复选框</option>
              <option value="select">下拉</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={editRequired} onChange={e => setEditRequired(e.target.checked)} /> 必填
            </label>
            <input type="text" value={editRegex} onChange={e => setEditRegex(e.target.value)} placeholder="校验规则（正则，选填）"
              style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid #d9d9d9', fontSize: 12, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveField} disabled={!editLabel.trim()}
                style={{ flex: 1, padding: '6px', borderRadius: 4, border: 'none', background: editLabel.trim() ? '#1890ff' : '#d9d9d9', color: '#fff', cursor: editLabel.trim() ? 'pointer' : 'not-allowed', fontSize: 12 }}>保存</button>
              <button onClick={deleteField}
                style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid #ff4d4f', background: '#fff', color: '#ff4d4f', cursor: 'pointer', fontSize: 12 }}>删除</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- 辅助组件 ----
function ToolBtn({ icon, label, active, disabled, onClick }: { icon: string; label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: '4px 12px', borderRadius: 4, fontSize: 12,
        border: active ? '2px solid #1890ff' : '1px solid #d9d9d9',
        background: active ? '#e6f7ff' : '#fff',
        color: active ? '#1890ff' : '#555',
        fontWeight: active ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
      <span>{icon}</span> {label}
    </button>
  );
}

const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 4, border: '1px solid #d9d9d9',
  background: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 0,
};

function Hr() { return <div style={{ borderTop: '1px solid #eee', margin: '6px 0' }} />; }