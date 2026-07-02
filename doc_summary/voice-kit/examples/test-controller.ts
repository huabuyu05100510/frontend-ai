/**
 * 测试语音命令识别器
 * 
 * 运行: npx tsx examples/test-controller.ts
 */

// 模拟 ASRResult 类型
type ASRResult = 
  | { kind: 'partial'; text: string; ts: number }
  | { kind: 'final'; text: string; ts: number }
  | { kind: 'error'; code: string; message?: string };

// ============================================================================
// 简化版识别器（不依赖外部包）
// ============================================================================

interface Command {
  direction: 'up' | 'down' | 'left' | 'right';
  keywords: string[];
  pinyins: string[];
}

const COMMANDS: Command[] = [
  {
    direction: 'up',
    keywords: ['上', '向上', '往上', '走上面', '滑上面', '尚', '伤', '赏', '商', '桑', '丧'],
    pinyins: ['shang', 'sang', 'shan'],
  },
  {
    direction: 'down',
    keywords: ['下', '向下', '往下', '走下面', '滑下面', '夏', '吓', '厦'],
    pinyins: ['xia', 'ha'],
  },
  {
    direction: 'left',
    keywords: ['左', '向左', '往左', '走左边', '滑左边', '作', '坐', '座', '昨'],
    pinyins: ['zuo', 'zo', 'zhuo'],
  },
  {
    direction: 'right',
    keywords: ['右', '向右', '往右', '走右边', '滑右边', '又', '有', '友', '优'],
    pinyins: ['you', 'iu'],
  },
];

const pinyinMap: Record<string, string> = {
  '上': 'shang', '尚': 'shang', '伤': 'shang', '赏': 'shang', '商': 'shang',
  '桑': 'sang', '丧': 'sang',
  '下': 'xia', '夏': 'xia', '吓': 'xia', '厦': 'xia',
  '左': 'zuo', '作': 'zuo', '坐': 'zuo', '座': 'zuo', '昨': 'zuo',
  '右': 'you', '又': 'you', '有': 'you', '友': 'you', '优': 'you',
  '向': 'xiang', '往': 'wang', '走': 'zou', '滑': 'hua',
};

function toPinyin(text: string): string {
  return Array.from(text).map(c => pinyinMap[c] || c).join('');
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] 
        ? dp[i-1][j-1] 
        : Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1;
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - editDistance(a, b) / maxLen;
}

class SimpleVoiceController {
  private lastTriggerTime = 0;
  private cooldownMs = 500;
  private stats = { up: 0, down: 0, left: 0, right: 0 };

  process(result: ASRResult): Command | null {
    if (result.kind === 'error') return null;
    const text = result.text.trim();
    if (!text) return null;

    // 1. 精确匹配
    for (const cmd of COMMANDS) {
      for (const keyword of cmd.keywords) {
        if (text.includes(keyword) || keyword.includes(text)) {
          return this.trigger(cmd, text, '精确匹配');
        }
      }
    }

    // 2. 拼音匹配
    const textPinyin = toPinyin(text);
    for (const cmd of COMMANDS) {
      for (const cmdPinyin of cmd.pinyins) {
        const sim = similarity(textPinyin, cmdPinyin);
        if (sim >= 0.6) {
          return this.trigger(cmd, text, `拼音匹配(${textPinyin}≈${cmdPinyin}, sim=${sim.toFixed(2)})`);
        }
      }
    }

    // 3. 相似度匹配
    for (const cmd of COMMANDS) {
      for (const keyword of cmd.keywords) {
        const sim = similarity(text, keyword);
        if (sim >= 0.7) {
          return this.trigger(cmd, text, `相似度匹配(${text}≈${keyword}, sim=${sim.toFixed(2)})`);
        }
      }
    }

    return null;
  }

  private trigger(cmd: Command, input: string, method: string): Command | null {
    const now = Date.now();
    if (now - this.lastTriggerTime < this.cooldownMs) {
      console.log(`  ⏸️  冷却中，跳过: ${cmd.direction}`);
      return null;
    }
    this.lastTriggerTime = now;
    this.stats[cmd.direction]++;
    console.log(`  ✅ 触发: ${cmd.direction.padEnd(5)} (${method})`);
    return cmd;
  }

  getStats() {
    return { ...this.stats };
  }
}

// ============================================================================
// 测试用例
// ============================================================================

console.log('='.repeat(60));
console.log('  语音命令识别测试 - 口音容错');
console.log('='.repeat(60));
console.log();

const controller = new SimpleVoiceController();

const testCases = [
  // 标准表达
  { text: '上', desc: '标准单字' },
  { text: '向上', desc: '标准表达' },
  { text: '往上', desc: '口语表达' },
  
  // 口音变体
  { text: '尚', desc: '同音词(shang)' },
  { text: '桑', desc: '南方口音(sang)' },
  { text: '丧', desc: '四川口音(sang)' },
  
  // 左方向
  { text: '左', desc: '标准单字' },
  { text: '作', desc: '同音词(zuo)' },
  { text: '坐', desc: '同音词(zuo)' },
  
  // 右方向
  { text: '右', desc: '标准单字' },
  { text: '又', desc: '同音词(you)' },
  { text: '有', desc: '同音词(you)' },
  
  // 下方向
  { text: '下', desc: '标准单字' },
  { text: '夏', desc: '同音词(xia)' },
  
  // 连续测试（冷却）
  { text: '上', desc: '连续测试1' },
  { text: '上', desc: '连续测试2(冷却)' },
  { text: '左', desc: '连续测试3' },
];

for (const { text, desc } of testCases) {
  console.log(`输入: "${text}" (${desc})`);
  const result: ASRResult = { kind: 'partial', text, ts: Date.now() };
  controller.process(result);
}

console.log();
console.log('='.repeat(60));
console.log('  统计结果');
console.log('='.repeat(60));
console.log(controller.getStats());
