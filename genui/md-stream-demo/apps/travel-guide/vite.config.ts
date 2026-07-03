import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ dir }) => {
  const env = loadEnv(dir ?? process.cwd(), process.cwd(), '');
  const provider = (env.VITE_LLM_PROVIDER ?? '').trim();
  // 各家 OpenAI 兼容 API 的 baseUrl —— 浏览器直调会跨域，统一走 vite proxy
  const upstreams: Record<string, string> = {
    minimax: 'https://api.minimaxi.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    openai: 'https://api.openai.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  };
  const target = upstreams[provider] ?? upstreams.minimax;

  return {
    plugins: [react()],
    build: { target: 'es2020', sourcemap: true },
    server: {
      proxy: {
        '/llm': {
          target,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/llm/, ''),
        },
      },
    },
  };
});
