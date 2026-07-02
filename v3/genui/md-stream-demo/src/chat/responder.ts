import { DEMO_CONTENT } from '../samples/demoContent';
import { generateLongDoc } from '../samples/longDoc';

/**
 * 离线「Agent」：按意图返回流式 Markdown（含卡片）。
 * 真实接入时，这里替换为 SSE/streamAppend 的服务端响应即可，渲染层不变。
 */
export function respond(prompt: string, turnIndex: number): string {
  if (/(超长|长文|压测|压力|虚拟化|很长|大文档|长文档|benchmark|stress)/i.test(prompt)) {
    return generateLongDoc(160);
  }

  if (/(地图|导航|景点|路线|一日游|去哪|玩|旅游|上海|外滩|豫园)/.test(prompt)) {
    return DEMO_CONTENT;
  }

  if (/(天气|气温|下雨|温度|weather)/.test(prompt)) {
    return weather(prompt);
  }

  if (/(买|购物|商品|推荐.*礼|product|价格|多少钱)/.test(prompt)) {
    return product();
  }

  if (/(代码|怎么写|实现|code|函数|组件)/.test(prompt)) {
    return code();
  }

  if (/(数据|统计|对比|报表|增长|指标)/.test(prompt)) {
    return stats();
  }

  return generic(prompt, turnIndex);
}

function weather(prompt: string): string {
  const city = (prompt.match(/([\u4e00-\u9fa5]{2,4})(?:的)?天气/) ?? [])[1] ?? '北京';
  return `好的，这是 **${city}** 的实时天气：

\`\`\`weather
{
  "city": "${city}",
  "temp": 21,
  "desc": "晴",
  "icon": "☀️",
  "high": 25,
  "low": 14,
  "humidity": 38,
  "wind": "西北风 2 级",
  "forecast": [
    { "day": "今天", "icon": "☀️", "high": 25, "low": 14 },
    { "day": "明天", "icon": "⛅", "high": 23, "low": 13 },
    { "day": "后天", "icon": "🌧️", "high": 19, "low": 11 }
  ]
}
\`\`\`

> 体感舒适，紫外线较强，外出注意防晒。需要我再推荐附近的**室内/室外**去处吗？`;
}

function product(): string {
  return `根据你的偏好，挑了一款高性价比好物：

\`\`\`product
{
  "name": "Anker 65W 氮化镓充电器 三口快充",
  "price": 129,
  "originalPrice": 199,
  "image": "https://picsum.photos/seed/charger/400/300",
  "rating": 4.8,
  "sales": 56000,
  "tags": ["限时立减", "一充多设备"]
}
\`\`\`

要点：

- 体积小，**一个口顶三个**，出差只带一个
- 支持笔记本 / 手机 / 平板同时充
- 想看**同价位对比**或其他品类，直接告诉我～`;
}

function code(): string {
  return `这是「流式 Markdown 块级记忆化渲染」的核心片段：

\`\`\`typescript
// 仅最后一块可能在变化：完成块用内容 hash 记忆化，零重渲
function StreamingMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={b.hash} block={b} streaming={i === blocks.length - 1} />
      ))}
    </>
  );
}

const Block = memo(
  ({ block }) => <Markdown>{block.text}</Markdown>,
  (a, b) => a.block.hash === b.block.hash, // hash 不变 → 跳过重渲
);
\`\`\`

- [x] 块级切分（围栏感知）
- [x] 内容 hash 记忆化
- [ ] KaTeX / Mermaid（下个迭代）

需要我解释 **autoClose 虚拟补全** 的实现吗？`;
}

function stats(): string {
  return `这是本周核心指标概览：

\`\`\`stat
{
  "title": "本周数据",
  "items": [
    { "label": "活跃用户", "value": "12.4w", "delta": "8.3%", "up": true },
    { "label": "转化率", "value": "3.7%", "delta": "0.5%", "up": true },
    { "label": "客单价", "value": "¥186", "delta": "2.1%", "up": false },
    { "label": "退款率", "value": "1.2%", "delta": "0.3%", "up": false }
  ]
}
\`\`\`

| 渠道 | 占比 | 环比 |
|------|-----:|:----:|
| 自然流量 | 42% | ▲ |
| 付费投放 | 33% | ▲ |
| 私域 | 25% | ▼ |

要不要我对某个渠道**下钻分析**？`;
}

function generic(prompt: string, turnIndex: number): string {
  const hint = turnIndex > 0 ? '（已结合上文）' : '';
  return `收到你的问题 ${hint}：**${escapeInline(prompt)}**

我可以用**富文本 + 卡片**的方式回答，试试这些指令看看效果：

\`\`\`card
{
  "title": "你可以这样问我",
  "icon": "💡",
  "desc": "下面每一类都会触发不同的卡片与排版，体验流式生成。",
  "tags": ["地图", "天气", "购物", "代码", "数据"],
  "link": { "text": "查看方案文档", "url": "https://docs.ag-ui.com" }
}
\`\`\`

- 「**上海一日游路线**」→ 高德地图卡 + 行程表
- 「**北京天气**」→ 天气卡 + 预报
- 「**推荐个充电器**」→ 商品卡
- 「**这段代码怎么写**」→ 代码高亮
- 「**本周数据对比**」→ 统计卡 + 表格

> 历史记录会自动保存，随时可以从左侧切换会话**继续多轮对话**。`;
}

function escapeInline(s: string): string {
  return s.replace(/[*_`[\]]/g, '\\$&').slice(0, 120);
}
