# 19 · Step 10 · pre-commit 与 CI 集成

> 把 `check` / `build` 接进 git pre-commit 和 GitHub Actions，让骨架不同步**无法静悄悄进 main**。

---

## 1. 目标

1. **pre-commit**：`smarty check --staged` 阻断不同步提交；3 种安装方式（init-hooks / husky / lint-staged）
2. **CI（PR）**：`smarty check --ci --json` + `smarty build --diff-only` → STALE/MISSING/DRIFT/VisualDiff 失败 → exit 1
3. **CI（main 合并后）**：可选定时全量重采（夜间 cron），刷新所有断点的 bones + diff baseline
4. **PR 注释**：JSON 输出 → annotation，让 reviewer 看见哪些骨架需要更新、附 diff.png 链接

---

## 2. 前置依赖

- [18-step9 check](./18-step9-check-CLI-深层依赖.md) 与 [17-step8 Playwright](./17-step8-Playwright批量与Visual-Diff.md) 已实现
- 项目用 git；CI 用 GitHub Actions（其它 CI 适配作为衍生）

---

## 3. 关键设计

### 3.1 三种 pre-commit 安装方式

#### 方式 A · `smarty init-hooks`（一键）

```bash
npx smarty init-hooks
```

写入 `.git/hooks/pre-commit`：

```sh
#!/bin/sh
# smarty pre-commit hook — auto-installed by init-hooks
exec npx smarty check --staged
```

实现：

