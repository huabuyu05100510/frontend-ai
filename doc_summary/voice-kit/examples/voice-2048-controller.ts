/**
 * 语音控制2048游戏 - 关键词识别器
 * 
 * 核心能力：
 * 1. 口音容错（拼音模糊匹配）
 * 2. 同音词识别（上/尚/伤）
 * 3. 多表达方式（上/向上/往上）
 * 4. VAD端点检测
 * 5. 防抖节流
 */

import type { ASRResult } from '@voice-kit/core-types';

// ============================================================================
// 1. 命令词表设计
// ============================================================================

interface Command {
  direction: 'up' | 'down' | 'left' | 'right';
  /** 触发回调 */
  action: () => void;
  /** 关键词列表（含口音变体） */
  keywords: string[];
  /** 拼音列表（用于模糊匹配） */
  pinyins: string[];
}

const COMMANDS: Command[] = [
  {
    direction: 'up',
    action: () => console.log('⬆️ 向上滑动'),
    keywords: [
      '上', '向上', '往上', '走上面', '滑上面',
      // 口音变体
      '尚', '伤', '赏', '商',  // shang音
      '桑', '丧',  // sang音（南方口音）
    ],
    pinyins: ['shang', 'sang', 'shan'],
  },
  {
    direction: 'down',
    action: () => console.log('⬇️ 向下滑动'),
    keywords: [
      '下', '向下', '往下', '走下面', '滑下面',
      // 口音变体
      '夏', '吓', '厦',  // xia音
    ],
    pinyins: ['xia', 'ha'],  // ha: 部分方言h/x不分
  },
  {
    direction: 'left',
    action: () => console.log('⬅️ 向左滑动'),
    keywords: [
      '左', '向左', '往左', '走左边', '滑左边',
      // 口音变体
      '作', '坐', '座',  // zuo音
      '昨',  // zuo音
    ],
    pinyins: ['zuo', 'zo', 'zhuo'],  // zo: 儿化音
  },
  {
    direction: 'right',
    action: () => console.log('➡️ 向右滑动'),
    keywords: [
      '右', '向右', '往右', '走右边', '滑右边',
      // 口音变体
      '又', '有', '友', '优',  // you音
    ],
    pinyins: ['you', 'iu'],  // iu: 拼音缩写
  },
];

// ============================================================================
// 2. 拼音转换（简化版，生产环境建议用 pinyin 库）
// ============================================================================

/**
 * 汉字转拼音（简化版，仅覆盖常用词）
 * 生产环境建议使用：import { pinyin } from 'pinyin-pro'
 */
function toPinyin(text: string): string[] {
  const pinyinMap: Record<string, string> = {
    '上': 'shang', '尚': 'shang', '伤': 'shang', '赏': 'shang', '商': 'shang',
    '桑': 'sang', '丧': 'sang',
    '下': 'xia', '夏': 'xia', '吓': 'xia', '厦': 'xia',
    '左': 'zuo', '作': 'zuo', '坐': 'zuo', '座': 'zuo', '昨': 'zuo',
    '右': 'you', '又': 'you', '有': 'you', '友': 'you', '优': 'you',
    '向': 'xiang', '往': 'wang', '走': 'zou', '滑': 'hua',
    '边': 'bian', '面': 'mian',
  };
  
  const result: string[] = [];
  for (const char of text) {
    result.push(pinyinMap[char] || char);
  }
  return result;
}

// ============================================================================
// 3. 模糊匹配算法
// ============================================================================

/**
 * 编辑距离（Levenshtein Distance）
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // 删除
          dp[i][j - 1] + 1,     // 插入
          dp[i - 1][j - 1] + 1  // 替换
        );
      }
    }
  }
  
  return dp[m][n];
}

/**
 * 相似度分数 (0-1)
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - editDistance(a, b) / maxLen;
}

// ============================================================================
// 4. 命令识别器
// ============================================================================

export interface VoiceControllerOptions {
  /** 最小置信度阈值 (0-1) */
  confidenceThreshold?: number;
  /** 冷却时间（毫秒），防止连续触发 */
  cooldownMs?: number;
  /** 是否启用拼音模糊匹配 */
  enablePinyinMatch?: boolean;
  /** 拼音匹配的最小相似度 */
  pinyinSimilarityThreshold?: number;
}

export class Voice2048Controller {
  private options: Required<VoiceControllerOptions>;
  private lastTriggerTime = 0;
  private commandCount = { up: 0, down: 0, left: 0, right: 0 };

  constructor(options: VoiceControllerOptions = {}) {
    this.options = {
      confidenceThreshold: 0.7,
      cooldownMs: 500,
      enablePinyinMatch: true,
      pinyinSimilarityThreshold: 0.6,
      ...options,
    };
  }

  /**
   * 处理ASR识别结果，返回匹配的命令
   */
  process(result: ASRResult): Command | null {
    if (result.kind === 'error') return null;
    
    const text = result.text.trim();
    if (!text) return null;

    // 1. 精确匹配（优先）
    for (const cmd of COMMANDS) {
      for (const keyword of cmd.keywords) {
        if (text.includes(keyword) || keyword.includes(text)) {
          return this.triggerCommand(cmd);
        }
      }
    }

    // 2. 拼音模糊匹配（口音容错）
    if (this.options.enablePinyinMatch) {
      const textPinyins = toPinyin(text);
      const textPinyinStr = textPinyins.join('');
      
      for (const cmd of COMMANDS) {
        for (const cmdPinyin of cmd.pinyins) {
          const sim = similarity(textPinyinStr, cmdPinyin);
          if (sim >= this.options.pinyinSimilarityThreshold) {
            console.log(`[voice] 拼音匹配: "${text}" (${textPinyinStr}) → ${cmd.direction} (相似度: ${sim.toFixed(2)})`);
            return this.triggerCommand(cmd);
          }
        }
      }
    }

    // 3. 部分匹配（文本相似度）
    for (const cmd of COMMANDS) {
      for (const keyword of cmd.keywords) {
        const sim = similarity(text, keyword);
        if (sim >= this.options.confidenceThreshold) {
          console.log(`[voice] 相似度匹配: "${text}" → ${cmd.direction} (相似度: ${sim.toFixed(2)})`);
          return this.triggerCommand(cmd);
        }
      }
    }

    return null;
  }

  /**
   * 触发命令（带冷却检查）
   */
  private triggerCommand(cmd: Command): Command | null {
    const now = Date.now();
    if (now - this.lastTriggerTime < this.options.cooldownMs) {
      console.log(`[voice] 冷却中，跳过: ${cmd.direction}`);
      return null;
    }
    
    this.lastTriggerTime = now;
    this.commandCount[cmd.direction]++;
    cmd.action();
    
    return cmd;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.commandCount };
  }
}

// ============================================================================
// 5. 集成到游戏
// ============================================================================

/**
 * 示例：集成到2048游戏
 */
export function createVoiceGameController(game: {
  moveUp: () => void;
  moveDown: () => void;
  moveLeft: () => void;
  moveRight: () => void;
}) {
  const controller = new Voice2048Controller({
    confidenceThreshold: 0.7,
    cooldownMs: 500,
    enablePinyinMatch: true,
  });

  // 重新绑定action
  COMMANDS.find(c => c.direction === 'up')!.action = game.moveUp;
  COMMANDS.find(c => c.direction === 'down')!.action = game.moveDown;
  COMMANDS.find(c => c.direction === 'left')!.action = game.moveLeft;
  COMMANDS.find(c => c.direction === 'right')!.action = game.moveRight;

  return controller;
}
