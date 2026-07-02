import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';

const PRODUCTS = [
  { id: 'P001', name: '讯飞智能录音笔 SR502', price: 1999, cover: '🎙️', stock: 156 },
  { id: 'P002', name: '讯飞翻译机 4.0', price: 2999, cover: '🌐', stock: 89 },
  { id: 'P003', name: '智能办公本 X2', price: 4999, cover: '📖', stock: 45 },
  { id: 'P004', name: '同声传译耳机', price: 899, cover: '🎧', stock: 12 },
];

export function App() {
  const loc = useLocation();
  return (
    <div className="sc-content">
      <div style={{ marginBottom: 16 }}>
        <Link to="product/list" className="sc-link">商品列表</Link>
        <Link to="product/create" className="sc-link">发布商品</Link>
      </div>

      <Routes>
        <Route index element={<Navigate to="product/list" replace />} />
        <Route path="product/list" element={
          <>
            <h1 className="sc-title">商品列表 - {loc.pathname}</h1>
            <div className="sc-grid">
              {PRODUCTS.map(p => (
                <div key={p.id} className="sc-card">
                  <div className="sc-cover">{p.cover}</div>
                  <div className="sc-name">{p.name}</div>
                  <div className="sc-price">¥{p.price}</div>
                  <div style={{ fontSize: 12, color: '#909399', marginTop: 4 }}>库存: {p.stock}</div>
                </div>
              ))}
            </div>
          </>
        } />
        <Route path="product/create" element={
          <>
            <h1 className="sc-title">发布商品 - {loc.pathname}</h1>
            <div style={{ padding: 16, background: '#fafafa', borderRadius: 8 }}>
              表单：商品名称 / 分类 / 价格 / 库存（演示）
            </div>
          </>
        } />
      </Routes>
    </div>
  );
}