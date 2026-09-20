// Lattice contracts: web server
//
// HTTP 载体契约：宿主插件负责创建/关闭 HTTP Server，其他插件通过
// `register()` 挂载自己的路由，因此业务插件（如 ConsoleApiPlugin）**不自己起 server**。
//
// 契约层刻意**不 import `node:http` 类型**（与 `SseClient` 同样的做法）：
// 本仓库没有 @types/node，这里用最小结构描述 req/res，
// 真实类型 Node 的 `IncomingMessage` / `ServerResponse` 天然满足它。

import type { Disposer } from '../context.js';

export type WebRouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';

/**
 * 路由匹配方式：
 * - `exact`：路径完全相等
 * - `prefix`：路径以 `path` 开头（用于 `/api/plugins/:id/...` 这类子路径）
 */
export type WebRouteKind = 'exact' | 'prefix';

/** 请求的最小面（`IncomingMessage` 的子集） */
export interface WebRequest {
  method?: string;
  url?: string;
  headers: Record<string, any>;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

/** 响应的最小面（`ServerResponse` 的子集） */
export interface WebResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(chunk?: string): unknown;
}

/**
 * 路由声明。握手协议：
 * - 注册顺序 = 匹配优先级，**先注册的先匹配**；
 * - 静态资源等兜底路由由 WebServerPlugin 自己放在最后；
 * - handler 抛错由 WebServerPlugin 兜底成 500，不会拖垮 server。
 */
export interface WebRoute {
  method: WebRouteMethod;
  path: string;
  kind: WebRouteKind;
  handler: (req: WebRequest, res: WebResponse) => void | Promise<void>;
}

/**
 * HTTP 载体服务：由 WebServerPlugin 提供（`ctx.webServer`）。
 */
export interface WebServerService {
  /** 注册一条路由，返回幂等 Disposer（插件卸载时自动摘除路由） */
  register(route: WebRoute): Disposer;
}
