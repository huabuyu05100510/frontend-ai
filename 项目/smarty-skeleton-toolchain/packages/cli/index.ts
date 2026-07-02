#!/usr/bin/env node
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { injectSkeletonSW } from './swInjector';

const FULL_SW_CONTENT = `
// skeleton service worker
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 向所有客户端发送 FETCH_START
  event.waitUntil(
    self.clients.matchAll().then(clients =>
      clients.forEach(c => c.postMessage({ type: 'FETCH_START', url }))
    )
  );

  const fetchPromise = fetch(event.request)
    .then(res => {
      // 向客户端发送 FETCH_END
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'FETCH_END', url }))
      );
      return res;
    })
    .catch(err => {
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'FETCH_END', url }))
      );
      throw err;
    });

  event.respondWith(fetchPromise);
});
`;

program
  .name('smarty-skeleton-chain-cli')
  .description('CLI for Smarty Skeleton Chain Toolchain')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Smarty Skeleton in your project')
  .option('-p, --project <path>', 'Project root path', '.')
  .action(async (options) => {
    const projectRoot = path.resolve(options.project);
    console.log(`[Smarty Skeleton] Initializing in ${projectRoot}...`);

    try {
      // 1. 创建 _smarty 目录
      const smartyDir = path.join(projectRoot, '_smarty');
      if (!fs.existsSync(smartyDir)) fs.mkdirSync(smartyDir);

      // 2. 写入 skeleton-sw.js（完整逻辑）
      const swPath = path.join(smartyDir, 'skeleton-sw.js');
      fs.writeFileSync(swPath, FULL_SW_CONTENT);
      console.log('[Smarty Skeleton] skeleton-sw.js created with full logic.');

      // 3. 注入 SW 注册
      await injectSkeletonSW(projectRoot);

      console.log('[Smarty Skeleton] Initialization complete.');
    } catch (err) {
      console.error('[Smarty Skeleton] Failed to initialize:', err);
    }
  });

program.parse();
