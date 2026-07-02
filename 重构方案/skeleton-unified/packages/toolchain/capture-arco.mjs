import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const outDir = '/tmp/arco-bones';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });

// 登录
await pg.goto('https://react-pro.arco.design/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await pg.waitForTimeout(2000);
await pg.fill('input[placeholder*="Username"]', 'admin');
await pg.fill('input[type="password"]', 'admin');
await pg.press('input[type="password"]', 'Enter');
await pg.waitForTimeout(3000);

// 导航到多维数据分析页面
await pg.goto('https://react-pro.arco.design/visualization/multi-dimension-data-analysis', { waitUntil: 'domcontentloaded', timeout: 30000 });
await pg.waitForTimeout(5000);

console.log('Page loaded:', pg.url());

// 注入 snapshot 脚本
await pg.addInitScript(() => {
  function toPercent(v, base) { return base > 0 ? Math.round(v / base * 10000) / 100 : 0; }
  function parseR(s, rect) {
    const tl = parseFloat(s.borderTopLeftRadius) || 0;
    const tr = parseFloat(s.borderTopRightRadius) || 0;
    const br = parseFloat(s.borderBottomRightRadius) || 0;
    const bl = parseFloat(s.borderBottomLeftRadius) || 0;
    if (!tl && !tr && !br && !bl) return undefined;
    const max = Math.max(tl, tr, br, bl);
    if (max > 9998) return Math.abs(rect.width - rect.height) < 4 ? '50%' : 9999;
    if (tl === tr && tr === br && br === bl) return tl;
    return `${tl}px ${tr}px ${br}px ${bl}px`;
  }
  const ATOMIC = new Set(['img', 'svg', 'video', 'audio', 'canvas', 'input', 'button', 'textarea', 'select', 'pre']);
  const LEAF = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th']);
  window.__SKE_SNAPSHOT = function (el, name) {
    const rr = el.getBoundingClientRect();
    const rw = rr.width;
    const rh = rr.height;
    const bones = [];
    function walk(n) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return;
      const tag = n.tagName.toLowerCase();
      const ch = Array.from(n.children).filter(function (c) {
        const cs = getComputedStyle(c);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      });
      const leaf = ch.length === 0 || ATOMIC.has(tag) || LEAF.has(tag);
      const rect = n.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const x = toPercent(rect.left - rr.left, rw);
      const y = toPercent(rect.top - rr.top, rh);
      const w = toPercent(rect.width, rw);
      const h = toPercent(rect.height, rh);
      const r = parseR(s, rect);
      const fixed = s.flexShrink === '0' || rect.width < rw * 0.4;
      if (leaf) {
        const b = [x, y, w, h];
        if (r !== undefined) b.push(r);
        if (fixed) { while (b.length < 6) b.push(undefined); b.push(w, w); }
        var e = b.length - 1;
        while (e >= 4 && b[e] === undefined) e--;
        bones.push(b.slice(0, e + 1));
        return;
      }
      const bg = s.backgroundColor;
      const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const bw = parseFloat(s.borderTopWidth) || 0;
      const hasBorder = bw > 0 && s.borderTopColor !== 'rgba(0, 0, 0, 0)';
      const hasBr = (parseFloat(s.borderTopLeftRadius) || 0) > 0;
      if (hasBg || s.backgroundImage !== 'none' || (hasBorder && hasBr)) {
        const b = [x, y, w, h];
        if (r !== undefined) b.push(r);
        b.push(true);
        var e2 = b.length - 1;
        while (e2 >= 4 && b[e2] === undefined) e2--;
        bones.push(b.slice(0, e2 + 1));
      }
      for (var i = 0; i < ch.length; i++) walk(ch[i]);
    }
    for (var j = 0; j < el.children.length; j++) walk(el.children[j]);
    return {
      name: name,
      aspectRatio: rh > 0 ? Math.round(rw / rh * 1000) / 1000 : 1,
      capturedWidth: Math.round(rw),
      bones: bones,
      version: 2,
      capturedAt: Date.now(),
      platform: 'web',
    };
  };
});

// 由于 addInitScript 只对新页面生效，重新导航触发注入
await pg.goto('https://react-pro.arco.design/visualization/multi-dimension-data-analysis', { waitUntil: 'domcontentloaded', timeout: 30000 });
await pg.waitForTimeout(5000);

// 分析页面找可捕获的卡片组件
const targets = await pg.evaluate(function () {
  var cards = document.querySelectorAll('.arco-card');
  return Array.from(cards).slice(0, 8).map(function (card, i) {
    var r = card.getBoundingClientRect();
    var header = card.querySelector('.arco-card-header, [class*="title"], [class*="Title"]');
    var text = header ? header.textContent.trim().slice(0, 30) : (card.textContent || '').trim().slice(0, 30);
    return { index: i, text: text, w: Math.round(r.width), h: Math.round(r.height) };
  });
});

console.log('Arco cards found:', JSON.stringify(targets, null, 2));

// 捕获每个卡片
const capturedNames = [];
for (var i = 0; i < targets.length; i++) {
  var t = targets[i];
  if (t.w < 100 || t.h < 50) continue;

  var name = t.text
    ? 'arco-' + t.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    : 'arco-card-' + i;

  var data = await pg.evaluate(function (opts) {
    var cards = document.querySelectorAll('.arco-card');
    var card = cards[opts.index];
    if (!card) return null;
    return window.__SKE_SNAPSHOT(card, opts.name);
  }, { index: t.index, name: name });

  if (data && data.bones.length >= 2) {
    writeFileSync(outDir + '/' + name + '.bones.json', JSON.stringify(data, null, 2));
    console.log('  Captured: ' + name + ' (' + t.w + 'x' + t.h + ') - ' + data.bones.length + ' bones');
    capturedNames.push(name);
  }
}

// 也捕获统计值卡片（Overview 下面的那些 KPI cards）
var statResult = await pg.evaluate(function () {
  // 找 "Content production" 这类统计值所在的div
  var allEls = document.querySelectorAll('[class*="Statistic"], [class*="statistic"]');
  var results = [];
  var cards = Array.from(allEls);
  for (var i = 0; i < Math.min(cards.length, 5); i++) {
    var el = cards[i];
    var r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 40) continue;
    var text = (el.textContent || '').trim().slice(0, 25);
    var n = text ? 'arco-stat-' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : 'arco-stat-' + i;
    var snap = window.__SKE_SNAPSHOT(el, n);
    if (snap && snap.bones.length >= 1) {
      results.push({ name: n, data: snap, w: Math.round(r.width), h: Math.round(r.height), text: text });
    }
  }
  return results;
});

for (var j = 0; j < statResult.length; j++) {
  var sr = statResult[j];
  writeFileSync(outDir + '/' + sr.name + '.bones.json', JSON.stringify(sr.data, null, 2));
  console.log('  Captured: ' + sr.name + ' (' + sr.w + 'x' + sr.h + ') - ' + sr.data.bones.length + ' bones');
  capturedNames.push(sr.name);
}

// 截图：高亮捕获的卡片
await pg.evaluate(function (names) {
  var cards = document.querySelectorAll('.arco-card');
  Array.from(cards).forEach(function (card, i) {
    if (i < names.length) {
      card.style.outline = '3px dashed #1677ff';
      card.style.outlineOffset = '2px';
    }
  });
}, capturedNames);

await pg.screenshot({ path: '/tmp/arco-bones-captured.png', fullPage: true });
console.log('\nScreenshot: /tmp/arco-bones-captured.png');
console.log('Bones: ' + outDir + '/');
console.log('Components: ' + capturedNames.join(', '));

await b.close();
console.log('done');