// packages/devtools/src/plugin/craPlugin.cjs
const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const express = require('express');
const bodyParser = require('body-parser');
const portfinder = require('portfinder');

let apiPort = 0;
let serverPromise = null;

// 启动 API Server（单例）
function startServer({ desiredPort = 4399 } = {}) {
  if (serverPromise) return serverPromise;

  serverPromise = portfinder.getPortPromise(desiredPort).then((port) => {
    apiPort = port;
    const app = express();

    // 通用 CORS
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      next();
    });

    app.use(bodyParser.json());

    // 保存 skeleton
    app.post('/skeleton/save', (req, res) => {
      const { id, data } = req.body;
      console.log('[SAVE]', { id, data });
      res.json({ ok: true });
    });

    app.get('/__health', (_, res) => res.json({ ok: true }));

    app.listen(port, () => {
      console.log(`[SMARTY_DEVTOOLS] HTTP Server running on port ${port}`);
    });

    return { port };
  });

  return serverPromise;
}

// toolbar 注入内容
function getToolbarScript() {
  return fs.readFileSync(path.join(__dirname, '../dist/devtools.js'), 'utf8');
}

// Webpack 插件
function SmartyDevtoolsPlugin() {
  return {
    apply(compiler) {
      // 启动 API Server（确保唯一）
      startServer();

      // 注入到 HTML
      compiler.hooks.compilation.tap('SmartyDevtoolsPlugin', (compilation) => {
        HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
          'SmartyDevtoolsPlugin',
          async (data, callback) => {
            await serverPromise; // 等待端口就绪
            const toolbarScript = getToolbarScript();
            data.html = data.html.replace(
              /<\/head>/,
              `<script>window.__SMARTY_API_PORT__=${apiPort};</script>
               <script>${toolbarScript}</script>
              </head>`
            );
            callback(null, data);
          }
        );
      });

      // DevServer 静态挂载 /__smarty__/devtools.js
      compiler.hooks.afterEmit.tap('SmartyDevtoolsPlugin', (compilation) => {
        const devServer = compiler.options.devServer;
        if (!devServer) return;

        const originalSetup = devServer.setupMiddlewares;
        devServer.setupMiddlewares = (middlewares, server) => {
          const newMiddleware = {
            name: 'smarty-devtools-static',
            path: '/__smarty__/devtools.js',
            middleware: (req, res, next) => {
              const filePath = path.join(__dirname, '../dist/devtools.js');
              if (fs.existsSync(filePath)) {
                res.setHeader('Content-Type', 'application/javascript');
                res.send(fs.readFileSync(filePath, 'utf8'));
              } else {
                res.status(404).send('// devtools.js not found');
              }
            },
          };

          if (originalSetup) {
            return originalSetup([...middlewares, newMiddleware], server);
          } else {
            return [...middlewares, newMiddleware];
          }
        };
      });
    },
  };
}

module.exports = SmartyDevtoolsPlugin;
