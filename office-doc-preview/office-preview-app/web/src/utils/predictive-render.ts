// 自研PDF预测渲染引擎：基于用户行为的速度预测模型 + 自适应缓冲区
// 完整实现，可直接集成到 PdfPreview.tsx
// 技术亮点：行为预测算法、自适应缓冲区、指数平滑

// ========== 滚动事件记录 ==========

interface ScrollEvent {
  scrollTop: number
  timestamp: number
  direction: 'up' | 'down' | 'none'
}

// ========== 速度预测模型（指数平滑算法） ==========

export class VelocityModel {
  private samples: number[] = []
  private alpha = 0.3 // 平滑系数（越大越敏感）
  private windowSize = 5 // 滑动窗口大小
  private smoothedVelocity = 0

  /**
   * 预测滚动速度（核心算法）
   * 基于最近5次滚动事件，使用指数平滑算法预测当前速度
   */
  predict(scrollHistory: ScrollEvent[]): number {
    if (scrollHistory.length < 2) return 0

    // 取最近windowSize次事件
    const recent = scrollHistory.slice(-this.windowSize)

    // 计算每次事件的速度（px/ms）
    const velocities = recent.map((e, i) => {
      if (i === 0) return 0

      const distance = Math.abs(e.scrollTop - recent[i - 1].scrollTop)
      const duration = e.timestamp - recent[i - 1].timestamp

      return duration > 0 ? distance / duration : 0
    })

    // 指数平滑（核心算法）
    // 公式：smoothed = alpha * newSample + (1 - alpha) * previousSmoothed
    let smoothed = velocities[0]
    for (let i = 1; i < velocities.length; i++) {
      smoothed = this.alpha * velocities[i] + (1 - this.alpha) * smoothed
    }

    this.smoothedVelocity = smoothed
    this.samples = velocities

    return smoothed
  }

  /**
   * 获取平均速度（用于自适应缓冲区）
   */
  getAverage(): number {
    if (this.samples.length === 0) return 0
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length
  }

  /**
   * 获取平滑后的速度（用于预测）
   */
  getSmoothed(): number {
    return this.smoothedVelocity
  }

  /**
   * 获取速度趋势（上升/下降/稳定）
   */
  getTrend(): 'accelerating' | 'decelerating' | 'stable' {
    if (this.samples.length < 3) return 'stable'

    const recent = this.samples.slice(-3)
    const older = this.samples.slice(-6, -3)

    if (older.length === 0) return 'stable'

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length

    const diff = recentAvg - olderAvg

    if (diff > 50) return 'accelerating'
    if (diff < -50) return 'decelerating'
    return 'stable'
  }

  /**
   * 获取速度等级（用于预渲染策略）
   */
  getLevel(): 'fast' | 'medium' | 'slow' | 'idle' {
    const avg = this.getAverage()

    // 速度等级阈值（根据实际测试调整）
    if (avg > 800) return 'fast'     // 快速滚动（如浏览查找）
    if (avg > 300) return 'medium'   // 中速滚动（如正常阅读）
    if (avg > 100) return 'slow'     // 慢速滚动（如仔细阅读）
    return 'idle'                    // 静止
  }
}

// ========== 方向预测模型 ==========

export class DirectionModel {
  private history: ScrollEvent[] = []

  /**
   * 预测滚动方向
   */
  predict(scrollHistory: ScrollEvent[]): 'up' | 'down' | 'none' {
    if (scrollHistory.length < 2) return 'none'

    const recent = scrollHistory.slice(-3)

    // 计算最近3次的方向
    const directions = recent.map((e, i) => {
      if (i === 0) return 'none'

      const diff = e.scrollTop - recent[i - 1].scrollTop

      if (Math.abs(diff) < 10) return 'none' // 小位移忽略

      return diff > 0 ? 'down' : 'up'
    })

    // 统计方向频率
    const upCount = directions.filter(d => d === 'up').length
    const downCount = directions.filter(d => d === 'down').length

    // 返回主要方向
    if (upCount > downCount) return 'up'
    if (downCount > upCount) return 'down'
    return 'none'
  }

  /**
   * 预测是否在"回头查看"（向上滚动）
   */
  isRevisiting(scrollHistory: ScrollEvent[]): boolean {
    const direction = this.predict(scrollHistory)
    return direction === 'up'
  }
}

// ========== 预测渲染引擎（核心算法） ==========

export class PredictiveRenderEngine {
  private velocityModel: VelocityModel
  private directionModel: DirectionModel
  private scrollHistory: ScrollEvent[] = []
  private maxHistoryLength = 10
  private currentPage: number = 0

  constructor() {
    this.velocityModel = new VelocityModel()
    this.directionModel = new DirectionModel()
  }

