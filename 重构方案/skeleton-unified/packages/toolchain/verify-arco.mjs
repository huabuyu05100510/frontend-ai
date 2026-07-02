import { readFileSync, readdirSync, writeFileSync } from 'fs';

// 直接内联 renderSkeletonToHTML（避免跨包依赖）
const PULSE_DEFAULTS = { speed: '1.8s' };
const CONTAINER_DEFAULTS = { lightAdjustment: -20 };
const COLOR_DEFAULTS = { light: '#f0f0f0', dark: '#222' };

function normalizeBone(raw) {
  const b = { x: raw[0] ?? 0, y: raw[1] ?? 0, w: raw[2] ?? 0, h: raw[3] ?? 0 };
  if (raw[4] !== undefined) b.r = raw[4];
  if (raw[5] === true) b.c = true;
  if (raw[6] !== undefined) b.minW = raw[6];
  if (raw[7] !== undefined) b.maxW = raw[7];
  if (raw[8] !== undefined) b.minH = raw[8];
  if (raw[9] !== undefined) b.maxH = raw[9];
  return b;
}

function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}

function renderSkeletonToHTML(data, opts = {}) {
  const color = opts.color ?? COLOR_DEFAULTS.light;
  const animation = opts.animation ?? 'pulse';
  const uid = opts.uid ?? 'ske-' + Date.now().toString(36);
  const bones = data.bones.map(b => normalizeBone(b));
  const { aspectRatio } = data;

  let animationCSS = '';
  if (animation === 'pulse') {
    animationCSS = `<style>
      @keyframes ske-pulse-${uid} { 0%,100%{opacity:1} 50%{opacity:.4} }
      .ske-bone-${uid}:not([data-c]){animation:ske-pulse-${uid} ${PULSE_DEFAULTS.speed} ease-in-out infinite}
    </style>`;
  }

  const containerStyle = [
    'position:relative',
    'width:100%',
    `padding-top:${((1 / aspectRatio) * 100).toFixed(3)}%`,
  ].join(';');

  const boneHTMLs = bones.map(bone => {
    const baseColor = bone.c ? adjustColor(color, CONTAINER_DEFAULTS.lightAdjustment) : color;
    const styles = [
      'position:absolute',
      `left:${bone.x}%`, `top:${bone.y}%`, `width:${bone.w}%`, `height:${bone.h}%`,
      `border-radius:${bone.r !== undefined ? (typeof bone.r === 'number' ? `${bone.r}px` : bone.r) : '8px'}`,
      `background-color:${baseColor}`,
    ];
    if (bone.minW !== undefined) styles.push(`min-width:${bone.minW}%`);
    if (bone.maxW !== undefined) styles.push(`max-width:${bone.maxW}%`);
    if (bone.minH !== undefined) styles.push(`min-height:${bone.minH}%`);
    if (bone.maxH !== undefined) styles.push(`max-height:${bone.maxH}%`);
    return `<div class="ske-bone-${uid}"${bone.c ? ' data-c=""' : ''} style="${styles.join(';')}"></div>`;
  }).join('');

  return `${animationCSS}<div style="${containerStyle}" aria-hidden="true">${boneHTMLs}</div>`;
}

const dir = '/tmp/arco-bones';
const files = readdirSync(dir).filter(f => f.endsWith('.bones.json'));

let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Arco Pro 骨架屏验证</title>
<style>
body { font-family: -apple-system, sans-serif; padding: 24px; background: #f5f5f5; }
h1 { font-size: 20px; margin-bottom: 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; }
.card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.card h3 { font-size: 13px; color: #666; margin: 0 0 8px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.info { font-size: 11px; color: #999; margin-top: 8px; }
</style></head><body>
<h1>Arco Pro 多维数据分析 - 骨架屏验证</h1>
<p style="color:#888;margin-bottom:24px">从 https://react-pro.arco.design/visualization/multi-dimension-data-analysis 捕获</p>
<div class="grid">`;

for (const file of files) {
  const data = JSON.parse(readFileSync(`${dir}/${file}`, 'utf-8'));
  const name = data.name;
  const skeletonHTML = renderSkeletonToHTML(data, { animation: 'pulse', uid: name });
  html += `<div class="card">
    <h3 title="${name}">${name}</h3>
    ${skeletonHTML}
    <div class="info">${data.capturedWidth}px · ${data.bones.length} bones · aspectRatio ${data.aspectRatio}</div>
  </div>`;
}

html += '</div></body></html>';

const outPath = '/tmp/arco-skeletons-verify.html';
writeFileSync(outPath, html);
console.log(`Written: ${outPath} (${files.length} components)`);