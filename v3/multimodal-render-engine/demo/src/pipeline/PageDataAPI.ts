/**
 * PageDataAPI — Mock 服务端
 * 真实场景由服务端（LibreOffice / pdfium）完成格式转换，
 * 前端只消费 PageData[]，format-agnostic。
 */

import type { PageData, TextBlock, BlockType, DocStreamEvent } from '../core/types'

// ─── Mock 数据集 ────────────────────────────────────────────

/** 发票文档（3页，每页内容轮转） */
const INVOICE_BLOCKS: TextBlock[][] = [
  [
    { id: 'inv-1-0', type: 'heading',   text: '增值税专用发票',           bbox: { x: 60, y: 18, w: 476, h: 52 }, confidence: 0.99 },
    { id: 'inv-1-1', type: 'separator', text: '',                         bbox: { x: 0,  y: 84, w: 595, h: 4  }, confidence: 1 },
    { id: 'inv-1-2', type: 'cell',      text: '1100161430', label: '发票代码', bbox: { x: 18, y: 101, w: 268, h: 59 }, confidence: 0.98, row: 0, col: 0, tableId: 'tbl-inv' },
    { id: 'inv-1-3', type: 'cell',      text: '08765432',   label: '发票号码', bbox: { x: 309, y: 101, w: 268, h: 59 }, confidence: 0.97, row: 0, col: 1, tableId: 'tbl-inv' },
    { id: 'inv-1-4', type: 'cell',      text: '2024年03月15日', label: '开票日期', bbox: { x: 18, y: 185, w: 559, h: 59 }, confidence: 0.96, row: 1, col: 0, tableId: 'tbl-inv' },
    { id: 'inv-1-5', type: 'cell',      text: '北京某某科技有限公司', label: '购买方名称', bbox: { x: 18, y: 269, w: 559, h: 59 }, confidence: 0.97, row: 2, col: 0, tableId: 'tbl-inv' },
    { id: 'inv-1-6', type: 'cell',      text: '上海某供应链管理有限公司', label: '销售方名称', bbox: { x: 18, y: 353, w: 559, h: 59 }, confidence: 0.95, row: 3, col: 0, tableId: 'tbl-inv' },
    { id: 'inv-1-7', type: 'cell',      text: '软件开发服务', label: '商品/服务名称', bbox: { x: 18, y: 437, w: 559, h: 59 }, confidence: 0.99, row: 4, col: 0, tableId: 'tbl-inv' },
    { id: 'inv-1-8', type: 'separator', text: '',                         bbox: { x: 0, y: 513, w: 595, h: 4 }, confidence: 1 },
    { id: 'inv-1-9', type: 'cell',      text: '¥ 85,000.00', label: '不含税金额', bbox: { x: 18, y: 530, w: 268, h: 59 }, confidence: 0.98, row: 5, col: 0, tableId: 'tbl-inv' },
    { id: 'inv-1-10', type: 'cell',     text: '¥ 5,100.00',  label: '税额',      bbox: { x: 309, y: 530, w: 268, h: 59 }, confidence: 0.97, row: 5, col: 1, tableId: 'tbl-inv' },
    { id: 'inv-1-11', type: 'cell',     text: '¥ 90,100.00', label: '价税合计',  bbox: { x: 18, y: 697, w: 268, h: 59 }, confidence: 0.98, row: 6, col: 0, tableId: 'tbl-inv' },
    { id: 'inv-1-12', type: 'cell',     text: '请妥善保管，遗失不补', label: '备注', bbox: { x: 309, y: 697, w: 268, h: 59 }, confidence: 0.95, row: 6, col: 1, tableId: 'tbl-inv' },
  ],
  [
    { id: 'inv-2-0', type: 'heading',   text: '附件：服务明细', bbox: { x: 60, y: 18, w: 476, h: 52 }, confidence: 0.98 },
    { id: 'inv-2-1', type: 'paragraph', text: '本次服务包含需求分析、系统设计、开发实施和测试验收四个阶段，详见下方明细。', bbox: { x: 18, y: 84, w: 559, h: 59 }, confidence: 0.96 },
    { id: 'inv-2-2', type: 'cell', text: '需求分析', label: '阶段',   bbox: { x: 18, y: 160, w: 200, h: 48 }, confidence: 0.97, row: 0, col: 0, tableId: 'tbl-svc' },
    { id: 'inv-2-3', type: 'cell', text: '20,000',   label: '金额(元)', bbox: { x: 220, y: 160, w: 180, h: 48 }, confidence: 0.98, row: 0, col: 1, tableId: 'tbl-svc' },
    { id: 'inv-2-4', type: 'cell', text: '5天',       label: '工期',   bbox: { x: 402, y: 160, w: 175, h: 48 }, confidence: 0.96, row: 0, col: 2, tableId: 'tbl-svc' },
  ],
  [
    { id: 'inv-3-0', type: 'heading',   text: '合同编号与签章', bbox: { x: 60, y: 18, w: 476, h: 52 }, confidence: 0.99 },
    { id: 'inv-3-1', type: 'cell', text: 'HT-2024-0315', label: '合同编号', bbox: { x: 18, y: 84, w: 559, h: 59 }, confidence: 0.97, row: 0, col: 0, tableId: 'tbl-contract' },
    { id: 'inv-3-2', type: 'image', text: '',  bbox: { x: 18, y: 160, w: 200, h: 200 }, confidence: 1 },
    { id: 'inv-3-3', type: 'caption', text: '销货单位公章', bbox: { x: 58, y: 368, w: 120, h: 28 }, confidence: 0.94 },
  ],
]

