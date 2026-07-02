import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';

const USERS = [
  { id: 'u001', name: '张三', email: 'zhangsan@example.com', dept: '产品部' },
  { id: 'u002', name: '李四', email: 'lisi@example.com', dept: '研发部' },
  { id: 'u003', name: '王五', email: 'wangwu@example.com', dept: '运营部' },
];

const ROLES = [
  { name: '超级管理员', users: 2, perms: '*' },
  { name: '运营经理', users: 5, perms: 'b:order:*, c:product:*' },
  { name: '产品经理', users: 8, perms: 'a:user:view, a:dashboard:view' },
];

export function App() {
  const loc = useLocation();
  return (
    <div className="sa-content">
      <div style={{ marginBottom: 16 }}>
        <Link to="" className="sa-link" style={{ marginRight: 16 }}>用户列表</Link>
        <Link to="role" className="sa-link">角色权限</Link>
      </div>

      <Routes>
        <Route index element={<Navigate to="list" replace />} />
        <Route path="list" element={
          <>
            <h1 className="sa-title">用户列表 - 当前路径: {loc.pathname}</h1>
            <table className="sa-table">
              <thead>
                <tr><th>ID</th><th>姓名</th><th>邮箱</th><th>部门</th></tr>
              </thead>
              <tbody>
                {USERS.map(u => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.dept}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        } />
        <Route path="role" element={
          <>
            <h1 className="sa-title">角色权限</h1>
            {ROLES.map(r => (
              <div key={r.name} className="sa-card">
                <strong>{r.name}</strong>
                <div style={{ fontSize: 13, color: '#606266', marginTop: 4 }}>
                  权限码: {r.perms} · 用户数: {r.users}
                </div>
              </div>
            ))}
          </>
        } />
      </Routes>
    </div>
  );
}