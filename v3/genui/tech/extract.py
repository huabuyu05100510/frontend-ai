#!/usr/bin/env python3
"""A2UI tech PDF 批量提取: PDF → PNG → macOS Vision OCR → Markdown"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "extracted"
PAGES_DIR = OUT / "pages"
MD_DIR = OUT / "markdown"
VISION_OCR = ROOT / "vision-ocr.swift"

PDFS = [
    {
        "file": "tech1.pdf",
        "title": "A2UI 实战（一）- 渲染器基础",
        "series": 1,
        "slug": "tech1",
    },
    {
        "file": "tech2.pdf",
        "title": "A2UI 实战（二）- SSE、AGUI 协议与服务端搭建",
        "series": 2,
        "slug": "tech2",
    },
    {
        "file": "tech3.pdf",
        "title": "A2UI 实战（三）- 图片理解与多轮对话",
        "series": 3,
        "slug": "tech3",
    },
    {
        "file": "tech4.pdf",
        "title": "四、生成式 UI 与 A2UI",
        "series": 4,
        "slug": "tech4",
    },
]


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kwargs)


def pdf_page_count(pdf_path: Path) -> int:
    out = run(["pdfinfo", str(pdf_path)]).stdout
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":")[1].strip())
    return 0


def convert_pdf_to_png(pdf_path: Path, prefix: str) -> list[Path]:
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    for old in PAGES_DIR.glob(f"{prefix}*.png"):
        old.unlink()
    out_prefix = PAGES_DIR / prefix
    run(["pdftoppm", "-png", "-r", "180", str(pdf_path), str(out_prefix)])
    images = sorted(
        PAGES_DIR.glob(f"{prefix}-*.png"),
        key=lambda p: int(p.stem.rsplit("-", 1)[-1]),
    )
    return images


def ocr_image(image_path: Path) -> str:
    result = run(["swift", str(VISION_OCR), str(image_path)])
    return result.stdout.strip()


def build_markdown(meta: dict, pages: list[dict]) -> str:
    lines = [
        f"# {meta['title']}",
        "",
        f"> 来源: `{meta['file']}` | 共 {len(pages)} 页 | 提取: pdftoppm 180DPI + macOS Vision OCR",
        "",
        "---",
        "",
    ]
    for page in pages:
        lines.extend(
            [
                f"## 第 {page['index']} 页",
                "",
                page["text"] or "_（本页 OCR 未识别到文本）_",
                "",
                f"![{meta['file']} 第{page['index']}页](../pages/{page['image']})",
                "",
                "---",
                "",
            ]
        )
    return "\n".join(lines)


def main() -> None:
    MD_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []

    for meta in PDFS:
        pdf_path = ROOT / meta["file"]
        if not pdf_path.exists():
            print(f"skip missing: {meta['file']}")
            continue

        total = pdf_page_count(pdf_path)
        print(f"\n[{meta['file']}] {total} pages")

        images = convert_pdf_to_png(pdf_path, meta["slug"])
        pages: list[dict] = []

        for idx, image_path in enumerate(images, start=1):
            print(f"  OCR {idx}/{len(images)} {image_path.name} ...", end=" ", flush=True)
            try:
                text = ocr_image(image_path)
                print(f"{len(text)} chars")
            except subprocess.CalledProcessError as err:
                text = ""
                print(f"FAILED: {err.stderr.strip()}")

            pages.append(
                {
                    "index": idx,
                    "image": image_path.name,
                    "text": text,
                }
            )

        md_path = MD_DIR / f"{meta['slug']}.md"
        md_path.write_text(build_markdown(meta, pages), encoding="utf-8")
        print(f"  -> {md_path}")

        manifest.append(
            {
                **meta,
                "pages": len(pages),
                "markdown": f"markdown/{meta['slug']}.md",
                "chars": sum(len(p["text"]) for p in pages),
            }
        )

    index_lines = [
        "# A2UI / GenUI 技术文档提取索引",
        "",
        f"提取时间: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}",
        "",
        "## 文档清单",
        "",
        "| 序号 | 文件 | 标题 | 页数 | 字符数 | Markdown |",
        "| --- | --- | --- | ---: | ---: | --- |",
    ]
    for item in manifest:
        index_lines.append(
            f"| {item['series']} | `{item['file']}` | {item['title']} | {item['pages']} | {item['chars']} | "
            f"[{item['slug']}.md](./{item['markdown']}) |"
        )
    index_lines.extend(
        [
            "",
            "## 学习路径（推荐顺序）",
            "",
            "1. **tech4** — 生成式 UI 概念与 A2UI 协议全景",
            "2. **tech1** — `@a2ui/core` + `@a2ui/react` 渲染器 MVP",
            "3. **tech2** — SSE / AGUI 传输层 + Koa 服务端",
            "4. **tech3** — 图片理解、多轮对话、元素级交互",
            "",
            "## 目录结构",
            "",
            "```",
            "extracted/",
            "├── pages/              # 各页 PNG（180 DPI）",
            "├── markdown/           # 按 PDF 拆分的 OCR Markdown",
            "├── manifest.json       # 机器可读元数据",
            "├── INDEX.md            # 本索引",
            "└── EXTRACTION_PLAN.md  # 提取方案说明",
            "```",
            "",
        ]
    )
    (OUT / "INDEX.md").write_text("\n".join(index_lines), encoding="utf-8")
    (OUT / "manifest.json").write_text(
        json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "documents": manifest}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nDone -> {OUT / 'INDEX.md'}")


if __name__ == "__main__":
    main()
