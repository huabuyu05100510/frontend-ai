/**
 * 行中导游真实场景 benchmark。
 *
 * 两层指标：
 *   1. routeEngine（同步、确定性）—— 围栏相交状态机在 35 POI × 100 采样点下的耗时
 *      无外部依赖，每次运行可重复，用作 SDK 协议层 baseline。
 *   2. LLM 流式生成（可选）—— 真实调 LLM API，采集 TTFT / 完整生成时间 / token/s
 *      需要 .env.local 或环境变量 VITE_LLM_PROVIDER / VITE_LLM_API_KEY
 *
 * 用法：
 *   pnpm bench                         # 仅 routeEngine
 *   pnpm bench -- --llm                # 跑 LLM（默认 3 轮）
 *   pnpm bench -- --llm --iters 5      # 跑 LLM 5 轮
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  newReport,
  addLatency,
  addMetric,
  reportToMarkdown,
} from '@a2ui-stream/bench';
import { createTravelGuideProvider } from '../src/guideStream.js';
import { consumeStream } from '@a2ui-stream/core';
import { sampleRoute, filterAlongRoute } from '../src/routeEngine.js';
import { BEIJING_POIS } from '../src/poiDataset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');

// ============================================================
// CLI
// ============================================================
const argv = process.argv.slice(2);
const runLlm = argv.includes('--llm');
const itersIdx = argv.indexOf('--iters');
const llmIters = itersIdx >= 0 && argv[itersIdx + 1] ? parseInt(argv[itersIdx + 1], 10) : 3;
const providerName = process.env.VITE_LLM_PROVIDER?.trim();
const apiKey = process.env.VITE_LLM_API_KEY?.trim();
const modelName = process.env.VITE_LLM_MODEL?.trim();

const ROUTES = [
  {
    id: 'guomao_summerpalace',
    name: '国贸 → 颐和园',
    startName: '国贸',
    endName: '颐和园',
    start: { lng: 116.4644, lat: 39.9089 },
    end: { lng: 116.295, lat: 39.9999 },
  },
  {
    id: 'tiananmen_zhongguancun',
    name: '天安门 → 中关村',
    startName: '天安门',
    endName: '中关村',
    start: { lng: 116.39745, lat: 39.90872 },
    end: { lng: 116.3172, lat: 39.9838 },
  },
  {
    id: 'beihai_birdnest',
    name: '北海公园 → 鸟巢',
    startName: '北海公园',
    endName: '鸟巢',
    start: { lng: 116.3893, lat: 39.9255 },
    end: { lng: 116.3972, lat: 39.9929 },
  },
];

// ============================================================
// 统计
// ============================================================
function statsFrom(samples) {
  if (samples.length === 0)
    return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, unit: 'ms' };
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    count: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    max: sorted[sorted.length - 1],
    unit: 'ms',
  };
}

// ============================================================
// Layer 1: routeEngine
// ============================================================
function benchRouteEngine() {
  const samples = [];
  // warmup
  for (let i = 0; i < 5; i++) {
    const path = sampleRoute(ROUTES[0].start, ROUTES[0].end, 100);
    filterAlongRoute(path, BEIJING_POIS);
  }
  for (const route of ROUTES) {
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const path = sampleRoute(route.start, route.end, 100);
      const passed = filterAlongRoute(path, BEIJING_POIS);
      samples.push({
        route: route.name,
        ms: performance.now() - t0,
        hits: passed.length,
        pathLen: path.length,
      });
    }
  }
  return samples;
}

// ============================================================
// Layer 2: SDK 完整流程（含 LLM）
// ============================================================
async function benchFullPipeline(iters) {
  const llmConfig = pickLlmConfig(providerName, apiKey, modelName);
  if (!llmConfig) {
    throw new Error(
      '未配置 LLM。请设置 VITE_LLM_PROVIDER / VITE_LLM_API_KEY 环境变量。',
    );
  }

  const route = ROUTES[0];
  const sdkTtftSamples = [];
  const llmTtftSamples = [];
  const totalMsSamples = [];
  const tokenRateSamples = [];
  const charSamples = [];

  for (let i = 0; i < iters; i++) {
    const provider = createTravelGuideProvider({
      start: route.start,
      end: route.end,
      startName: route.startName,
      endName: route.endName,
      samples: 100,
      llm: llmConfig,
    });

    const t0 = performance.now();
    let tFirstDelta = null;          // SDK 层首字（含路线计算瞬时文本）
    let tLlmStartMarker = null;     // 看到 t_llm_start 的时间
    let tLlmFirstToken = null;      // LLM 真正第一个 token 到达
    let chars = 0;
    let lastDeltaT = t0;

    await consumeStream(provider.stream({ messages: [] }), {
      onPart: (_state, part) => {
        if (part.type === 'text-delta') {
          const now = performance.now();
          if (tFirstDelta === null) tFirstDelta = now;
          if (part.id === 't_llm_start') tLlmStartMarker = now;
          else if (tLlmStartMarker !== null && tLlmFirstToken === null) {
            tLlmFirstToken = now;
          }
          chars += part.text.length;
          lastDeltaT = now;
        }
      },
    });

    const totalMs = performance.now() - t0;
    const sdkTtft = tFirstDelta !== null ? tFirstDelta - t0 : totalMs;
    const llmTtft = tLlmFirstToken !== null ? tLlmFirstToken - t0 : totalMs;
    // 速率 = LLM 内容字符 / 实际流式时间（从首个 LLM token 到最后一个 delta）
    const llmStreamMs = tLlmFirstToken !== null ? lastDeltaT - tLlmFirstToken : 0;
    const llmChars = chars;
    const tokensApprox = llmChars / 1.5;
    // 防 div-by-zero：流式时间 < 50ms 视为突发返回，速率不可信，标 null
    const ratePerSec = llmStreamMs >= 50 ? (tokensApprox / llmStreamMs) * 1000 : null;

    sdkTtftSamples.push(sdkTtft);
    llmTtftSamples.push(llmTtft);
    totalMsSamples.push(totalMs);
    if (ratePerSec !== null) tokenRateSamples.push(ratePerSec);
    charSamples.push(llmChars);
    console.log(
      `  [round ${i + 1}/${iters}] SDK-TTFT=${sdkTtft.toFixed(0)}ms LLM-TTFT=${llmTtft.toFixed(0)}ms total=${totalMs.toFixed(0)}ms chars=${llmChars}${ratePerSec !== null ? ` ~tok/s=${ratePerSec.toFixed(1)}` : ' (rate skipped: burst)'}`,
    );
  }

  return { sdkTtftSamples, llmTtftSamples, totalMsSamples, tokenRateSamples, charSamples };
}

function pickLlmConfig(provider, key, model) {
  if (!provider || !key) return null;
  const cfg = {
    minimax: { baseUrl: 'https://api.minimaxi.com/v1', model: model || 'MiniMax-Text-01' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: model || 'deepseek-chat' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: model || 'gpt-4o-mini' },
    qwen: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: model || 'qwen-plus',
    },
  };
  const c = cfg[provider];
  if (!c) return null;
  return { apiKey: key, ...c, providerName: provider };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const report = newReport('行中导游 · @a2ui-stream/core 真实场景', [
    'Layer 1 routeEngine：35 北京真实 POI × 100 采样点，围栏相交状态机',
    runLlm
      ? `Layer 2 LLM 流式：${providerName} ${modelName || '(默认模型)'}，${llmIters} 轮真实调用`
      : 'Layer 2 LLM 流式：未启用（用 --llm 启用）',
  ]);

  console.log('\n[Layer 1] routeEngine benchmark（50 iter × 3 路线）...');
  const routeSamples = benchRouteEngine();
  const routeMs = routeSamples.map((s) => s.ms);
  const stats = statsFrom(routeMs);
  addLatency(report, 'routeEngine: 35 POI × 100 点 / 次', stats);
  const avgHits = routeSamples.reduce((a, b) => a + b.hits, 0) / routeSamples.length;
  addMetric(report, {
    name: 'routeEngine 平均命中景点数',
    value: Number(avgHits.toFixed(2)),
    unit: '个',
    description: `每条路线沿途景点数（${ROUTES.length} 条路线均值）`,
  });
  addMetric(report, {
    name: 'routeEngine P95 耗时',
    value: Number(stats.p95.toFixed(3)),
    unit: 'ms',
    description: '围栏相交状态机 P95（< 5ms 达标）',
  });
  console.log(
    `  routeEngine P50=${stats.p50.toFixed(3)}ms P95=${stats.p95.toFixed(3)}ms max=${stats.max.toFixed(3)}ms 均值命中=${avgHits.toFixed(1)}`,
  );

  if (runLlm) {
    console.log(`\n[Layer 2] LLM 流式生成（${llmIters} 轮真实调用）...`);
    const r = await benchFullPipeline(llmIters);
    addLatency(report, 'SDK TTFT（首字时间，含路线计算瞬时文本）', statsFrom(r.sdkTtftSamples));
    addLatency(report, 'LLM TTFT（首个 AI token 到达）', statsFrom(r.llmTtftSamples));
    addLatency(report, '完整生成时间', statsFrom(r.totalMsSamples));
    const avgRate = r.tokenRateSamples.reduce((a, b) => a + b, 0) / r.tokenRateSamples.length;
    const avgChars = r.charSamples.reduce((a, b) => a + b, 0) / r.charSamples.length;
    addMetric(report, {
      name: 'LLM 吞吐（估算 token/s）',
      value: Number(avgRate.toFixed(1)),
      unit: 'tok/s',
      description: '中文按 ~1.5 char/token 粗估，仅作相对比较',
    });
    addMetric(report, {
      name: '平均生成字符数',
      value: Math.round(avgChars),
      unit: 'char',
      description: '单次剧本生成的平均字符数',
    });
    addMetric(report, {
      name: 'SDK 架构增益',
      value: Number(
        (
          (r.llmTtftSamples.reduce((a, b) => a + b, 0) /
            r.llmTtftSamples.length -
            r.sdkTtftSamples.reduce((a, b) => a + b, 0) /
              r.sdkTtftSamples.length) /
          (r.llmTtftSamples.reduce((a, b) => a + b, 0) / r.llmTtftSamples.length)
        ).toFixed(3),
      ),
      unit: 'ratio',
      description: 'SDK 让用户少等的首字等待占比（越接近 1 越好）',
    });
  }

  const outDir = resolve(appRoot, 'bench');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'bench-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(outDir, 'bench-report.md'), reportToMarkdown(report));
  console.log(`\n✅ 写入 ${outDir}/bench-report.{json,md}`);
  console.log('\n' + reportToMarkdown(report));
}

main().catch((e) => {
  console.error('bench failed:', e);
  process.exit(1);
});
