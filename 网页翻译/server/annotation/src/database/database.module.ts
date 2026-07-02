/**
 * better-sqlite3 单例 + schema 初始化（与方案 §5.2 一致）
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 */
import { Global, Module, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { logger } from '../shared/logger';

export const DATABASE = Symbol('DATABASE');
export type DB = Database.Database;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): DB => {
        // 测试时由 DATABASE_PATH 覆盖；默认 ./data/annotation.db
        const dbPath =
          process.env.ANNOTATION_DB_PATH ?? path.resolve(process.cwd(), 'data', 'annotation.db');
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });

        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('foreign_keys = ON');

        // Schema（方案 §5.2）
        db.exec(`
          CREATE TABLE IF NOT EXISTS annotations (
            id              TEXT PRIMARY KEY,
            kind            TEXT NOT NULL,
            schema_version  INTEGER NOT NULL,
            url             TEXT NOT NULL,
            dom_path        TEXT NOT NULL,
            src_segment_id  TEXT NOT NULL,
            lang_pair       TEXT NOT NULL,
            src_text        TEXT NOT NULL,
            tgt_text        TEXT NOT NULL,
            src_tokens_json TEXT NOT NULL,
            tgt_tokens_json TEXT NOT NULL,
            predicted_json  TEXT NOT NULL,
            model_version   TEXT NOT NULL,
            payload_json    TEXT NOT NULL,
            context_json    TEXT,
            created_at      INTEGER NOT NULL,
            app_version     TEXT,
            user_agent      TEXT,
            received_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
          );

          CREATE INDEX IF NOT EXISTS idx_kind_created ON annotations(kind, created_at);
          CREATE INDEX IF NOT EXISTS idx_lang ON annotations(lang_pair);
          CREATE INDEX IF NOT EXISTS idx_model ON annotations(model_version);
          CREATE INDEX IF NOT EXISTS idx_created ON annotations(created_at);
        `);

        logger.info('database ready', { path: dbPath });
        return db;
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly db: DB) {}

  onModuleInit(): void {
    // 已经由 useFactory 完成；这里仅占位
  }

  onModuleDestroy(): void {
    try {
      this.db.close();
      logger.info('database closed');
    } catch (e) {
      logger.error('database close failed', { err: String(e) });
    }
  }
}