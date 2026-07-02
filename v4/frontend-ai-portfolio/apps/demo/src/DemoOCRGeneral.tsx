/**
 * OCR 通用识别 Demo — 按设计图 OCR识别.png 精确实现
 *
 * 特性:
 * - 左侧: 图片 + 青色识别框 + 序号标签 + 缩放旋转控制
 * - 右侧: 320px 文字结果面板 (置信度 + 双向hover + 复制)
 * - 支持缩放/旋转后识别框自适应
 */
import React, { useState, useCallback } from 'react';
import { EmptyState } from '@portfolio/multimodal-render-engine/components/EmptyState';
import { LoadingSkeleton } from '@portfolio/multimodal-render-engine/components/LoadingSkeleton';
import { toast } from '@portfolio/multimodal-render-engine/components/Toast';

// 800×500 坐标系 (相对于发票原始尺寸)
const REGIONS = [
  { id: 'r0', text: '增值税发票', x: 270, y: 22, w: 260, h: 42, c: 0.96 },
  { id: 'r1', text: '发票号码: 12345678', x: 55, y: 78, w: 220, h: 24, c: 0.93 },
  { id: 'r2', text: '开票日期: 2026-06-12', x: 55, y: 110, w: 210, h: 24, c: 0.89 },
  { id: 'r3', text: '购买方: 北京科技有限公司', x: 55, y: 148, w: 280, h: 24, c: 0.92 },
  { id: 'r4', text: '销售方: 上海贸易有限公司', x: 55, y: 180, w: 280, h: 24, c: 0.91 },
  { id: 'r5', text: '货物名称: 软件开发服务', x: 55, y: 236, w: 230, h: 24, c: 0.95 },
  { id: 'r6', text: '金额合计: ¥50,000.00', x: 55, y: 270, w: 220, h: 24, c: 0.97 },
  { id: 'r7', text: '税率: 6%', x: 440, y: 270, w: 75, h: 24, c: 0.42 },
  { id: 'r8', text: '税额: ¥3,000.00', x: 565, y: 270, w: 145, h: 24, c: 0.88 },
  { id: 'r9', text: '价税合计: ¥53,000.00', x: 55, y: 318, w: 260, h: 30, c: 0.98 },
];

