import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';

// 接收 Shell 下发的登录态
window.addEventListener('message', e => {
  if (e.data?.type === 'auth:sync') {
    document.getElementById('auth-info')!.textContent =
      `已登录：${e.data.user?.name ?? ''}`;
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/system-a">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);