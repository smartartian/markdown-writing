// Lattice web server

// @ts-ignore
import * as http from 'node:http';
// @ts-ignore
import * as fs from 'node:fs';
// @ts-ignore
import * as path from 'node:path';
// @ts-ignore
import { fileURLToPath } from 'node:url';
import { Context, definePlugin } from './context.js';
import { LatticeWebServiceMap, TelemetryService, SseClient } from './contracts/index.js';
import type { VisualEvent } from './contracts/index.js';
import {
  ToolsPlugin,
  MockLLMPlugin,
  CalculatorToolPlugin,
  AuditPlugin,
  AgentLoopPlugin,
  PluginManagerPlugin,
} from './plugins/index.js';

declare const process: any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 结构化事件类型定义在 contracts/telemetry.ts，这里保持原出口不变 */
export type { VisualEvent };

export interface WebServerConfig {
  port: number;
}

/**
 * 平台监控与事件总线插件
 * 用于捕获 Context 的服务注入、插件激活、waterfall 穿透及工具调用细节
 *
 * 遥测能力以 `telemetry` 服务的形式提供（不再往 root 上挂动态属性）。
 */
export const TelemetryPlugin = definePlugin<LatticeWebServiceMap>()({
  id: 'telemetry-plugin',
  name: 'telemetry-plugin',
  version: '0.0.1',
  layer: 'system',
  protected: true,
  apply(ctx) {
    const sseClients = new Set<SseClient>();

    const telemetry: TelemetryService = {
      broadcast(event) {
        const payload: VisualEvent = {
          id: Math.random().toString(36).slice(2, 9),
          timestamp: Date.now(),
          ...event,
        };
        const raw = `data: ${JSON.stringify(payload)}\n\n`;
        for (const client of sseClients) {
          try {
            client.write(raw);
          } catch {
            sseClients.delete(client);
          }
        }
      },
      addSseClient(client) {
        sseClients.add(client);
        client.on('close', () => void sseClients.delete(client));
      },
    };

    ctx.provide('telemetry', telemetry);

    const broadcast = telemetry.broadcast;

    // 深度注入 waterfall 追踪（洋葱圈流水线跟踪）
    ctx.waterfall('tools/pre-execute', async (req: any, next) => {
      broadcast({
        type: 'waterfall',
        stage: 'pre-execute:enter',
        message: `🛡️ [洋葱圈外层-前置] 拦截检查工具 [${req.name}] 请求`,
        detail: { phase: 'pre', ...req },
      });
      const result = await next();
      broadcast({
        type: 'waterfall',
        stage: 'pre-execute:leave',
        message: `🛡️ [洋葱圈外层-前置] 工具 [${req.name}] 放行并通过检查`,
        detail: { phase: 'pre-done', ...req },
      });
      return result;
    });

    ctx.waterfall('tools/post-execute', async (res: any, next) => {
      broadcast({
        type: 'waterfall',
        stage: 'post-execute:enter',
        message: `🛡️ [洋葱圈外层-后置] 收到工具 [${res.name}] 执行原始返回值`,
        detail: { phase: 'post', ...res },
      });
      const result = await next();
      broadcast({
        type: 'waterfall',
        stage: 'post-execute:leave',
        message: `🛡️ [洋葱圈外层-后置] 工具 [${res.name}] 数据脱敏完成并向外层返回`,
        detail: { phase: 'post-done', ...res },
      });
      return result;
    });

    return () => {
      sseClients.clear();
    };
  },
});

/**
 * WebServer 插件：Lattice 宿主 HTTP 载体
 * 在 Context 微内核中挂载 HTTP 载体，提供具名 API 路由与静态资源托管
 */
