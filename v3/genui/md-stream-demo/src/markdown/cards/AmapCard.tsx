import { CopyButton } from '../../components/CopyButton';

export interface AmapData {
  name: string;
  address: string;
  lng: number;
  lat: number;
  rating?: number;
  distance?: string;
  tags?: string[];
  tel?: string;
}

/**
 * 高德地图卡片 —— 无需 API key 的可分享地图卡。
 * 地图区用 SVG 仿真（路网 + 定位标记），动作区给出高德 URI 深链。
 */
export function AmapCard({ data }: { data: AmapData }) {
  const amapUri = `https://uri.amap.com/marker?position=${data.lng},${data.lat}&name=${encodeURIComponent(
    data.name,
  )}&src=a2ui-demo&coordinate=gaode`;
  const navUri = `https://uri.amap.com/navigation?to=${data.lng},${data.lat},${encodeURIComponent(
    data.name,
  )}&mode=car&src=a2ui-demo`;

  return (
    <div className="card amap-card">
      <div className="amap-map" aria-label={`${data.name} 的位置示意图`}>
        <MockMap seed={data.lng + data.lat} />
        <div className="amap-pin" title={data.name}>
          <svg viewBox="0 0 24 32" width="28" height="38">
            <path
              d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"
              fill="#1989fa"
            />
            <circle cx="12" cy="12" r="5" fill="#fff" />
          </svg>
        </div>
        <span className="amap-badge">高德地图</span>
      </div>

      <div className="amap-body">
        <div className="amap-title-row">
          <h4 className="amap-name">{data.name}</h4>
          {data.rating != null && <span className="amap-rating">★ {data.rating.toFixed(1)}</span>}
        </div>
        <p className="amap-address">📍 {data.address}</p>
        <div className="amap-meta">
          {data.distance && <span>🚶 {data.distance}</span>}
          {data.tel && <span>📞 {data.tel}</span>}
          <span className="amap-coord">
            {data.lng.toFixed(5)}, {data.lat.toFixed(5)}
          </span>
        </div>
        {data.tags && data.tags.length > 0 && (
          <div className="amap-tags">
            {data.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="card-actions">
          <a className="btn primary" href={navUri} target="_blank" rel="noopener noreferrer">
            导航
          </a>
          <a className="btn" href={amapUri} target="_blank" rel="noopener noreferrer">
            在高德打开
          </a>
          <CopyButton className="btn ghost" text={data.address} label="复制地址" />
        </div>
      </div>
    </div>
  );
}

/** 用确定性伪随机画一张「像地图」的 SVG（路网 + 街区 + 绿地） */
function MockMap({ seed }: { seed: number }) {
  const rng = mulberry32(Math.floor(Math.abs(seed) * 1000));
  const blocks = Array.from({ length: 14 }, () => ({
    x: Math.floor(rng() * 320),
    y: Math.floor(rng() * 140),
    w: 26 + Math.floor(rng() * 50),
    h: 20 + Math.floor(rng() * 36),
    green: rng() > 0.78,
  }));
  return (
    <svg viewBox="0 0 360 160" preserveAspectRatio="xMidYMid slice" className="mock-map">
      <rect width="360" height="160" fill="#eaf0f6" />
      {blocks.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx="3"
          fill={b.green ? '#cfe8c8' : '#f5f7fa'}
          stroke="#dce3ec"
        />
      ))}
      {/* 主干道 */}
      <line x1="0" y1="92" x2="360" y2="78" stroke="#ffd591" strokeWidth="9" />
      <line x1="150" y1="0" x2="172" y2="160" stroke="#fff" strokeWidth="7" />
      <line x1="40" y1="0" x2="20" y2="160" stroke="#fff" strokeWidth="4" />
      <line x1="0" y1="40" x2="360" y2="30" stroke="#fff" strokeWidth="4" />
    </svg>
  );
}

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
