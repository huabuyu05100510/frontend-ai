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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
// packages/devtools/src/plugin/craPlugin.cjs
var path = require('path');
var fs = require('fs');
var HtmlWebpackPlugin = require('html-webpack-plugin');
var express = require('express');
var bodyParser = require('body-parser');
var portfinder = require('portfinder');
var apiPort = 0;
var serverPromise = null;
// 启动 API Server（单例）
function startServer(_a) {
    var _b = _a === void 0 ? {} : _a, _c = _b.desiredPort, desiredPort = _c === void 0 ? 4399 : _c;
    if (serverPromise)
        return serverPromise;
    serverPromise = portfinder.getPortPromise(desiredPort).then(function (port) {
        apiPort = port;
        var app = express();
        // 通用 CORS
        app.use(function (req, res, next) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            next();
        });
        app.use(bodyParser.json());
        // 保存 skeleton
        app.post('/skeleton/save', function (req, res) {
            var _a = req.body, id = _a.id, data = _a.data;
            console.log('[SAVE]', { id: id, data: data });
            res.json({ ok: true });
        });
        app.get('/__health', function (_, res) { return res.json({ ok: true }); });
        app.listen(port, function () {
            console.log("[SMARTY_DEVTOOLS] HTTP Server running on port ".concat(port));
        });
        return { port: port };
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
        apply: function (compiler) {
            var _this = this;
            // 启动 API Server（确保唯一）
            startServer();
            // 注入到 HTML
            compiler.hooks.compilation.tap('SmartyDevtoolsPlugin', function (compilation) {
                HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync('SmartyDevtoolsPlugin', function (data, callback) { return __awaiter(_this, void 0, void 0, function () {
                    var toolbarScript;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, serverPromise];
                            case 1:
                                _a.sent(); // 等待端口就绪
                                toolbarScript = getToolbarScript();
                                data.html = data.html.replace(/<\/head>/, "<script>window.__SMARTY_API_PORT__=".concat(apiPort, ";</script>\n               <script>").concat(toolbarScript, "</script>\n              </head>"));
                                callback(null, data);
                                return [2 /*return*/];
                        }
                    });
                }); });
            });
            // DevServer 静态挂载 /__smarty__/devtools.js
            compiler.hooks.afterEmit.tap('SmartyDevtoolsPlugin', function (compilation) {
                var devServer = compiler.options.devServer;
                if (!devServer)
                    return;
                var originalSetup = devServer.setupMiddlewares;
                devServer.setupMiddlewares = function (middlewares, server) {
                    var newMiddleware = {
                        name: 'smarty-devtools-static',
                        path: '/__smarty__/devtools.js',
                        middleware: function (req, res, next) {
                            var filePath = path.join(__dirname, '../dist/devtools.js');
                            if (fs.existsSync(filePath)) {
                                res.setHeader('Content-Type', 'application/javascript');
                                res.send(fs.readFileSync(filePath, 'utf8'));
                            }
                            else {
                                res.status(404).send('// devtools.js not found');
                            }
                        },
                    };
                    if (originalSetup) {
                        return originalSetup(__spreadArray(__spreadArray([], middlewares, true), [newMiddleware], false), server);
                    }
                    else {
                        return __spreadArray(__spreadArray([], middlewares, true), [newMiddleware], false);
                    }
                };
            });
        },
    };
}
module.exports = SmartyDevtoolsPlugin;