```ts
// packages/smarty/src/cli/init-hooks.ts
import { writeFileSync, chmodSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function initHooks(cwd: string): void {
  const hookPath = resolve(cwd, '.git/hooks/pre-commit')
  if (existsSync(hookPath)) {
    console.warn('pre-commit hook exists, will append instead of overwrite')
    appendHook(hookPath)
    return
  }
  writeFileSync(hookPath, HOOK_SCRIPT, 'utf8')
  chmodSync(hookPath, 0o755)
}

const HOOK_SCRIPT = `#!/bin/sh\n# skeleton-v2\nexec npx smarty check --staged\n`
```

#### 方式 B · husky

`.husky/pre-commit`：

```sh
#!/usr/bin/env sh
. "$(dirname "$0")/_/husky.sh"
npx smarty check --staged
```

#### 方式 C · lint-staged

`package.json`：

```jsonc
{
  "lint-staged": {
    "src/**/*.{tsx,jsx,vue,svelte}": "smarty check --staged --files"
  }
}
```

`--files`：从 stdin / argv 读 staged 文件列表（lint-staged 传入），避免 git 二次查询。

### 3.2 GitHub Actions

`.github/workflows/skeleton-check.yml`：

```yaml
name: skeleton check
on:
  pull_request:
    paths:
      - 'src/**'
      - 'bones/**'
      - 'smarty.config.json'
      - '.github/workflows/skeleton-check.yml'

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Hash check (no Playwright)
        id: check
        run: pnpm smarty check --ci --json > check.json
        continue-on-error: true
      - name: Visual diff (when source changed)
        if: steps.check.outputs.result == 'has-changes'
        run: |
          pnpm exec playwright install --with-deps chromium
          pnpm dev &
          sleep 5
          pnpm smarty build --diff-only --ci --json > build.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: skeleton-diff
          path: |
            bones/pages/web/*.diff.png
            check.json
            build.json
          retention-days: 7
      - name: PR comment
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs')
            const ck = JSON.parse(fs.readFileSync('check.json', 'utf8'))
            const lines = []
            if (ck.missing.length) lines.push(`### MISSING\n${ck.missing.map(n => `- ${n}`).join('\n')}`)
            if (ck.stale.length)   lines.push(`### STALE\n${ck.stale.map(s => `- ${s.name} (${s.depsCount} deps)`).join('\n')}`)
            if (ck.drift.length)   lines.push(`### DRIFT\n${ck.drift.map(d => `- ${d.region}: src=${d.source} vs bindings=${d.recorded}`).join('\n')}`)
            if (!lines.length) return
            await github.rest.issues.createComment({
              issue_number: context.issue.number, owner: context.repo.owner, repo: context.repo.repo,
              body: `## smarty check\n\n${lines.join('\n\n')}\n\nRun \`pnpm dev:ske\` to open the affected pages, then \`pnpm build\` to refresh bones.`
            })
      - name: Fail if not OK
        if: steps.check.outcome == 'failure'
        run: exit 1
```

### 3.3 `--diff-only` 优化（仅采有变化的）

`build --diff-only` 先跑 `check`，仅对 STALE / MISSING 的 skeleton 跑 Playwright，节省 80% CI 时间：

```ts
async function buildDiffOnly(opts: BuildOptions): Promise<BuildReport> {
  const report = await check(opts)
  const targets = [...report.missing, ...report.stale.map(s => s.name)]
  if (targets.length === 0) return { ok: [], failed: [], visualDiff: [] }
  return build({ ...opts, only: targets })
}
```

### 3.4 夜间全量重采（main 合并后）

`.github/workflows/skeleton-nightly.yml`：

```yaml
on:
  schedule:
    - cron: '0 17 * * *'      # 每天 01:00 北京时间
  workflow_dispatch:
jobs:
  full-build:
    steps:
      - ... (同上)
      - run: pnpm smarty build --ci --json > build.json
      - name: Commit refreshed bones
        run: |
          git config user.name "skeleton-bot"
          git config user.email "skeleton@noreply"
          git add bones/
          git diff --staged --quiet || git commit -m "chore(skeleton): nightly refresh"
          git push origin main
```

### 3.5 commit message 约定

bones 文件自动 commit 时用 `chore(skeleton):` 前缀，Conventional Commits 友好：

- `chore(skeleton): refresh user-profile bones`（dev:ske 后开发者手动 commit）
- `chore(skeleton): nightly refresh`（CI bot）

---

## 4. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/cli/init-hooks.ts` | 新增 |
| `packages/smarty/bin/skeleton-v2.js` | **修改**（注册 `init-hooks` 子命令） |
| `.github/workflows/skeleton-check.yml` | 新增（业务侧） |
| `.github/workflows/skeleton-nightly.yml` | 新增（业务侧） |
| `apps/demo/.husky/pre-commit` | 新增（示例） |
| `apps/demo/package.json` | **修改**：`lint-staged` 段（示例） |
| `packages/smarty/test/init-hooks.test.ts` | 新增 |

---

## 5. 验收

| 检查 | 方法 |
|---|---|
| `init-hooks` 后 `.git/hooks/pre-commit` 可执行 | filesystem |
| 故意改组件后 `git commit` 被阻断 | e2e |
| husky `.husky/pre-commit` 模式同上 | e2e |
| GitHub Actions 在 PR 上：STALE → fail + 注释 + diff.png artifact | dry-run workflow |
| `--diff-only` 跳过未变 skeleton：仅 1/8 触发 Playwright | timing |
| nightly cron 工作，自动 commit `chore(skeleton): nightly refresh` | manual workflow_dispatch |
| PR 注释含 MISSING / STALE / DRIFT 三段，无问题时不发评论 | github-script test |

---

## 6. 已知坑 & 测试用例

1. **pre-commit 跑太久阻断开发**：`--staged` ~ 100ms；如果 staged 文件全在 ignore 内 → 立即 skip。极端情况下用户加 `--no-verify` 跳过（不阻止），但 CI 仍会拦
2. **Vite dev 启动慢**：CI 启 Vite + 等待 5s 不靠谱，改 `vite preview` 用预构建产物；如必须 dev，加 `wait-on http://localhost:3000`
3. **Playwright 缺浏览器**：`playwright install --with-deps` 在 ubuntu-latest 大约 2 min；缓存 `~/.cache/ms-playwright` 可以降到 30s
4. **nightly commit 推送权限**：用 `GITHUB_TOKEN` 即可（限定 `contents: write` 权限）；fork PR 没有 write 权限，nightly 只跑 main
5. **husky v9 不再自动 install**：业务需 `pnpm prepare` 主动安装
6. **lint-staged + skeleton check 互斥写入**：lint-staged 跑 prettier 改了文件 + 同 commit 触发 skeleton check 在 prettier 之前算 hash → false-positive；解决：让 skeleton 是 lint-staged 最后一步，hash 算 prettier 之后的内容
7. **PR 关闭再开**：注释会累积；用 `github-script` 找已有评论 update 而非 create
