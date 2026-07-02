# 2026-06-27 标注存储层 IndexedDB (Agent 2)

> 模型：Claude (Sonnet 4.6 / MiniMax-M3 路由)

## 任务
对标 `docs/annotation-feature-tech-plan-V1.md` §4 存储方案，实现标注功能的 IndexedDB 存储层。

## 交付文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `/Users/didi/Downloads/前端AI面试题/网页翻译/lib/annotation-store.mjs` | 327 | IDB CRUD + index 查询 + 流式 JSONL 导出 + 聚合统计 |
| `/Users/didi/Downloads/前端AI面试题/网页翻译/test/annotation-store.test.mjs` | 274 | 18 个 node:test 用例，全绿 |

## 测试结果
- **18/18 通过 (100%)**
- 3 次连续运行稳定
- 跑 `node --test test/annotation-store.test.mjs` 全绿

## 新增依赖
- `fake-indexeddb@^6.2.5`（devDependency），用于 Node 环境跑 IDB
- 安装命令：`npm install -D fake-indexeddb`
- 已写入 `package.json` 的 `devDependencies` 字段
- 已加入 `npm run test:unit` / `test:coverage` 脚本列表

## 实现 API
| 函数 | 签名 | 说明 |
|---|---|---|
| `openDb()` | `() => Promise<IDBDatabase>` | 单例 + onupgradeneeded 建 schema，预留 schemaVersion 2+ 迁移点 |
| `put(anno)` | `(object) => Promise<string>` | upsert；最小 shape 校验（id 非空） |
| `get(id)` | `(string) => Promise<object\|undefined>` | 单读；找不到返回 undefined |
| `listByCreatedAt({limit?,offset?,desc?,kind?})` | `(opts) => Promise<object[]>` | cursor 扫描，按 createdAt asc/desc |
| `listUnsynced({limit?})` | `(opts) => Promise<object[]>` | by_synced=0 索引 |
| `markSynced(ids)` | `(string[]) => Promise<number>` | 批量更新，同事务原子 |
| `deleteById(id)` | `(string) => Promise<void>` | 删除；id 不存在静默通过 |
| `stats()` | `() => Promise<{total,byKind,byLangPair,last24h,unsyncedCount}>` | 聚合；游标单遍 |
| `exportJSONL()` | `() => AsyncIterable<string>` | 流式导出，每行 JSON + \n |
| `clear()` / `_reset()` | — | 测试隔离 |

## 关键决策

### 1. 为什么 IndexedDB 而非 chrome.storage.local
- **限额**：chrome.storage 5MB / 10MB 硬限，IDB 实测 50MB+
- **索引**：IDB 支持 index 扫描，stats / listUnsynced 才能用 index，否则全表扫描
- **离线优先**：写入即落库，不依赖上传

### 2. 为什么 exportJSONL 用 AsyncIterable 而非 all-in-memory
- 用户可能累积 10k+ 标注，全读入会 OOM
- 流式 cursor 让内存常驻 < 1MB
- 未来 spike/phase8 训练脚本可边读边写文件
- 实现：cursor 驱动 + queue + Promise 等待

### 3. 扁平存储 vs payload 嵌套
- 与 schema 层（Agent 1）`lib/annotation.mjs` 的 `Annotation` 对象同形：kind/url/langPair 顶层，payload 子对象
- 索引直接指向顶层字段（`by_url` 索引 'url'），不用 dotted path
- 这样 stats() 可直接 `v.kind` / `v.langPair` 读取，无需 `v.payload.kind`

### 4. 单例 DB + close 拦截
- 用 `_dbPromise` + `_dbCachedHandle` 单例
- 拦截 `db.close` 方法，标记已关闭并清单例
- fake-indexeddb / 浏览器表现差异：close 后必须 reopen，否则后续操作抛 InvalidStateError

### 5. synced 用 0/1 整数
- IDB IDBKeyRange 对布尔 key 支持差
- 整数 key 可直接 `IDBKeyRange.only(0)` 查 unsynced

### 6. IDB 迁移预留
- `onupgradeneeded` 注释里预留 schemaVersion 2+ 迁移点
- 当前实现严格按 version=1 写，升级时改 version + 加 if (oldVersion < N) 分支

### 7. markSynced 同事务原子
- 多次 get+put 必须在同一 readwrite 事务内
- 否则 read-modify-write 之间可能被其他事务打断
- 当前实现用 pending 计数器 + failed 标志，保证失败立即 reject

## 已覆盖测试用例（18 个）

1. openDb: 创建成功，DB 名与版本正确
2. openDb: 4 个 indexes 都建立
3. put + get: 写入后能取出，payload 完整保留
4. put: 同 id 写入覆盖（upsert）
5. put: 显式传 synced=1 也保留
6. get: 不存在的 id 返回 undefined
7. listByCreatedAt: 默认 asc 顺序
8. listByCreatedAt: desc 倒序
9. listByCreatedAt: limit + offset
10. listUnsynced: 只返回 synced=0
11. listUnsynced: limit 限制返回数
12. markSynced: 批量更新 synced 标志
13. markSynced: 空数组不报错
14. deleteById: 真的删了，get 返回 undefined
15. deleteById: 删不存在的 id 不抛错
16. stats: 聚合正确（5 ALIGN_FIX + 3 SEG_RATING）
17. exportJSONL: 流式输出，每行 valid JSON + \n 结尾
18. exportJSONL: 空库 → 0 行（不抛错）

## 已知约束 / 遗留问题

### 与 Agent 1 协同
- 存储形态（扁平 vs payload 嵌套）需与 Agent 1 schema 层保持一致
- 当前采用**扁平**存储：Annotation 字段全在顶层（id/createdAt/synced + kind/url/... + payload:{...}）
- 索引 by_url 指向顶层 'url' 字段；stats() 用 `v.kind` / `v.langPair`
- **调用方契约**：put 入参应是完整 Annotation（用 Agent 1 的 `encode()` 生成）

### 并发写入
- 当前未做并发锁；markSynced 内部 read-modify-write 靠事务原子性保证
- 高并发场景（如同时 markSynced 多批）需后续 Agent 4 同步层处理

### 错误处理边界
- open 失败（indexedDB 不可用）：抛 Error('indexedDB unavailable')
- put 缺 id：抛 Error('anno.id must be non-empty string')
- deleteById 不存在 id：静默通过（idempotent）
- markSynced 部分 id 不存在：返回实际更新的条数（不抛错）

### IDB 满
- 当前未做 LRU 淘汰（doc §11 风险表里提到）
- 若用户长期使用需加：定期清 synced=1 + 30d 前的标注

## 依赖的下游模块

- Agent 1（schema）：`lib/annotation.mjs` 提供 `validate()` + `encode()` + `generateUuid()`
- Agent 3（ui-align）：hover 词对齐气泡中 ✏️ 提交 → 调 put()
- Agent 4（ui-rating）：段级评分提交 → 调 put()
- Agent 5（sync）：listUnsynced → markSynced 流程
- Agent 6（demo）：标注面板 + exportJSONL 导出按钮

## 跑通命令
```bash
npm install -D fake-indexeddb
node --test test/annotation-store.test.mjs
```