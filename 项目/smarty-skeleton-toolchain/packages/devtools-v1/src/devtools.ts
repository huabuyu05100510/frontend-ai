import * as CORE from '@smarty-skeleton-toolchain/core';

function initSmartyToolbar() {
  const container = document.createElement('div');
  container.id = '__smarty_toolbar__';
  Object.assign(container.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '50px',
    background: '#111',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 8px',
    zIndex: '999999',
    fontFamily: 'Inter, Arial',
    fontSize: '13px',
  });
  document.body.appendChild(container);

  const input = document.createElement('input');
  input.placeholder = 'Skeleton ID';
  Object.assign(input.style, {
    padding: '6px',
    borderRadius: '4px',
    background: '#222',
    color: '#fff',
    border: 'none',
  });
  container.appendChild(input);

  function createButton(text: string, onClick: () => void) {
    const btn = document.createElement('button');
    btn.innerText = text;
    Object.assign(btn.style, {
      padding: '4px 8px',
      borderRadius: '4px',
      border: 'none',
      cursor: 'pointer',
    });
    btn.onclick = onClick;
    container.appendChild(btn);
  }

  const API_PORT = (window as any).__SMARTY_API_PORT__;
  const WS_PORT = API_PORT + 1;

  const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
  ws.onopen = () => console.log('[SMARTY_WS] connected');
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'preview') {
      renderSkeleton(document.body);
      console.log('[HOT PREVIEW REFRESH]');
    }
  };

  createButton('Generate', () => {
    const skel = generateSkeleton(document.body);
    console.log('[GENERATED]', skel);
  });

  createButton('Preview', () => {
    renderSkeleton(document.body);
    ws.send(JSON.stringify({ type: 'preview' }));
    console.log('[PREVIEW]');
  });

  createButton('Save', async () => {
    const id = input.value.trim();
    if (!id) return alert('Please enter Skeleton ID');
    try {
      const res = await fetch(`http://localhost:${API_PORT}/skeleton/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, data: 'export default {};' }),
      });
      const json = await res.json();
      console.log('[SAVE RESPONSE]', json);
      alert('Saved successfully');
    } catch (err) {
      console.error(err);
      alert('Save failed');
    }
  });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSmartyToolbar);
  } else {
    initSmartyToolbar();
  }
}

export function generateSkeleton(root: HTMLElement) {
  return (CORE as any).generateSkeleton(root);
}

export function renderSkeleton(skel: any) {
  return (CORE as any).renderSkeleton?.(skel);
}
