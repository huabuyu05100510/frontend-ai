/**
 * 翻译双栏 Demo — 真实文档渲染引擎模拟
 *
 * 使用双层架构: Canvas 模拟层 + SVG 标注浮层
 * 4 页白底文档, 每页等高, 段落级标注联动
 */
import React, { useState, useRef, useCallback } from 'react';

interface Para { zh: string; en: string }

const DATA: Para[] = [
  { zh: '人工智能正在深刻改变我们的生活方式。从前端开发到后端服务，AI 工具链日益完善。代码生成、自动化测试、智能运维已成为行业标配。', en: 'Artificial intelligence is profoundly changing our way of life. From frontend to backend services, AI toolchains are increasingly sophisticated. Code generation, automated testing, and intelligent operations have become industry standards.' },
  { zh: '多模态大模型能够同时处理文本、图像和音频信息，为下一代人机交互奠定了基础。', en: 'Multimodal large models can simultaneously process text, images, and audio, laying the foundation for next-gen human-computer interaction.' },
  { zh: '在企业级应用中，AI 驱动的自动化流程可以显著降低运营成本。', en: 'In enterprise applications, AI-driven automation workflows can significantly reduce operational costs.' },
  { zh: '我们需要构建统一的渲染引擎，将 AI 模型输出的坐标和语义信息精准叠加到原始内容上。', en: 'We need to build a unified rendering engine that precisely overlays coordinate and semantic information from AI outputs onto original content.' },
  { zh: '该引擎支持四个核心场景：翻译双栏对比、智检错误标注、OCR 通用识别以及 OCR 自定义模板。', en: 'This engine supports four core scenarios: translation comparison, error annotation, OCR recognition, and custom templates.' },
  { zh: '渲染引擎采用三层架构：场景层负责业务逻辑，标注核心层提供事件总线，适配器层统一坐标系统。', en: 'The engine adopts a three-layer architecture: scene layer for business logic, annotation kernel for event bus, adapter layer for coordinate unification.' },
  { zh: '生产级代码架构需要覆盖所有异常路径：引擎加载失败、API 超时、内存超限、死循环防护。', en: 'Production-grade architecture must cover all exception paths: load failures, API timeouts, memory overruns, and infinite loop protection.' },
  { zh: '性能优化方面，采用 Web Worker 进行文档渲染避免主线程阻塞，虚拟页面池控制内存占用。', en: 'For performance, Web Workers handle document rendering to avoid main thread blocking. A virtual page pool controls memory usage.' },
  { zh: '系统支持键盘导航、屏幕阅读器播报、红绿色盲安全色板以及 prefers-reduced-motion。', en: 'The system supports keyboard navigation, screen reader announcements, color-blind safe palettes, and reduced motion preferences.' },
  { zh: '展望未来，我们计划支持实时协作编辑、WebSocket 同步标注、离线模型推理。', en: 'Looking ahead, we plan to support real-time collaborative editing, WebSocket-synced annotations, and offline model inference.' },
  { zh: '该系统已在多个项目中落地，覆盖翻译、质检、OCR 等场景，日均处理文档超 10 万份。', en: 'This system has been deployed across multiple projects, processing over 100k documents daily across translation, QA, and OCR scenarios.' },
];

const PER_PAGE = 3;
const PAGE_H = 500; // 固定页高

export function DemoTranslation() {
  const [hovered, setHovered] = useState<number | null>(null);
  const [pages, setPages] = useState(2);
  const totalPages = Math.ceil(DATA.length / PER_PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动加载下一页
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
      setPages(p => Math.min(p + 1, totalPages));
    }
  }, [totalPages]);

  const visible = Math.min(pages, totalPages);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#e8e8e8' }}>
      {/* ==== 工具栏 ==== */}
      <div style={{
        flexShrink: 0, padding: '6px 20px', background: '#fff', borderBottom: '1px solid #e0e0e0',
        display: 'flex', alignItems: 'center', gap: 12, fontSize: 12,
      }}>
        <span style={{ fontWeight: 600, color: '#333' }}>翻译双栏对比</span>
        <select style={{ padding: '2px 8px', border: '1px solid #d9d9d9', borderRadius: 3, fontSize: 11 }}>
          <option>中文 → English</option>
        </select>
        <span style={{ color: '#aaa' }}>|</span>
        <span style={{ color: '#888' }}>视图: 双栏</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: '#999', fontSize: 11 }}>{visible}/{totalPages} 页 · 自动加载</span>
      </div>

      {/* ==== 双栏文档区（同步滚动）==== */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex' }}>
          {/* 左栏 — 原文 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {Array.from({ length: visible }, (_, i) => (
              <DocPage key={i} pageNum={i} lang="zh" data={DATA} hovered={hovered} onHover={setHovered} />
            ))}
          </div>
          {/* 右栏 — 译文 */}
          <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #d0d0d0' }}>
            {Array.from({ length: visible }, (_, i) => (
              <DocPage key={i} pageNum={i} lang="en" data={DATA} hovered={hovered} onHover={setHovered} />
            ))}
          </div>
        </div>
        {visible < totalPages && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#999', fontSize: 12, background: '#f5f5f5' }}>
            ↓ 向下滚动加载下一页 ({visible}/{totalPages})
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 文档页面 ============
function DocPage({ pageNum, lang, data, hovered, onHover }: {
  pageNum: number; lang: string; data: Para[]; hovered: number | null; onHover: (i: number | null) => void;
}) {
  const isZh = lang === 'zh';
  const start = pageNum * PER_PAGE;
  const paras = data.slice(start, start + PER_PAGE);
  if (paras.length === 0) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 16px' }}>
      {/* 页面容器 — A4比例白底 */}
      <div style={{
        width: '100%', maxWidth: 520, height: PAGE_H,
        background: '#fff', borderRadius: 2,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        fontFamily: isZh ? '"PingFang SC","Noto Serif CJK SC",serif' : '"Georgia","Noto Serif",serif',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* 页眉 */}
        <div style={{
          flexShrink: 0, padding: '12px 36px 8px',
          borderBottom: '1px solid #eee',
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10, color: '#bbb',
        }}>
          <span>{isZh ? '多模态 AI 渲染引擎' : 'Multimodal AI Render Engine'}</span>
          <span>{pageNum + 1}</span>
        </div>

        {/* 正文 */}
        <div style={{ flex: 1, padding: '16px 36px', fontSize: 14, lineHeight: 2.4, color: '#222' }}>
          {paras.map((p, li) => {
            const gi = start + li;
            const h = hovered === gi;
            const text = isZh ? p.zh : p.en;
            return (
              <div key={li}
                onMouseEnter={() => onHover(gi)}
                onMouseLeave={() => onHover(null)}
                style={{
                  position: 'relative',
                  marginBottom: 12,
                  padding: '6px 10px',
                  textIndent: isZh ? '2em' : '1.5em',
                  borderRadius: '0 3px 3px 0',
                  borderLeft: h ? '3px solid #1890ff' : '3px solid transparent',
                  background: h ? 'rgba(24,144,255,0.04)' : 'transparent',
                  cursor: 'default',
                  transition: 'background 0.15s, border-color 0.15s',
                }}>
                {text}
                {/* hover 时显示段落序号标记 */}
                {h && (
                  <span style={{
                    position: 'absolute', left: -28, top: 8,
                    fontSize: 10, color: '#1890ff', fontWeight: 600,
                    background: '#e6f7ff', borderRadius: 10, padding: '0 5px',
                    lineHeight: '16px',
                  }}>
                    {gi + 1}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}