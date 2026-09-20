// Lattice contracts: plugin manager
//
// 运行时插件生命周期契约：只负责「启停/重试/重启」，**不负责安装、下载、升级**。
// 实现委托给 Context 的 enablePlugin / disablePlugin / retryPlugin。
//
// 动作语义：
//   enable  = Context.enablePlugin(id)     只接受 disposed / failed，先检查依赖
//   disable = Context.disablePlugin(id)    等价 unload，但保留插件定义，可再 enable
//   restart = disable → enable
//   retry   = Context.retryPlugin(id)      面向 failed 插件

import type { PluginStatus } from '../context.js';

/** 控制台动作的失败分类，直接对应 HTTP 状态码 */
export type PluginActionErrorCode =
  | 'not-found' // 404
  | 'invalid-state' // 409
  | 'service-in-use' // 409
  | 'protected' // 423
  | 'unauthorized' // 401
  | 'internal'; // 500

export interface PluginActionError {
  code: PluginActionErrorCode;
  message: string;
  /** 附加信息，例如 ServiceInUseError 里的依赖方 id 列表 */
  detail?: unknown;
}

/** 每个动作的统一回包 */
export interface PluginActionResponse {
  ok: boolean;
  pluginId: string;
  /** 动作结束后的状态；插件不存在（404）时缺失 */
  status?: PluginStatus;
  message?: string;
  error?: PluginActionError;
}

/**
 * 插件生命周期服务。所有方法都以**插件 id** 为参数。
 *
 * 失败时抛错且**不改变插件状态**；错误类型来自内核
 * （`PluginNotFoundError` / `InvalidPluginStateError` / `ProtectedPluginError` /
 * `ServiceInUseError` / `PluginDependencyError`）。
 */
export interface PluginManagerService {
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  retry(id: string): Promise<void>;
}
