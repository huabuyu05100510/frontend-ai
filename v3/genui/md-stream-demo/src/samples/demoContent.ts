/** 覆盖大多数场景的样例 Markdown：标题/列表/任务/表格/代码/引用/卡片混排 */
export const DEMO_CONTENT = `# 上海 · 周末一日游推荐

你好！我帮你规划了一条 **上海经典一日游** 路线，包含 \`地图卡片\`、天气、餐厅与购物推荐，可直接点击导航。下面边生成边展示～

## 🌤️ 今日天气

\`\`\`weather
{
  "city": "上海",
  "temp": 24,
  "desc": "多云转晴",
  "icon": "⛅",
  "high": 27,
  "low": 19,
  "humidity": 62,
  "wind": "东南风 3 级",
  "forecast": [
    { "day": "周六", "icon": "☀️", "high": 27, "low": 19 },
    { "day": "周日", "icon": "🌦️", "high": 25, "low": 18 },
    { "day": "周一", "icon": "☁️", "high": 23, "low": 17 }
  ]
}
\`\`\`

> 出行建议：白天舒适，傍晚转凉，建议带一件薄外套。

## 📍 路线安排

行程按以下顺序展开：

1. **上午** — 外滩看万国建筑
2. **中午** — 南京路步行街午餐
3. **下午** — 豫园 + 城隍庙
4. **傍晚** — 陆家嘴看夜景

### 第一站：外滩

\`\`\`amap
{
  "name": "外滩",
  "address": "上海市黄浦区中山东一路",
  "lng": 121.490317,
  "lat": 31.236305,
  "rating": 4.8,
  "distance": "距人民广场 1.6km",
  "tel": "021-63230000",
  "tags": ["地标", "夜景", "免费", "拍照圣地"]
}
\`\`\`

### 第二站：豫园

\`\`\`amap
{
  "name": "豫园",
  "address": "上海市黄浦区安仁街137号",
  "lng": 121.492305,
  "lat": 31.227141,
  "rating": 4.6,
  "distance": "距外滩 2.1km",
  "tags": ["园林", "古建筑", "小吃"]
}
\`\`\`

## 🍜 午餐推荐

| 餐厅 | 人均 | 招牌菜 | 评分 |
|------|-----:|--------|:----:|
| 南翔馒头店 | ¥60 | 蟹粉小笼 | 4.5 |
| 绿波廊 | ¥180 | 本帮菜 | 4.7 |
| 沈大成 | ¥35 | 青团/糕点 | 4.4 |

## 🛍️ 购物种草

\`\`\`product
{
  "name": "上海特产 · 大白兔奶糖礼盒",
  "price": 49,
  "originalPrice": 69,
  "image": "https://picsum.photos/seed/rabbit/400/300",
  "rating": 4.9,
  "sales": 12800,
  "tags": ["伴手礼", "限时 7 折"]
}
\`\`\`

## 📊 行程数据概览

\`\`\`stat
{
  "title": "本次行程",
  "items": [
    { "label": "总里程", "value": "8.4km", "delta": "步行为主", "up": true },
    { "label": "预计花费", "value": "¥320", "delta": "12%", "up": false },
    { "label": "景点", "value": "4 个" },
    { "label": "用时", "value": "约 9h" }
  ]
}
\`\`\`

## 🔗 实用链接

\`\`\`card
{
  "title": "上海地铁出行指南",
  "icon": "🚇",
  "desc": "覆盖全市 20 条线路，扫码即可乘车。建议下载 Metro 大都会 App。",
  "tags": ["交通", "省钱"],
  "link": { "text": "查看地铁线路图", "url": "https://www.shmetro.com" }
}
\`\`\`

## 💻 给开发者：如何生成这样的卡片

A2UI 把卡片表示为带语言标记的围栏块，渲染器拦截后映射为组件：

\`\`\`typescript
// 围栏语言 → 卡片组件
const CARD_LANGS = ['card', 'amap', 'weather', 'product', 'stat'];

function renderFence(lang: string, body: string) {
  if (CARD_LANGS.includes(lang)) {
    const data = JSON.parse(body);     // 流式半截时解析失败 → 显示骨架
    return <Card type={lang} data={data} />;
  }
  return <CodeBlock lang={lang} code={body} />;
}
\`\`\`

- [x] 天气卡
- [x] 高德地图卡
- [x] 商品卡 / 统计卡 / 信息卡
- [ ] 视频卡（下个迭代）

---

祝你玩得开心！有需要可以点击任意段落右上角 **复制本段**，或顶部 **分享** 整篇行程 🎉
`;
