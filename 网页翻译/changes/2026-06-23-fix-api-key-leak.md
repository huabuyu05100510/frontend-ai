# 2026-06-23 · P0-1 API key 安全

> 模型：Claude (Sonnet 4.5)

## ⚠️ 关键告警
历史 key（前缀 `sk-cp-CTTWiV`，后缀 `TRM`）此前同时硬编码在 4 处源码 + 写入
`chrome.storage.sync`。**`storage.sync` 会通过用户 Google 帐号跨设备同步**，
等同于把开发者 key 广播到所有登录设备 → 任何安装本扩展的用户首次打开 popup
都会触发同步写入。

**部署前必须做：**
1. 到 MiniMax 控制台（https://platform.minimaxi.com/）**立即吊销旧 key**
2. 生成新 key，只放在 `.env`（已被 `.gitignore`）或部署环境的 secret manager
3. 通知所有装过本扩展的开发设备清除 `chrome.storage.sync` 中的残留

## 现象
| 位置 | 问题 |
|---|---|
| `server.mjs:16` | `process.env.MINIMAX_KEY || 'sk-cp-...TRM'` 明文 fallback |
| `extension/src/background/background.ts:6` | `HARDCODED_API_KEY = 'sk-cp-...TRM'` |
| `extension/src/popup/App.tsx:37-40` | useEffect 里用 hardcoded key 回填 + `storage.sync.set` |
| `extension/src/popup/App.tsx:61/71/157` | 配置持久化全走 `storage.sync` |
| `claude.md:23` | 明文 key |
| `extension/test/e2e/{translator-live,full-pipeline}.mjs` | 完整 key |
| `extension/test/e2e/translate-concurrent-live.test.ts` | env fallback 到完整 key |

## 根因
1. 开发期为「跑通优先」写了 hardcoded fallback，从未清理
2. 错用 `chrome.storage.sync`：默认会跨 Google 帐号同步；对 secret 类数据应该用 `storage.local`
3. 无 env 校验，启动期不报错

## 修复
1. **`server.mjs`**：
   - `KEY = process.env.MINIMAX_API_KEY`；缺失时 `log.error('startup failed') + throw`
   - 接入 `lib/logger.mjs` 结构化日志：`translate.start/translate.done/aligned.start/aligned.done` 都带 `reqId`（`genReqId()` 进程内单调递增）+ `costMs` + `ok` 字段
   - 启动时打 `config loaded` + `apiKeyMasked: '***' + KEY.slice(-4)`（只露后 4 位）
2. **新建 `lib/logger.mjs`**：`createLogger(component)` → `{debug,info,warn,error}`，输出 JSON line `{ts,level,component,msg,...fields}`；info/debug 走 stdout、warn/error 走 stderr；`LOG_LEVEL` env 控制阈值
3. **`extension/src/background/background.ts`**：删 `HARDCODED_API_KEY`；`getApiKey()` 只读 `storage.local`；缺失时 warn（不 fallback）；正常时打 `api key loaded {masked}`
4. **`extension/src/popup/App.tsx`**：
   - 全部 `storage.sync` → `storage.local`
   - 删除 useEffect 中"hardcoded 回填"分支
   - 新增 `keyVisible` state + 眼睛按钮切换 password/text 显示
   - `isKeyValid = apiKey.startsWith('sk-') && apiKey.length >= 10`，"翻译此页面"按钮 disabled 直到 valid
   - 加载/缺失时打结构化日志
5. **`claude.md`**：删除明文 key 行，改为指引 `.env` + 轮换告警
6. **3 个 live e2e 文件**：`translator-live.mjs` / `full-pipeline.mjs` 改成 `process.env.MINIMAX_API_KEY` 缺失即 `process.exit(0)`（skip live）；`translate-concurrent-live.test.ts` 用 `describe.skipIf` 同理
7. **新建 `.env.example` + `.gitignore`**：`.env` 入 gitignore；node_modules/dist/shots diff 也一并加

## 验证（自己跑通）
```
$ node --test test/logger.test.mjs test/server.config.test.mjs
# tests 7  pass 7  fail 0

$ cd extension && npx vitest run test/unit/storage.test.ts test/unit/injector.test.ts
 Test Files  2 passed (2)
      Tests  21 passed (21)

$ cd extension && npx tsc --noEmit  # 0 错

# 启动期 env 校验：
$ node server.mjs
{"level":"error","component":"server","msg":"startup failed","reason":"MINIMAX_API_KEY env required"}
Error: [server] MINIMAX_API_KEY env required
exit ≠ 0  ✓

$ MINIMAX_API_KEY=sk-test-xxx PORT=8799 node server.mjs
{"level":"info","component":"server","msg":"config loaded","apiKeyMasked":"***-xxx","port":8799}
🌐 网页翻译 demo 已启动
curl http://localhost:8799/ → 200  ✓

# 残留检查：
$ grep -rn '<完整 key 字符串>' --include='*.mjs' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.html' .
（0 命中）  ✓
```

## 简历素材
- Secret 管理：env 必读 + 启动期 fail-fast + key 只露后 4 位（避免 log 泄露）
- Chrome 扩展 storage 陷阱：`storage.sync` 跨 Google 帐号同步是 secret 反模式，统一改 `storage.local`
- 结构化 JSON line 日志（自写 `lib/logger.mjs`，零依赖，带 `reqId` 全链路追踪）
- TDD 守恒：`storage.test.ts` 用源码 grep 断言「源码再不出现完整 key / storage.sync.set」，防回归

## 相关坑
- `chrome.storage.sync` 默认开启跨设备同步 —— secret 类数据必须用 `storage.local`。Chrome 文档没在显眼位置标
- 测试用 `process.cwd()` 启 server.mjs 子进程时，cwd 必须是项目根，否则 ESM import 找不到 server.mjs（`ERR_MODULE_NOT_FOUND`）；test 文件用 `spawn({ cwd: process.cwd() })` 跟随测试运行目录
- `process.env.MINIMAX_API_KEY = ''` 在 spawn env 里仍是"已定义但空字符串"，server 侧 `if (!KEY)` 仍能正确识别（`''` 是 falsy）
- 删除注释里的 `sk-cp-CTTWiV...` 前缀也必要 —— grep 守恒测试会发现；改为「历史 key 已外泄」无前缀表述
