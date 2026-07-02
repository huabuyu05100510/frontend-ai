import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// 注意：刻意不使用 StrictMode —— 它会刻意双调用 render，
// 会让性能面板的「提交/块渲染次数」翻倍，干扰验收读数。
createRoot(document.getElementById('root')!).render(<App />);
