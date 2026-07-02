async function injectToolbar(apiUrl = 'http://localhost:4399') {
  const res = await fetch(`${apiUrl}/__port`);
  const { port } = await res.json();
  window.__SMARTY_API_PORT__ = port;

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

  const button = document.createElement('button');
  button.innerText = 'Save';
  button.onclick = async () => {
    const id = input.value.trim();
    if (!id) return alert('Enter skeleton ID');
    await fetch(`http://localhost:${window.__SMARTY_API_PORT__}/skeleton/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, data: 'export default {};' }),
    });
    alert('Saved');
  };
  Object.assign(button.style, {
    padding: '4px 8px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
  });
  container.appendChild(button);
}

// 自动 DOMContentLoaded 注入
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  injectToolbar();
} else {
  document.addEventListener('DOMContentLoaded', () => injectToolbar());
}

export { injectToolbar };
