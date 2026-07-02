// @ts-ignore
import { generateSkeleton } from "@smarty-skeleton-toolchain/core";

interface DevToolsOptions {
  apiBase?: string; // API server URL
  route?: string; // Skeleton route
}

// 页面加载完成执行 callback
function onLoaded(callback: () => void) {
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    setTimeout(callback, 0);
  } else {
    document.addEventListener("DOMContentLoaded", callback);
  }
}

// 获取页面上所有 data-skeleton-id
function getDefaultIDs(): string[] {
  const els = document.querySelectorAll("[data-skeleton-id]");
  return Array.from(els)
    .map((el) => el.getAttribute("data-skeleton-id"))
    .filter(Boolean) as string[];
}

// 给 generateSkeleton 增加异步执行方法
// declare module "@smarty-skeleton-toolchain/core" {
//   interface generateSkeleton {
//     performAndGetSke(): Promise<string>;
//   }
// }

// 注入 toolbar
export function injectToolbar(options: DevToolsOptions = {}) {
  const apiBase = options.apiBase || "http://localhost:3001";

  onLoaded(() => {
    const container = document.createElement("div");
    container.id = "devtools-toolbar";
    container.style.position = "fixed";
    container.style.bottom = "20px";
    container.style.right = "20px";
    container.style.background = "#222";
    container.style.color = "#fff";
    container.style.padding = "10px";
    container.style.borderRadius = "6px";
    container.style.zIndex = "9999";
    container.style.fontFamily = "sans-serif";

    // 输入框
    const input = document.createElement("input");
    input.id = "devtools-ids";
    input.placeholder = "Comma-separated IDs";
    input.style.marginRight = "5px";
    input.style.padding = "2px 4px";
    input.style.borderRadius = "4px";
    container.appendChild(input);

    // 设置默认值
    const updateDefaultIDs = () => {
      const defaultIDs = getDefaultIDs();
      if (!input.value) {
        input.value = defaultIDs.join(",");
      }
    };
    updateDefaultIDs();

    // SPA 兼容：监听 DOM 变化更新默认值
    const observer = new MutationObserver(() => {
      updateDefaultIDs();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.body.appendChild(container);

    // 创建按钮
    function createButton(name: string, action: () => void) {
      const button = document.createElement("button");
      button.innerText = name;
      button.style.marginRight = "5px";
      button.onclick = action;
      container.appendChild(button);
    }

    // Generate 按钮
    createButton("save", async () => {
      try {
        const idsInput = (
          document.getElementById("devtools-ids") as HTMLInputElement
        )?.value;
        const ids = idsInput
          ? idsInput
              .split(",")
              .map((i) => i.trim())
              .filter(Boolean)
          : [];
        if (!ids.length) return alert("No IDs found");

        const results: Record<string, any> = {};

        for (const id of ids) {
          const el = document.querySelector<HTMLElement>(
            `[data-skeleton-id="${id}"]`
          );
          if (!el) continue;

          // 异步生成骨架
          const skeletonInstance = new generateSkeleton({ root: el, id });
          const ske = await skeletonInstance.generateAndGetResult();
          function toBase64(u8: Uint8Array) {
            let binary = "";
            const len = u8.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(u8[i]);
            }
            return btoa(binary);
          }

          results[id] = toBase64(ske);
        }

        const res = await fetch(`${apiBase}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skeletons: results }),
        });

        const data = await res.json();
        alert("Skeletons saved: " + Object.keys(data.saved).join(", "));
      } catch (err) {
        console.error(err);
        alert("Generate & Save failed");
      }
    });

    // Preview 按钮（append overlay，不完全替换 DOM）
    createButton("Preview", async () => {
      try {
        const idsInput = (
          document.getElementById("devtools-ids") as HTMLInputElement
        )?.value;
        const ids = idsInput
          ? idsInput
              .split(",")
              .map((i) => i.trim())
              .filter(Boolean)
          : [];
        if (!ids.length) return alert("No IDs found");

        for (const id of ids) {
          const el = document.querySelector<HTMLElement>(
            `[data-skeleton-id="${id}"]`
          );
          if (!el) continue;

          const skeletonInstance = new generateSkeleton({ root: el, id });
          console.log(skeletonInstance, "skeletonInstance");
          debugger;
          const ske = await skeletonInstance.generateAndGetResult();

          // 先清理已经存在的 overlay
          let overlay = el.querySelector<HTMLDivElement>(".skeleton-overlay");
          if (!overlay) {
            overlay = document.createElement("div");
            overlay.className = "skeleton-overlay";
            overlay.style.position = "absolute";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100%";
            overlay.style.height = "100%";
            overlay.style.pointerEvents = "none"; // 不阻塞原有交互
            el.style.position = el.style.position || "relative"; // 保证定位
            el.appendChild(overlay);
          }

          // 覆盖 overlay 内容
          overlay.innerHTML = ske;
        }
      } catch (err) {
        console.error(err);
        alert("Preview failed");
      }
    });

    createButton("Restore All", () => {
      document
        .querySelectorAll<HTMLElement>(".skeleton-overlay")
        .forEach((overlay) => {
          overlay.remove();
        });
    });
  });
}
