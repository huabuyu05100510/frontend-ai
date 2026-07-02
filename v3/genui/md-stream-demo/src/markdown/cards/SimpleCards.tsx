import { CopyButton } from '../../components/CopyButton';

/* ---------------- 通用信息卡 ---------------- */
export interface InfoData {
  title: string;
  desc?: string;
  image?: string;
  icon?: string;
  tags?: string[];
  link?: { text: string; url: string };
}

export function InfoCard({ data }: { data: InfoData }) {
  return (
    <div className="card info-card">
      {data.image && <img className="info-img" src={data.image} alt={data.title} loading="lazy" />}
      <div className="info-body">
        <h4 className="info-title">
          {data.icon && <span className="info-icon">{data.icon}</span>}
          {data.title}
        </h4>
        {data.desc && <p className="info-desc">{data.desc}</p>}
        {data.tags && (
          <div className="amap-tags">
            {data.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
        {data.link && (
          <div className="card-actions">
            <a className="btn primary" href={data.link.url} target="_blank" rel="noopener noreferrer">
              {data.link.text}
            </a>
            <CopyButton className="btn ghost" text={data.link.url} label="复制链接" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 天气卡 ---------------- */
export interface WeatherData {
  city: string;
  temp: number;
  desc: string;
  icon?: string;
  high?: number;
  low?: number;
  humidity?: number;
  wind?: string;
  forecast?: { day: string; icon: string; high: number; low: number }[];
}

export function WeatherCard({ data }: { data: WeatherData }) {
  return (
    <div className="card weather-card">
      <div className="weather-main">
        <div>
          <div className="weather-city">{data.city}</div>
          <div className="weather-desc">
            {data.icon ?? '🌤️'} {data.desc}
          </div>
        </div>
        <div className="weather-temp">{data.temp}°</div>
      </div>
      <div className="weather-meta">
        {data.high != null && <span>↑{data.high}°</span>}
        {data.low != null && <span>↓{data.low}°</span>}
        {data.humidity != null && <span>💧{data.humidity}%</span>}
        {data.wind && <span>🌬️{data.wind}</span>}
      </div>
      {data.forecast && (
        <div className="weather-forecast">
          {data.forecast.map((f) => (
            <div key={f.day} className="forecast-item">
              <span>{f.day}</span>
              <span className="forecast-icon">{f.icon}</span>
              <span className="forecast-temp">
                {f.high}° / {f.low}°
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- 商品卡 ---------------- */
export interface ProductData {
  name: string;
  price: number;
  originalPrice?: number;
  image?: string;
  rating?: number;
  sales?: number;
  tags?: string[];
}

export function ProductCard({ data }: { data: ProductData }) {
  return (
    <div className="card product-card">
      {data.image && <img className="product-img" src={data.image} alt={data.name} loading="lazy" />}
      <div className="product-body">
        <h4 className="product-name">{data.name}</h4>
        {data.tags && (
          <div className="amap-tags">
            {data.tags.map((t) => (
              <span key={t} className="tag promo">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="product-price-row">
          <span className="product-price">¥{data.price}</span>
          {data.originalPrice != null && <span className="product-original">¥{data.originalPrice}</span>}
        </div>
        <div className="product-meta">
          {data.rating != null && <span>★ {data.rating.toFixed(1)}</span>}
          {data.sales != null && <span>已售 {data.sales}</span>}
        </div>
        <div className="card-actions">
          <button className="btn primary" type="button">
            立即购买
          </button>
          <button className="btn" type="button">
            加入购物车
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 统计卡 ---------------- */
export interface StatData {
  title: string;
  items: { label: string; value: string; delta?: string; up?: boolean }[];
}

export function StatCard({ data }: { data: StatData }) {
  return (
    <div className="card stat-card">
      <h4 className="stat-title">{data.title}</h4>
      <div className="stat-grid">
        {data.items.map((it) => (
          <div key={it.label} className="stat-item">
            <div className="stat-value">{it.value}</div>
            <div className="stat-label">{it.label}</div>
            {it.delta && (
              <div className={`stat-delta ${it.up ? 'up' : 'down'}`}>
                {it.up ? '▲' : '▼'} {it.delta}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
