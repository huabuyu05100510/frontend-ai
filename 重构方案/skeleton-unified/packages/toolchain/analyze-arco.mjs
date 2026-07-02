import { chromium } from 'playwright';

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });

await pg.goto('https://react-pro.arco.design/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await pg.waitForTimeout(2000);

// 看看所有按钮
const btns = await pg.evaluate(() => {
  return [...document.querySelectorAll('button, .arco-btn, [role="button"], .login-form-wrapper [class*=btn]')].map(el => ({
    tag: el.tagName,
    text: (el.textContent||'').trim(),
    type: el.getAttribute('type'),
    class: (el.className?.toString?.() ?? '').slice(0, 80),
  }));
});
console.log('Buttons:', JSON.stringify(btns, null, 2));

// Placeholder 说 admin/admin，直接用 press Enter 提交
await pg.fill('input[placeholder*="Username"]', 'admin');
await pg.fill('input[type="password"]', 'admin');
await pg.press('input[type="password"]', 'Enter');
await pg.waitForTimeout(3000);

console.log('登录后 URL:', pg.url());

// 导航到多维数据分析页面
await pg.goto('https://react-pro.arco.design/visualization/multi-dimension-data-analysis', { waitUntil: 'domcontentloaded', timeout: 30000 });
await pg.waitForTimeout(4000);

console.log('目标 URL:', pg.url());
console.log('Title:', await pg.title());

const regions = await pg.evaluate(() => {
  return [...document.querySelectorAll('[class*=card],[class*=wrapper],[class*=container],section,.arco-card')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 50 })
    .slice(0, 20)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent||'').slice(0,60) };
    });
});
console.log('\nRegions:', JSON.stringify(regions, null, 2));

await pg.screenshot({ path: '/tmp/arco-pro-analysis.png', fullPage: true });
console.log('截图: /tmp/arco-pro-analysis.png');
await b.close();
console.log('done');