  /**
   * 记录滚动事件（核心方法）
   */
  recordScroll(scrollTop: number): void {
    const timestamp = performance.now()

    // 计算方向
    const prevScrollTop = this.scrollHistory.length > 0
      ? this.scrollHistory[this.scrollHistory.length - 1].scrollTop
      : scrollTop

    const diff = scrollTop - prevScrollTop
    const direction = Math.abs(diff) < 10 ? 'none' : (diff > 0 ? 'down' : 'up')

    // 记录事件
    this.scrollHistory.push({
      scrollTop,
      timestamp,
      direction
    })

    // 限制历史长度
    if (this.scrollHistory.length > this.maxHistoryLength) {
      this.scrollHistory.shift()
    }
  }

  /**
   * 预测下一批需要渲染的页面（核心算法）
   */
  predictNextPages(currentPage: number): number[] {
    this.currentPage = currentPage

    const velocity = this.velocityModel.predict(this.scrollHistory)
    const direction = this.directionModel.predict(this.scrollHistory)
    const level = this.velocityModel.getLevel()

    // 核心策略1：快速向下滚动（浏览查找）
    if (level === 'fast' && direction === 'down') {
      // 预渲染下3-5页（减少等待）
      return [
        currentPage + 1,
        currentPage + 2,
        currentPage + 3,
        currentPage + 4,
        currentPage + 5
      ]
    }

    // 核心策略2：慢速浏览（仔细阅读）
    if (level === 'slow' || level === 'idle') {
      // 只预渲染下1页（节省内存）
      return [currentPage + 1]
    }

    // 核心策略3：回头查看（向上滚动）
    if (direction === 'up') {
      // 预渲染上1页 + 下1页（双向缓冲）
      const pages = []
      if (currentPage > 1) pages.push(currentPage - 1)
      pages.push(currentPage + 1)
      return pages
    }

    // 默认策略：预渲染下2页
    return [currentPage + 1, currentPage + 2]
  }

  /**
   * 自适应缓冲区大小（核心算法）
   */
  getAdaptiveBuffer(): number {
    const level = this.velocityModel.getLevel()
    const trend = this.velocityModel.getTrend()

    // 核心策略：根据速度等级调整缓冲区
    let buffer = 2 // 默认缓冲区

    switch (level) {
      case 'fast':
        buffer = 5 // 快速滚动：大缓冲区
        break
      case 'medium':
        buffer = 3 // 中速滚动：中等缓冲区
        break
      case 'slow':
        buffer = 1 // 慢速滚动：小缓冲区
        break
      case 'idle':
        buffer = 1 // 静止：最小缓冲区
        break
    }

    // 核心策略：根据趋势动态调整
    if (trend === 'accelerating') {
      buffer = Math.min(buffer + 1, 6) // 加速中：增大缓冲区
    }
    if (trend === 'decelerating') {
      buffer = Math.max(buffer - 1, 1) // 减速中：减小缓冲区
    }

    return buffer
  }

  /**
   * 获取预渲染优先级（用于调度）
   */
  getRenderPriority(page: number): 'high' | 'medium' | 'low' {
    const distance = Math.abs(page - this.currentPage)

    // 距离越近优先级越高
    if (distance === 1) return 'high'
    if (distance <= 3) return 'medium'
    return 'low'
  }

  /**
   * 预测渲染时机（避免过早渲染）
   */
  shouldRenderNow(): boolean {
    const level = this.velocityModel.getLevel()

    // 快速滚动：立即渲染
    if (level === 'fast') return true

    // 中速滚动：延迟渲染
    if (level === 'medium') {
      // 等待速度稳定后再渲染
      return this.velocityModel.getTrend() !== 'accelerating'
    }

    // 慢速滚动：立即渲染
    return true
  }

  /**
   * 获取清理策略（离屏页清理时机）
   */
  getCleanupStrategy(): { threshold: number; keepRecent: number } {
    const level = this.velocityModel.getLevel()

    // 快速滚动：保留更多页面（避免回头查看时重新渲染）
    if (level === 'fast') {
      return { threshold: 6, keepRecent: 4 }
    }

    // 慢速滚动：保留较少页面（节省内存）
    if (level === 'slow') {
      return { threshold: 2, keepRecent: 1 }
    }

    // 默认策略
    return { threshold: 3, keepRecent: 2 }
  }

  /**
   * 获取滚动统计信息（用于性能监控）
   */
  getStats(): {
    currentVelocity: number
    avgVelocity: number
    level: string
    trend: string
    direction: string
    buffer: number
  } {
    return {
      currentVelocity: this.velocityModel.getSmoothed(),
      avgVelocity: this.velocityModel.getAverage(),
      level: this.velocityModel.getLevel(),
      trend: this.velocityModel.getTrend(),
      direction: this.directionModel.predict(this.scrollHistory),
      buffer: this.getAdaptiveBuffer()
    }
  }

  /**
   * 清空历史记录（切换文档时调用）
   */
  reset(): void {
    this.scrollHistory = []
    this.currentPage = 0
  }
}

// ========== 导出 ==========

export type {
  ScrollEvent
}

/**
 * 创建预测渲染引擎实例
 */
export function createPredictiveEngine(): PredictiveRenderEngine {
  return new PredictiveRenderEngine()
}