# Taobao 翻译布局修复 + "没反馈"排查

**日期**: 2026-06-27
**模型**: claude-sonnet-4-6

## 问题

用户加载扩展后访问 taobao.com，截图显示：
1. **双语挤在同一行**（layout 崩坏）
2. **没看到 FAB 浮球反馈**（不知道扩展是否真工作）

## 根因

### Layout
- taobao 顶部导航是 `display: flex; flex-direction: row; align-items: stretch`
- 原 CSS `.xt-translation { display: block !important }` 强制 block
- **但 taobao flex item 是 `<a>` 元素**，而 `.xt-translation` 是源 `<a>` 内的子 span
- flex 容器内 `display: block` 不够 —— 需要 `flex-basis: 100%` 才能让该 span 强制换行

### "没反馈"
- 排查后扩展加载本身**没问题**（manifest 字段全对、SW 加载成功、CSS/JS hash 都对）
- **最大可能**：用户在 chrome://extensions 没看到扩展报错，但**没刷新页面**就触发翻译
- 截图本身**证明扩展工作了**（双语都注入了）—— 只是 layout 错

## 修复

### 1. content.css（W3.1）
```css
.xt-translation {
  display: block !important;
  width: 100%;
  clear: both;
  flex-basis: 100% !important;  /* ← 关键：flex 容器强制换行 */
  /* ... */
}
```

### 2. 重新 build
- `npm run build` → content.ts hash 变 `BDQXwr2Q`、CSS hash 变 `a0vf_AyL`
- manifest.json 自动更新到新 hash

## 用户排查步骤（30 秒）

1. `chrome://extensions` → 找到"智能网页翻译" → 点 ↻ 刷新按钮
2. 强制刷新 taobao.com（Cmd+Shift+R 或 Ctrl+Shift+R）
3. 看页面右下角 → **应该出现蓝色 FAB 浮球**（48px 圆形，地球仪图标）
4. 点 FAB 浮球 → **触发翻译**
5. 翻译完成后 → 看双语是否**各自独立换行**

## 如果还看不到 FAB

打开 DevTools Console（F12）→ 执行：
```javascript
// 检查 content script 是否注入
console.log('xt-fab-host:', document.getElementById('xt-fab-host'))
console.log('data-xt-id 数:', document.querySelectorAll('[data-xt-id]').length)
console.log('xt-translation 数:', document.querySelectorAll('.xt-translation').length)
```

- 都返回 0 → content script 没注入 → 看 Console 报错
- 返回 >0 → content script 跑了，看 FAB 浮球是否在视野外