export function DemoOCRGeneral() {
  const [step, setStep] = useState<'empty' | 'loading' | 'loaded'>('empty');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const handleUpload = useCallback(() => {
    setStep('loading');
    setTimeout(() => { setStep('loaded'); toast.success('识别完成，共 10 个区域'); }, 1200);
  }, []);

  const copyAll = useCallback(async () => {
    await navigator.clipboard.writeText(REGIONS.map(r => r.text).join('\n'));
    toast.success('已复制全文');
  }, []);

  const copyOne = useCallback(async (t: string) => {
    await navigator.clipboard.writeText(t);
    toast.success('已复制');
  }, []);

  if (step === 'empty') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState title="模拟 OCR 识别" description="对发票图片进行 OCR 文字识别，返回文字块 + 坐标" action={{ label: '模拟上传并识别', onClick: handleUpload }} />
      </div>
    );
  }

  if (step === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100%', padding: 16, gap: 12 }}>
        <div style={{ flex: 1 }}><LoadingSkeleton variant="image" /></div>
        <div style={{ width: 320 }}><LoadingSkeleton variant="text" height="100%" rows={14} /></div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'system-ui, sans-serif', background: '#f5f5f5' }}>
      {/* ===== 左侧图片区 ===== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 缩放旋转控制 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 16px',
          borderBottom: '1px solid #e8e8e8', background: '#fff', flexShrink: 0,
        }}>
          <button onClick={() => setZoom(z => Math.min(z + 0.25, 3))} style={iconBtn} title="放大">🔍+</button>
          <span style={{ fontSize: 12, color: '#666', minWidth: 40, textAlign: 'center', fontWeight: 500 }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} style={iconBtn} title="缩小">🔍-</button>
          <div style={{ width: 1, height: 18, background: '#e8e8e8', margin: '0 4px' }} />
          <button onClick={() => setRotation(r => r - 90)} style={iconBtn} title="逆时针旋转">↺</button>
          <button onClick={() => setRotation(r => r + 90)} style={iconBtn} title="顺时针旋转">↻</button>
          <button onClick={() => { setZoom(1); setRotation(0); }} style={{ ...iconBtn, width: 'auto', padding: '0 8px', fontSize: 11 }}>重置</button>
        </div>

        {/* 图片画布 */}
        <div style={{
          flex: 1, overflow: 'auto', display: 'flex',
          justifyContent: 'center', alignItems: 'center',
          background: '#e0e0e0', padding: 16,
        }}>
          <div style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: 'transform 0.2s ease',
          }}>
            {/* 发票 — 800×500 */}
            <div style={{
              position: 'relative', width: 800, height: 500,
              background: '#fff', border: '2px solid #d0d0d0', borderRadius: 6,
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            }}>
              <div style={{ padding: '8px 55px 0' }}>
                <div style={{ textAlign: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', letterSpacing: 3 }}>增值税发票</div>
                </div>
                <Row label="发票号码" value="12345678" />
                <Row label="开票日期" value="2026-06-12" />
                <Row label="购买方" value="北京科技有限公司" />
                <Row label="销售方" value="上海贸易有限公司" />
                <Hr />
                <Row label="货物名称" value="软件开发服务" mb={4} />
                <div style={{ fontSize: 13, color: '#333', marginBottom: 6, display: 'flex', gap: 100 }}>
                  <span>金额合计: ¥50,000.00</span>
                  <span>税率: 6%</span>
                  <span>税额: ¥3,000.00</span>
                </div>
                <Hr />
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>价税合计: ¥53,000.00</div>
              </div>

              {/* 识别框 */}
              {REGIONS.map((r, idx) => {
                const isActive = activeId === r.id;
                const isLow = r.c < 0.5;
                const stroke = isLow ? '#fa8c16' : '#13c2c2';
                return (
                  <div key={r.id}
                    onMouseEnter={() => setActiveId(r.id)}
                    onMouseLeave={() => setActiveId(null)}
                    style={{
                      position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
                      border: isActive ? `2px solid ${stroke}` : `1.5px solid ${stroke}`,
                      background: isActive ? (isLow ? 'rgba(250,140,22,0.1)' : 'rgba(19,194,194,0.1)') : 'transparent',
                      borderRadius: 2, cursor: 'default', transition: 'background 0.15s',
                    }}>
                    <span style={{
                      position: 'absolute', top: -1, left: -1, fontSize: 10, fontWeight: 700,
                      color: '#fff', background: stroke, padding: '0 5px', borderRadius: '0 0 3px 0',
                      lineHeight: '16px',
                    }}>
                      {isLow ? `⚠${idx + 1}` : idx + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ===== 右侧结果面板 ===== */}
      <div style={{ width: 320, borderLeft: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', background: '#fff', fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontWeight: 500, fontSize: 14, flexShrink: 0 }}>
          <span>识别结果 ({REGIONS.length})</span>
          <button onClick={copyAll} style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #d9d9d9', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#666' }}>复制全文</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
          {REGIONS.map((r, idx) => {
            const isActive = activeId === r.id;
            const isLow = r.c < 0.5;
            return (
              <div key={r.id}
                onMouseEnter={() => setActiveId(r.id)}
                onMouseLeave={() => setActiveId(null)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px', marginBottom: 2, borderRadius: 5,
                  border: isActive ? '1px solid #1890ff' : '1px solid transparent',
                  background: isActive ? '#e6f7ff' : 'transparent',
                  opacity: isLow ? 0.45 : 1, cursor: 'default', transition: 'background 0.15s',
                }}>
                <span style={{ color: '#13c2c2', fontWeight: 600, minWidth: 22, fontSize: 12, flexShrink: 0 }}>{String(idx + 1).padStart(2, '0')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-all', color: '#333' }}>{r.text}</div>
                  {!isLow && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>置信度 {Math.round(r.c * 100)}%</div>}
                </div>
                {isLow && <span title="识别置信度较低" style={{ fontSize: 14, color: '#fa8c16', flexShrink: 0 }}>⚠️</span>}
                <button onClick={() => copyOne(r.text)} style={{ opacity: 0.4, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, flexShrink: 0, padding: 2 }} title="复制">📋</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mb = 8 }: { label: string; value: string; mb?: number }) {
  return (
    <div style={{ fontSize: 13, color: '#333', marginBottom: mb, display: 'flex', gap: 8 }}>
      <span style={{ color: '#999', minWidth: 70 }}>{label}:</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
function Hr() { return <div style={{ borderTop: '1px solid #eee', margin: '6px 0' }} />; }
const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 4, border: '1px solid #d9d9d9',
  background: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 0,
};