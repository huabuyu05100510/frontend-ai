/** 复制文本到剪贴板，带降级方案 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 把内容编码进可分享链接（hash 段，base64） */
export function buildShareUrl(content: string): string {
  const b64 = utf8ToBase64(content);
  const url = new URL(window.location.href);
  url.hash = `c=${b64}`;
  return url.toString();
}

export function readSharedContent(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const c = params.get('c');
  if (!c) return null;
  try {
    return base64ToUtf8(c);
  } catch {
    return null;
  }
}

function utf8ToBase64(str: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function base64ToUtf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
