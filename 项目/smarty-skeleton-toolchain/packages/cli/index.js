#!/usr/bin/env node
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { injectSkeletonSW } from './swInjector';
var FULL_SW_CONTENT = "\n// skeleton service worker\nself.addEventListener('install', () => self.skipWaiting());\nself.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));\n\nself.addEventListener('fetch', (event) => {\n  const url = event.request.url;\n\n  // \u5411\u6240\u6709\u5BA2\u6237\u7AEF\u53D1\u9001 FETCH_START\n  event.waitUntil(\n    self.clients.matchAll().then(clients =>\n      clients.forEach(c => c.postMessage({ type: 'FETCH_START', url }))\n    )\n  );\n\n  const fetchPromise = fetch(event.request)\n    .then(res => {\n      // \u5411\u5BA2\u6237\u7AEF\u53D1\u9001 FETCH_END\n      self.clients.matchAll().then(clients =>\n        clients.forEach(c => c.postMessage({ type: 'FETCH_END', url }))\n      );\n      return res;\n    })\n    .catch(err => {\n      self.clients.matchAll().then(clients =>\n        clients.forEach(c => c.postMessage({ type: 'FETCH_END', url }))\n      );\n      throw err;\n    });\n\n  event.respondWith(fetchPromise);\n});\n";
program
    .name('smarty-skeleton-chain-cli')
    .description('CLI for Smarty Skeleton Chain Toolchain')
    .version('1.0.0');
program
    .command('init')
    .description('Initialize Smarty Skeleton in your project')
    .option('-p, --project <path>', 'Project root path', '.')
    .action(function (options) { return __awaiter(void 0, void 0, void 0, function () {
    var projectRoot, smartyDir, swPath, err_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                projectRoot = path.resolve(options.project);
                console.log("[Smarty Skeleton] Initializing in ".concat(projectRoot, "..."));
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                smartyDir = path.join(projectRoot, '_smarty');
                if (!fs.existsSync(smartyDir))
                    fs.mkdirSync(smartyDir);
                swPath = path.join(smartyDir, 'skeleton-sw.js');
                fs.writeFileSync(swPath, FULL_SW_CONTENT);
                console.log('[Smarty Skeleton] skeleton-sw.js created with full logic.');
                // 3. 注入 SW 注册
                return [4 /*yield*/, injectSkeletonSW(projectRoot)];
            case 2:
                // 3. 注入 SW 注册
                _a.sent();
                console.log('[Smarty Skeleton] Initialization complete.');
                return [3 /*break*/, 4];
            case 3:
                err_1 = _a.sent();
                console.error('[Smarty Skeleton] Failed to initialize:', err_1);
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    });
}); });
program.parse();