/** 技术文档（3页） */
const TECH_DOC_BLOCKS: TextBlock[][] = [
  [
    { id: 'td-1-0', type: 'heading',   text: '多模态渲染引擎技术文档', bbox: { x: 40, y: 18, w: 515, h: 52 }, confidence: 0.99 },
    { id: 'td-1-1', type: 'heading',   text: '第一章：系统架构概述',    bbox: { x: 18, y: 92, w: 357, h: 42 }, confidence: 0.98 },
    { id: 'td-1-2', type: 'paragraph', text: '系统由坐标适配层、标注存储层、渲染展示层、交互事件层四个核心模块组成。', bbox: { x: 18, y: 159, w: 559, h: 59 }, confidence: 0.96 },
    { id: 'td-1-3', type: 'separator', text: '', bbox: { x: 0, y: 235, w: 595, h: 4 }, confidence: 1 },
    { id: 'td-1-4', type: 'heading',   text: '第二章：坐标系统设计',    bbox: { x: 18, y: 253, w: 357, h: 42 }, confidence: 0.97 },
    { id: 'td-1-5', type: 'cell', text: 'img.offsetWidth / img.naturalWidth', label: '像素坐标', bbox: { x: 18, y: 319, w: 559, h: 59 }, confidence: 0.95, row: 0, col: 0, tableId: 'tbl-coord' },
    { id: 'td-1-6', type: 'cell', text: '页面 pt 单位，原点左下角',      label: '页面坐标', bbox: { x: 18, y: 395, w: 559, h: 59 }, confidence: 0.94, row: 1, col: 0, tableId: 'tbl-coord' },
    { id: 'td-1-7', type: 'cell', text: 'from / to 字符索引',            label: '字符偏移', bbox: { x: 18, y: 471, w: 559, h: 59 }, confidence: 0.96, row: 2, col: 0, tableId: 'tbl-coord' },
    { id: 'td-1-8', type: 'formula',   text: 'scale = offsetWidth / naturalWidth', bbox: { x: 100, y: 555, w: 395, h: 60 }, confidence: 0.99 },
  ],
  [
    { id: 'td-2-0', type: 'heading',   text: '第三章：性能优化',  bbox: { x: 18, y: 18, w: 357, h: 42 }, confidence: 0.97 },
    { id: 'td-2-1', type: 'paragraph', text: '使用 R-Tree 空间索引将命中检测从 O(n) 降至 O(log n)。', bbox: { x: 18, y: 84, w: 559, h: 59 }, confidence: 0.95 },
    { id: 'td-2-2', type: 'cell', text: '1000个节点，帧率稳定 60fps', label: '标注量', bbox: { x: 18, y: 168, w: 559, h: 48 }, confidence: 0.93, row: 0, col: 0, tableId: 'tbl-perf' },
    { id: 'td-2-3', type: 'cell', text: '< 1ms',                   label: 'HitTest', bbox: { x: 18, y: 232, w: 559, h: 48 }, confidence: 0.96, row: 1, col: 0, tableId: 'tbl-perf' },
    { id: 'td-2-4', type: 'image', text: '', bbox: { x: 100, y: 300, w: 395, h: 260 }, confidence: 1 },
    { id: 'td-2-5', type: 'caption', text: '图1：R-Tree 命中检测示意图', bbox: { x: 150, y: 568, w: 295, h: 28 }, confidence: 0.92 },
  ],
  [
    { id: 'td-3-0', type: 'heading',   text: '第四章：事件总线设计', bbox: { x: 18, y: 18, w: 357, h: 42 }, confidence: 0.98 },
    { id: 'td-3-1', type: 'paragraph', text: 'EventBus 定义了 13 种内核事件，所有事件携带强类型负载。', bbox: { x: 18, y: 84, w: 559, h: 59 }, confidence: 0.96 },
    { id: 'td-3-2', type: 'paragraph', text: '通过事件总线解耦各模块，使得每个模块可以独立开发、测试和替换。', bbox: { x: 18, y: 160, w: 559, h: 59 }, confidence: 0.94 },
  ],
]

