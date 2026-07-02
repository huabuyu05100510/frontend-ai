# 2026-06-25 W1-3 翻译后端切 DeepL

> **模型**：Claude (Sonnet 4.5)

## 决策

把扩展的默认翻译后端从 **MiniMax** 切到 **DeepL Free**。

**理由**：
- 翻译质量更好（DeepL 是商业级，MiniMax 是国产 LLM）
- Free 版 100 万字符/月，足够 demo + 个人使用
- 原生批量 API（≤50 段/请求），不需要 `<SEP>` 拼接这种 hack
- 不需要 prompt 工程
- 术语保留更好（实测 "React Hooks" 不翻译）

## 改动

- **新增** `extension/.env.local` — `VITE_DEEPL_KEY` build-time 注入
- **新增** `extension/src/background/deepl.ts` — DeepL API 客户端
  - `translateConcurrentDeepL()` 与 MiniMax `translateConcurrent()` 同接口形态
  - 自动按 key 后缀 `:fx` 选 Free / Pro endpoint
  - 批量 ≤50 段/请求 + 指数退避重试 + 429/456 限流检测
- **改** `extension/src/background/background.ts`
  - 删除 `HARDCODED_API_KEY`（外泄的旧 MiniMax key，已彻底从代码库清除）
  - 加 `BACKEND_STORAGE` / `DEEPL_KEY_STORAGE` / `MINIMAX_KEY_STORAGE` 三套 storage key
  - `getBackend()` 默认返回 `'deepl'`
  - `getApiKey(backend)` 按 backend 读对应 storage；DeepL 缺失时回落到 build-time 默认
  - `handleTranslateBatch()` 按 backend 分发到 `translateConcurrentDeepL` 或 `translateConcurrent`
- **改** `extension/src/shared/types.ts` 加 `TranslationBackend = 'deepl' | 'minimax'`

## 验证

```bash
# DeepL API 直接调用
curl -X POST 'https://api-free.deepl.com/v2/translate' \
  -H 'Authorization: DeepL-Auth-Key dcc9fae3-...:fx' \
  -d '{"text":["The quick brown fox..."],"target_lang":"ZH"}'
# → "那只敏捷的棕色狐狸跳过了那只懒惰的狗"

# 配额
curl 'https://api-free.deepl.com/v2/usage' ...
# → {"character_count":772,"character_limit":1000000}

# 扩展 build
cd extension && npm run build
# → ✓ built in 173ms

# 旧 key 清除验证
grep -c "sk-cp-CTTWiV" dist/assets/background.ts-*.js
# → 0

# 新 key 注入验证
grep -c "dcc9fae3" dist/assets/background.ts-*.js
# → 1
```

## 安全改进

- ✅ 移除硬编码泄漏的 MiniMax key（注释说"已外泄，必须轮换"，但仓库一直留着）
- ✅ DeepL key 通过 `.env.local` 注入，`.gitignore` 已覆盖
- ✅ MiniMax backend 仍可启用但用户必须自己输入 key，不再有 fallback

## 已知遗留

- popup 还没加 backend 切换 UI（用户暂不能在浏览器里改 backend，要走 chrome.storage.local 手动写）
- W1-2.5 待补：根 package.json 没有 test 脚本，无法回归
- 没有给 deepl.ts 加 unit test（toDeepLLang / endpointForKey 是纯函数，该补）
