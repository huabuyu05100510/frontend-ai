import type { AICommand, AIContext, AIRequest } from '../core/types'

// ── Mock response library ─────────────────────────────────────────────────────
const MOCK_RESPONSES: Record<AICommand, (req: AIRequest) => string> = {
  continue: (req) => {
    const ctx = (req.context ?? req.selectedText).toLowerCase()
    if (ctx.includes('ai') || ctx.includes('人工智能') || ctx.includes('machine learning')) {
      return '，这种技术正在深刻改变我们的工作方式。通过大规模数据训练，模型能够理解复杂的语义关系，为用户提供精准的建议和自动化支持，从而显著提升生产效率。'
    }
    if (ctx.includes('design') || ctx.includes('设计') || ctx.includes('ui') || ctx.includes('ux')) {
      return '，优秀的设计不仅仅是视觉上的美观，更是功能与体验的完美融合。设计师需要深入理解用户心理，通过迭代验证，持续优化产品的可用性和可访问性。'
    }
    if (ctx.includes('code') || ctx.includes('代码') || ctx.includes('program')) {
      return '，编写高质量代码的关键在于清晰的结构和良好的抽象。每一个函数都应该只做一件事，命名应该自文档化，测试覆盖应该全面而有意义。'
    }
    return '，在这个快速变化的时代，持续学习和适应变化的能力比任何具体技能都更为重要。我们需要培养批判性思维，勇于质疑现状，并以数据为基础做出决策。'
  },

  summarize: (req) => {
    const wordCount = req.selectedText.trim().split(/\s+/).length
    return `**摘要**\n\n本文主要讨论了以下核心观点：\n\n1. 通过分析原文 ${wordCount} 个词汇，可以提炼出主要论点和关键信息\n2. 文章结构清晰，论据充分，具有较强的说服力\n3. 结论具有实践指导价值，建议读者结合实际场景加以应用`
  },

  translate: (req) => {
    const lang = req.targetLanguage ?? 'zh'
    const text = req.selectedText
    if (lang === 'zh') {
      // Simple mock: append Chinese translation indicators
      if (/[a-zA-Z]/.test(text)) {
        return `【中文译文】\n${text
          .replace(/Hello/gi, '你好')
          .replace(/World/gi, '世界')
          .replace(/The/gi, '这')
          .replace(/is/gi, '是')
          .replace(/good/gi, '好的')
          .replace(/technology/gi, '技术')
          .replace(/design/gi, '设计')
          .replace(/system/gi, '系统')
          .replace(/user/gi, '用户')
          .replace(/experience/gi, '体验')
          || `（此处为"${text.slice(0, 30)}..."的中文翻译）`}`
      }
      return `[Translation to ${lang}] ${text}`
    }
    if (lang === 'en') {
      if (/[\u4e00-\u9fa5]/.test(text)) {
        return `[English Translation]\nThis is the English translation of the provided Chinese text. The original content discusses ${text.length > 20 ? 'various aspects of the topic' : 'a brief concept'} in detail.`
      }
    }
    return `[Translated to ${lang}]: ${text}`
  },

  fix_grammar: (req) => {
    const text = req.selectedText
    // Apply simple rule-based fixes
    return text
      .replace(/\bi am\b/gi, 'I am')
      .replace(/\bhe go\b/gi, 'he goes')
      .replace(/\bshe go\b/gi, 'she goes')
      .replace(/\bthey goes\b/gi, 'they go')
      .replace(/\byesterday i\b/gi, 'Yesterday I')
      .replace(/(\w)\s{2,}/g, '$1 ')
      .replace(/\s+([.,!?])/g, '$1')
      + (text.match(/[^.!?]$/) ? '.' : '')
  },

  expand: (req) => {
    return `${req.selectedText}\n\n**扩展内容**\n\n深入来看，这个观点可以从多个维度进行分析：\n\n**理论层面**：相关研究表明，这一现象与多种因素密切相关，包括技术发展、用户行为模式以及市场环境的演变。学术界已有大量文献对此进行了系统性探讨。\n\n**实践层面**：在实际应用中，我们可以观察到诸多典型案例。这些案例不仅验证了理论假设，也为我们提供了宝贵的实践经验和优化方向。\n\n**未来展望**：随着技术的持续进步，我们有理由相信这一领域将迎来更多突破性发展，为社会创造更大价值。`
  },

  shorten: (req) => {
    const sentences = req.selectedText.split(/[.。！？!?]+/).filter(s => s.trim().length > 10)
    const key = sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2)))
    return key.join('。') + '。'
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// AIEngine
// ─────────────────────────────────────────────────────────────────────────────

export class AIEngine {
  private readonly MIN_DELAY = 20   // ms per token
  private readonly MAX_DELAY = 60

  /** Streaming token generator. Supports AbortSignal. */
  async *stream(req: AIRequest, signal?: AbortSignal): AsyncGenerator<string> {
    const response = MOCK_RESPONSES[req.command]?.(req) ?? 'Unable to process this request.'

    // Tokenize: split into words+spaces for realistic streaming
    const tokens = this._tokenize(response)

    for (const token of tokens) {
      if (signal?.aborted) return

      yield token

      // Variable delay for natural feel
      const delay = this.MIN_DELAY + Math.random() * (this.MAX_DELAY - this.MIN_DELAY)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      }).catch(() => undefined)

      if (signal?.aborted) return
    }
  }

  /** Detect dominant language of text */
  detectLanguage(text: string): string {
    if (!text.trim()) return 'unknown'

    const zhChars = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
    const enChars = (text.match(/[a-zA-Z]/g) ?? []).length
    const total = zhChars + enChars

    if (total === 0) return 'unknown'
    if (zhChars / total > 0.3) return 'zh'
    return 'en'
  }

  /**
   * Build AI context from document text around cursor position.
   * Ensures the result doesn't exceed maxTokens.
   */
  buildContext(fullText: string, cursorPos: number, maxTokens = 400): AIContext {
    const WINDOW = 200 // chars before/after cursor

    const before = fullText.slice(Math.max(0, cursorPos - WINDOW), cursorPos)
    const after = fullText.slice(cursorPos, Math.min(fullText.length, cursorPos + WINDOW))
    let surroundingText = before + after

    // Estimate tokens (rough: 4 chars per token for mixed zh/en)
    const estimatedTokens = Math.ceil(surroundingText.length / 4)
    if (estimatedTokens > maxTokens) {
      const limit = maxTokens * 4
      surroundingText = surroundingText.slice(0, limit)
    }

    return {
      selectedText: '',
      surroundingText,
      documentTitle: '',
      outlineHeadings: [],
      estimatedTokens: Math.min(estimatedTokens, maxTokens),
    }
  }

  private _tokenize(text: string): string[] {
    // Split into small chunks for streaming effect
    const tokens: string[] = []
    let i = 0
    while (i < text.length) {
      // Vary chunk size: 1-3 chars for natural feel
      const size = 1 + Math.floor(Math.random() * 3)
      tokens.push(text.slice(i, i + size))
      i += size
    }
    return tokens
  }
}
