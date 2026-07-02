import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';

const ORDERS = [
  { id: 'O001', customer: '张三', amount: 299, status: 'pending' },
  { id: 'O002', customer: '李四', amount: 1580, status: 'paid' },
  { id: 'O003', customer: '王五', amount: 89, status: 'paid' },
  { id: 'O004', customer: '赵六', amount: 4998, status: 'done' },
];

const STATUS_LABEL: Record<string, string> = {
  pending: '待付款',
  paid: '已付款',
  done: '已完成',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'sb-pending',
  paid: 'sb-paid',
  done: 'sb-done',
};

export function App() {
  const loc = useLocation();
  return (
    <div className="sb-content">
      <div style={{ marginBottom: 16 }}>
        <Link to="pending" className="sb-link">待处理订单</Link>
        <Link to="history" className="sb-link">历史订单</Link>
        <Link to="report" className="sb-link">数据报表</Link>
      </div>

      <Routes>
        <Route index element={<Navigate to="pending" replace />} />
        <Route path="pending" element={
          <>
            <h1 className="sb-title">待处理订单 - {loc.pathname}</h1>
            <OrderTable filter="pending" />
          </>
        } />
        <Route path="history" element={
          <>
            <h1 className="sb-title">历史订单 - {loc.pathname}</h1>
            <OrderTable filter="done" />
          </>
        } />
        <Route path="report" element={
          <>
            <h1 className="sb-title">数据报表 - {loc.pathname}</h1>
            <div style={{ padding: 16, background: '#fafafa', borderRadius: 8 }}>
              本月营收 ¥234,500，订单数 568 单，客单价 ¥413。
            </div>
          </>
        } />
      </Routes>
    </div>
  );
}

function OrderTable({ filter }: { filter: string }) {
  const orders = ORDERS.filter(o => o.status === filter);
  return (
    <table className="sb-table">
      <thead>
        <tr><th>订单号</th><th>客户</th><th>金额</th><th>状态</th></tr>
      </thead>
      <tbody>
        {orders.map(o => (
          <tr key={o.id}>
            <td>{o.id}</td>
            <td>{o.customer}</td>
            <td>¥{o.amount}</td>
            <td><span className={`sb-badge ${STATUS_CLASS[o.status]}`}>{STATUS_LABEL[o.status]}</span></td>
          </tr>
        ))}
        {orders.length === 0 && (
          <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#909399' }}>暂无订单</td></tr>
        )}
      </tbody>
    </table>
  );
}