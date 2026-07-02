/**
 * 块级切分 + 虚拟补全 —— 流式 Markdown 高性能渲染的核心。
 *
 * 思路（对标 Vercel streamdown / ChatGPT）：
 *  1) 把文档按「空行」切成顶层块，但绝不在围栏代码块 (``` / ~~~) 内部切。
 *  2) 每个已完成块用内容 hash 作为 React key + memo —— 流式追加时只有最后一块重渲。
 *  3) 仅最后一块可能语法未闭合：渲染前做虚拟补全 (autoClose) 让半截语法也能优雅显示。
 */

export interface Block {
  /** 该块的原始 markdown 源文本 */
  text: string;
  /** 内容指纹（稳定 key，内容不变则不重渲） */
  hash: string;
  /** 是否已闭合（最后一块在流式中可能未闭合） */
  closed: boolean;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/** 把完整/半截 markdown 切成顶层块（围栏感知） */
export function splitBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null; // 当前打开的围栏标记，如 ```

  const flush = () => {
    if (current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }
  };

  for (const line of lines) {
    const m = line.match(FENCE_RE);
    if (m) {
      const marker = m[2];
      if (fence == null) {
        // 进入围栏前，先把已积累的普通内容作为一个块收尾
        flush();
        fence = marker;
        current.push(line);
        continue;
      } else if (line.trim().startsWith(fence[0].repeat(3)) && m[3].trim() === '') {
        // 闭合围栏
        current.push(line);
        fence = null;
        flush();
        continue;
      }
    }

    if (fence != null) {
      current.push(line);
      continue;
    }

    if (line.trim() === '') {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();

  const lastOpenFence = fence != null;
  return blocks
    .filter((b) => b.trim() !== '')
    .map((text, i, arr) => ({
      text,
      hash: cyrb53(text),
      // 仅当最后一块仍处于未闭合围栏时标记 closed=false
      closed: !(lastOpenFence && i === arr.length - 1),
    }));
}

/**
 * 虚拟补全：对最后一块的未闭合语法做临时闭合，保证流式半截也能渲染。
 * 注意：不修改源 text（复制全文/分享仍用原始内容），只用于渲染输入。
 */
export function autoClose(text: string): string {
  let out = text;

  // 1) 未闭合的围栏代码块
  const fenceMatches = out.match(/^(`{3,}|~{3,})/gm) ?? [];
  if (fenceMatches.length % 2 === 1) {
    out += '\n```';
  }

  // 2) 未闭合的行内代码（奇数个反引号且不在围栏内）
  const inlineTicks = (out.match(/(?<!`)`(?!`)/g) ?? []).length;
  if (inlineTicks % 2 === 1) out += '`';

  // 3) 未闭合的加粗/斜体
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out += '**';

  // 4) 未闭合的链接 [text 或 [text](url
  const openBrackets = (out.match(/\[/g) ?? []).length;
  const closeBrackets = (out.match(/\]/g) ?? []).length;
  if (openBrackets > closeBrackets) out += ']';

  return out;
}

/** cyrb53 —— 快速非加密哈希，用作内容指纹 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
