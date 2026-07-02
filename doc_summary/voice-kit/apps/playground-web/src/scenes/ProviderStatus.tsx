import { useEffect, useState } from 'react';

interface ProvidersResponse {
  providers: Array<{ id: string; available: boolean }>;
}

export default function ProviderStatus() {
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/providers')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error)
    return (
      <div>
        <p>gateway 未启动：{error}</p>
        <p className="meta">运行：pnpm --filter @voice-kit/gateway dev</p>
      </div>
    );
  if (!data) return <div>加载中...</div>;

  return (
    <div>
      <p className="meta">通过 gateway /api/providers 检查</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {data.providers.map((p) => (
          <li key={p.id} style={{ padding: '8px 0' }}>
            <strong>{p.id}</strong>:{' '}
            {p.available ? '✅ 可用' : '❌ 未配置 (检查 .env)'}
          </li>
        ))}
      </ul>
      <p className="meta">
        参考 .env.example 配置 VK_DOUBAO_API_KEY / VK_ZHIPU_API_KEY / VK_MINIMAX_API_KEY
      </p>
    </div>
  );
}