export const WebServerPlugin = definePlugin<LatticeWebServiceMap>()({
  id: 'web-server-plugin',
  name: 'web-server-plugin',
  version: '0.0.1',
  layer: 'system',
  protected: true,
  apply(ctx, config: WebServerConfig = { port: 4000 }) {
    const server = http.createServer(async (req: any, res: any) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // 允许跨域（本地开发友好）
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 1. SSE 实时事件流通道
      if (pathname === '/api/events/stream' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        res.write('data: {"type":"connected","message":"SSE 通道已建立"}\n\n');
        ctx.root.getService('telemetry')?.addSseClient(res);
        return;
      }

      // 2. 查询微内核当前状态与插件/服务树
      if (pathname === '/api/kernel/status' && req.method === 'GET') {
        const toolsService = ctx.root.getService('tools');
        const plugins = ctx.root.listPlugins();
        const count = (status: string) => plugins.filter((p) => p.status === status).length;
        const status = {
          plugins,
          pluginStats: {
            total: plugins.length,
            active: count('active'),
            starting: count('starting'),
            pending: count('pending'),
            failed: count('failed'),
            disposed: count('disposed'),
          },
          services: {
            tools: !!ctx.root.getService('tools'),
            llm: !!ctx.root.getService('llm'),
            agent: !!ctx.root.getService('agent'),
          },
          tools: toolsService ? toolsService.getSchemas() : [],
          waterfalls: ['tools/pre-execute', 'tools/post-execute'],
        };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(status));
        return;
      }

      // 3. JSON-RPC / API：触发 AgentTurn 运行
      if (pathname === '/api/agent/run' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => (body += chunk));
        req.on('end', async () => {
          try {
            const { prompt } = JSON.parse(body || '{}');
            if (!prompt) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Prompt 不能为空' }));
              return;
            }

            const telemetry = ctx.root.getService('telemetry');
            telemetry?.broadcast({
              type: 'agent',
              stage: 'start',
              message: `🚀 [AgentLoop] 开始执行任务: "${prompt}"`,
              detail: { prompt },
            });

            // 触发 agent 服务执行主循环
            let finalAnswer = '';
            const agent = ctx.root.getService('agent');
            if (agent) {
              finalAnswer = (await agent.run(prompt)).answer;
            }

            if (finalAnswer) {
              telemetry?.broadcast({
                type: 'agent',
                stage: 'answer',
                message: `🤖 [Agent 最终答复]: ${finalAnswer}`,
                detail: { answer: finalAnswer },
              });
            }

            telemetry?.broadcast({
              type: 'agent',
              stage: 'complete',
              message: `🏁 [AgentLoop] 任务执行完成`,
              detail: { prompt, answer: finalAnswer },
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: '执行完毕', answer: finalAnswer }));
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // 4. 重置/重新加载插件容器演示
      if (pathname === '/api/kernel/reload' && req.method === 'POST') {
        ctx.root.getService('telemetry')?.broadcast({
          type: 'kernel',
          stage: 'reload',
          message: `🔄 [Context] 触发微内核热重载演示`,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 5. 静态文件托管（前端单页面：web/index.html）
      const webDir = path.join(__dirname, 'web');
      let filePath = path.join(webDir, pathname === '/' ? 'index.html' : pathname);

      // 安全路径判断
      if (!filePath.startsWith(webDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err: any, data: any) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
        };

        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    server.listen(config.port, () => {
      console.log(`\n🌐 [WebServer] 可视化管理面板已启动: http://localhost:${config.port}`);
      console.log(`📡 [WebServer] SSE 实时通信流已就绪: http://localhost:${config.port}/api/events/stream\n`);
    });

    return () => {
      server.closeAllConnections?.();
      server.close();
      console.log('[WebServer] 服务器已关闭');
    };
  },
});

/** 启动主服务 */
export async function startServer(port = 4000) {
  const rootCtx = new Context<LatticeWebServiceMap>();

  // 1. 先挂载通信与遥测服务
  rootCtx.plugin(TelemetryPlugin);
  rootCtx.plugin(WebServerPlugin, { port });
  rootCtx.plugin(PluginManagerPlugin);

  // 2. 乱序挂载业务插件与 Agent
  rootCtx
    .plugin(AgentLoopPlugin)
    .plugin(CalculatorToolPlugin)
    .plugin(AuditPlugin)
    .plugin(ToolsPlugin)
    .plugin(MockLLMPlugin);

  await rootCtx.start();

  rootCtx.getService('telemetry')?.broadcast({
    type: 'kernel',
    stage: 'init',
    message: '✅ Lattice 内核初始化完成，所有服务已自动注入就绪',
  });

  return rootCtx;
}

// 直接运行判断
if (process.argv[1] && process.argv[1].endsWith('web-server.ts')) {
  startServer(4000).catch(console.error);
}
