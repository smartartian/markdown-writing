// Lattice contracts: application service maps
//
// Core 服务表：Kernel 与 Plugin Runtime 使用。
// Web 服务表：在 Core 之上增加 HTTP 与遥测能力，只供 Web Demo / Host 使用。
// 内核不导入这个文件 —— 它只认识 ServiceMap 这个抽象。
//
// 注意必须用 `type` 而不是 `interface`：interface 不会获得隐式索引签名，
// 因而无法满足内核的 `S extends Record<string, unknown>` 约束。

import type { ToolService } from './tools.js';
import type { LLMService } from './llm.js';
import type { AgentService } from './agent.js';
import type { VerifyService } from './verify.js';
import type { PluginInventoryService } from './plugin-inventory.js';
import type { PluginManagerService } from './plugin-manager.js';
import type { TelemetryService } from './telemetry.js';
import type { WebServerService } from './web-server.js';

/** Core：Kernel + Plugin Runtime，不依赖 Web 能力 */
export type LatticeCoreServiceMap = {
  tools: ToolService;
  llm: LLMService;
  agent: AgentService;
  verify: VerifyService;
  /** 插件清单（只读）：由 PluginManagerPlugin 提供 */
  pluginInventory: PluginInventoryService;
  /** 插件生命周期操作：由 PluginManagerPlugin 提供 */
  pluginManager: PluginManagerService;
};

/** Web：Core 的可选扩展组合，增加 HTTP 载体与遥测服务 */
export type LatticeWebServiceMap = LatticeCoreServiceMap & {
  /** HTTP 载体：由 WebServerPlugin 提供，其他插件用 register() 挂路由 */
  webServer: WebServerService;
  telemetry: TelemetryService;
};

export type LatticeCoreServiceName = keyof LatticeCoreServiceMap & string;
export type LatticeWebServiceName = keyof LatticeWebServiceMap & string;
