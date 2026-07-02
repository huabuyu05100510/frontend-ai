export function NotFound() {
  return (
    <div className="page-card" data-testid="not-found">
      <h1 className="page-title">404</h1>
      <p className="page-subtitle">页面不存在或您没有访问权限</p>
      <a href="/" className="app-link">返回首页</a>
    </div>
  );
}