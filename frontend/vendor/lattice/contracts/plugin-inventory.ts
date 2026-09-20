// Lattice contracts: plugin inventory
//
// 只读的插件清单契约：控制台用它渲染插件列表与详情。
// **本服务不修改任何状态** —— Context 始终是唯一的生命周期权威。
//
// 数据来源（全部是公开 API，不碰 Context 的私有字段）：
//   Context.listPlugins()  → id / name / version / layer / status / inject / 错误 / 时间 / protected
//   Context.listServices() → 按 ownerId 计算 provides
//   ToolService.list()     → 按 ownerId 计算 tools

import type { PluginError, PluginLayer, PluginStatus } from '../context.js';

/** 单个插件的只读视图 */
export interface PluginView {
  id: string;
  name: string;
  /** 插件版本，来自插件定义 */
  version?: string;
  layer: PluginLayer;

  status: PluginStatus;

  /** 声明的依赖服务名 */
  inject: string[];
  /** 当前由该插件提供的服务名 */
  provides: string[];
  /** 当前由该插件注册的工具名 */
  tools: string[];

  error?: PluginError;
  cleanupError?: PluginError;
  activatedAt?: number;
  disposedAt?: number;
  /** 激活尝试次数 */
  attempt: number;

  /** 系统保护插件（控制面自身）：不可 disable / restart / unload */
  protected: boolean;
  /**
   * 静态判断「是否允许停用」：非 protected 且处于可停用状态。
   * 注意：**有活跃依赖方时后端仍会拒绝**，真实结果以动作回包为准。
   */
  runtimeDisableAllowed: boolean;
}

/** 清单快照：带上生成时间，便于前端显示「数据新鲜度」 */
export interface PluginInventorySnapshot {
  generatedAt: number;
  plugins: PluginView[];
}

/**
 * 插件清单服务：只读，不缓存（每次 `list()` 都从 Context 现读）。
 */
export interface PluginInventoryService {
  list(): PluginView[];
  get(id: string): PluginView | undefined;
  snapshot(): PluginInventorySnapshot;
}
