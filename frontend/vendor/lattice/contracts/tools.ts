// Lattice contracts: tools
//
// 工具能力契约：调用方（插件、入口、测试）只依赖这里的接口与类型，
// 具体实现是 plugins/tools/ 里的 ToolsService。

import { Disposer } from '../context.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: any) => Promise<any>;
}

/** 工具名约束：首字符为字母或下划线，其余允许字母数字与 _ . -，最长 64；避免模型调用与日志展示出现歧义 */
export const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export interface RegisterToolOptions {
  /** 显式允许替换同名工具，默认 false（同名直接报错） */
  replace?: boolean;
  /** 注册者插件 id；默认取 ToolsService 自身提供者，插件应传入自己的 ctx.ownerId */
  ownerId?: string;
}

/** 工具注册条目：带归属信息，供控制台与审计展示「谁注册了什么工具」 */
export interface ToolRegistration {
  name: string;
  description: string;
  /** 注册者插件 id */
  ownerId: string;
}

/**
 * 工具能力契约：由 tools 插件实现并 provide 为 ctx.tools。
 */
export interface ToolService {
  /** 注册工具，返回幂等 Disposer（卸载插件时自动移除工具） */
  register(tool: ToolDefinition, options?: RegisterToolOptions): Disposer;
  /** 产出喂给模型的工具 Schema 列表（不含 execute） */
  getSchemas(): { name: string; description: string; parameters: Record<string, any> }[];
  /** 列出当前已注册的工具及其归属（只读，不修改状态） */
  list(): ToolRegistration[];
  /** 执行工具：前置 waterfall → 真实执行 → 后置 waterfall */
  execute(name: string, args: any): Promise<any>;
}

/** 同名工具已存在且未声明 replace */
export class DuplicateToolError extends Error {
  constructor(
    public toolName: string,
    public existingOwner: string,
    public incomingOwner: string,
  ) {
    super(`工具 "${toolName}" 已由 "${existingOwner}" 注册，拒绝 "${incomingOwner}" 覆盖注册`);
    this.name = 'DuplicateToolError';
  }
}

/** 工具定义未通过校验 */
export class InvalidToolDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidToolDefinitionError';
  }
}