/** 文章文档（2页） */
const ARTICLE_BLOCKS: TextBlock[][] = [
  [
    { id: 'art-1-0', type: 'heading',   text: 'AI 多模态渲染：前端工程的下一个边界', bbox: { x: 18, y: 18, w: 559, h: 60 }, confidence: 0.99 },
    { id: 'art-1-1', type: 'paragraph', text: '随着大语言模型的快速普及，前端工程师面临的核心挑战已不再是"如何展示数据"，而是"如何让 AI 推理结果与原始内容精准对齐"。', bbox: { x: 18, y: 96, w: 559, h: 80 }, confidence: 0.97 },
    { id: 'art-1-2', type: 'paragraph', text: '多模态渲染引擎正是解决这一问题的核心组件：它需要统一处理图像像素坐标、文档页面坐标、文本字符偏移等多种坐标系。', bbox: { x: 18, y: 192, w: 559, h: 80 }, confidence: 0.72 },
    { id: 'art-1-3', type: 'image',     text: '', bbox: { x: 97, y: 290, w: 401, h: 260 }, confidence: 1 },
    { id: 'art-1-4', type: 'caption',   text: '图：多模态渲染引擎架构示意', bbox: { x: 148, y: 558, w: 299, h: 28 }, confidence: 0.91 },
  ],
  [
    { id: 'art-2-0', type: 'heading',   text: '坐标系统：三种体系的统一',  bbox: { x: 18, y: 18, w: 400, h: 42 }, confidence: 0.98 },
    { id: 'art-2-1', type: 'paragraph', text: '像素坐标系适用于扫描件、照片等位图内容，以图片左上角为原点，单位为自然像素。', bbox: { x: 18, y: 76, w: 559, h: 59 }, confidence: 0.96 },
    { id: 'art-2-2', type: 'paragraph', text: '页面坐标系适用于 PDF 文档，以页面左下角为原点，单位为 pt（1/72 英寸）。', bbox: { x: 18, y: 151, w: 559, h: 59 }, confidence: 0.94 },
    { id: 'art-2-3', type: 'paragraph', text: '字符偏移坐标系适用于富文本编辑器，以字符流的起止 index 表示范围。', bbox: { x: 18, y: 226, w: 559, h: 59 }, confidence: 0.95 },
  ],
]

const DOC_MAP: Record<string, TextBlock[][]> = {
  invoice:  INVOICE_BLOCKS,
  'tech-doc': TECH_DOC_BLOCKS,
  article:  ARTICLE_BLOCKS,
}

// ─── API 实现 ────────────────────────────────────────────────

export class PageDataAPI {
  /**
   * 同步获取单页数据（测试 / 缓存场景）
   */
  getPage(docType: string, pageNum: number): PageData {
    const pages = DOC_MAP[docType] ?? INVOICE_BLOCKS
    const idx = (pageNum - 1) % pages.length
    const rawBlocks = pages[idx]

    // 确保 formula / image 无 translation 字段
    const blocks: TextBlock[] = rawBlocks.map(b => {
      const block: TextBlock = { ...b }
      if (block.type === 'formula' || block.type === 'image') {
        delete block.translation
      } else if (block.translation === undefined) {
        block.translation = this._mockTranslate(block.text)
      }
      return block
    })

    return {
      pageNum,
      imageUrl: '',          // 真实场景为 WebP URL，demo 由 canvas 生成
      naturalWidth: 595,
      naturalHeight: 842,
      blocks,
    }
  }

  /**
   * 流式推送文档页面（模拟 SSE）
   * 每页间隔 200ms，最后推送 DOC_COMPLETE
   */
  async *streamDocument(docType: string): AsyncGenerator<DocStreamEvent> {
    const pages = DOC_MAP[docType] ?? INVOICE_BLOCKS
    const totalPages = pages.length

    for (let i = 1; i <= totalPages; i++) {
      await delay(200)
      yield { type: 'PAGE_READY', data: this.getPage(docType, i) }
    }

    yield { type: 'DOC_COMPLETE', totalPages }
  }

  private _mockTranslate(text: string): string {
    if (!text) return ''
    // 简单 mock：原文 + [EN] 后缀，真实场景由翻译 API 返回
    return text
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
