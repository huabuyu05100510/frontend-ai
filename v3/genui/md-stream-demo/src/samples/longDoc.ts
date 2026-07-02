/**
 * 超长文档生成器 —— 模拟「真实后端」吐出的长篇 Markdown，用于压测：
 *  增量内核（O(尾块) + 离屏虚拟化） vs 记忆化（每 token 重切全文） vs 朴素（整篇重渲）。
 * 内容确定性（无随机），保证三模式对比的是同一份文本。
 */
const TOPICS = [
  '流式解析',
  '块级记忆化',
  '投机闭合',
  '离屏虚拟化',
  '增量切块',
  '零信任渲染',
  '设计令牌',
  '可观测性',
  '回压控制',
  '约束解码',
];

function statCard(i: number): string {
  return `\`\`\`stat
{
  "title": "第 ${i} 段 · 实时指标",
  "items": [
    { "label": "常驻DOM", "value": "恒定", "delta": "0%", "up": true },
    { "label": "尾块解析", "value": "O(1)", "delta": "↓", "up": true },
    { "label": "朴素重渲", "value": "O(n)", "delta": "↑", "up": false },
    { "label": "掉帧", "value": "0", "delta": "0%", "up": true }
  ]
}
\`\`\``;
}

/** 生成 sections 个小节的长文（默认 160 节，约 40KB+） */
export function generateLongDoc(sections = 160): string {
  const out: string[] = [];
  out.push('# 超长文档压测 · 增量内核 + 块级虚拟化');
  out.push(
    `本文用于对比 **增量内核 / 记忆化 / 朴素** 三种渲染在长文档流式下的表现。共 ${sections} 个小节，混排标题、段落、列表、表格、代码与卡片。\n\n滚动时观察性能面板的「**常驻块(DOM)**」——增量内核应保持**恒定**，而朴素/记忆化随文档线性增长。`,
  );

  for (let i = 1; i <= sections; i++) {
    const t = TOPICS[i % TOPICS.length];
    out.push(`## ${i}. ${t}`);
    out.push(
      `这是第 ${i} 个小节，主题「**${t}**」。流式渲染中，已完成段落被冻结为 \`final\`，内容指纹（hash）稳定，后续 token 到达时**完全跳过重渲**；滚出视口后被虚拟化为等高占位，DOM 节点数与可见区相关，而非与文档长度相关。`,
    );

    switch (i % 6) {
      case 0:
        out.push(`- 要点 A：仅解析新增 \`delta\`，复杂度 **O(尾块)**\n- 要点 B：完成块零重渲\n- 要点 C：离屏占位，常驻内存恒定`);
        break;
      case 1:
        out.push(`\`\`\`ts\n// 第 ${i} 段：尾块增量\nseg.push(delta);\nconst segs = seg.getSegments(); // 前缀 final + 末尾 active\n\`\`\``);
        break;
      case 2:
        out.push(`| 指标 | 增量内核 | 记忆化 | 朴素 |\n| --- | ---: | ---: | ---: |\n| 每token解析 | O(尾块) | O(n) | O(n) |\n| 重渲范围 | 尾块 | 尾块 | 整篇 |\n| 常驻DOM | 恒定 | 线性 | 线性 |`);
        break;
      case 3:
        out.push(`> 提示（第 ${i} 节）：把 \`splitBlocks(全文)\` 换成 \`segmenter.push(delta)\`，是 O(n²) → O(n) 的关键一步。`);
        break;
      case 4:
        out.push(`普通段落 ${i}：当文档达到数百块时，朴素模式每个 token 都要重解析并重渲全文，主线程被长任务占满；增量内核把工作量收敛到尾块，配合虚拟化让滚动始终跟手（60FPS）。`);
        break;
      default:
        out.push(`### ${i}.1 小结\n\n第 ${i} 节强调：**渲染与解析分离**、**完成即冻结**、**离屏即回收**。三者叠加，长文档流式也能保持首屏快、滚动稳、内存平。`);
    }

    if (i % 40 === 0) out.push(statCard(i));
  }

  out.push('---');
  out.push('> 压测结束。点击右侧性能面板「⚡ 跑对比」可一次性串跑三模式，直观看到「累计渲染 / 最大单帧 / 掉帧 / 常驻DOM」的差距。');
  return out.join('\n\n');
}
