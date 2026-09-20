// Lattice plugin: tools
//
// tools 能力插件：提供 ToolService 的默认实现（ToolsService）。
//
// 契约在 contracts/tools.ts，这里只放实现 —— 所以本文件对内核（ContainerDisposedError）
// 与契约（ToolDefinition 等）的依赖方向是「插件 → 内核/契约」，内核不会反过来知道它。

import {
  Context,
  ContainerDisposedError,
  Disposer,
  ServiceMap,
  definePlugin,
} from '../../context.js';
import {
  LatticeCoreServiceMap,
  ToolDefinition,
  ToolRegistration,
  RegisterToolOptions,
  ToolService,
  TOOL_NAME_PATTERN,
  DuplicateToolError,
  InvalidToolDefinitionError,
} from '../../contracts/index.js';

/** 工具条目：带所有者与代次，使覆盖可追溯、注销可保持幂等 */
interface ToolEntry {
  definition: ToolDefinition;
  ownerId: string;
  generation: number;
  state: 'active' | 'disposing';
}

function validateToolDefinition(tool: ToolDefinition) {
  if (!tool || typeof tool !== 'object') {
    throw new InvalidToolDefinitionError('工具定义必须是对象');
  }
  if (typeof tool.name !== 'string' || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new InvalidToolDefinitionError(
      `工具名不合法: ${JSON.stringify(tool.name)}，需匹配 ${TOOL_NAME_PATTERN}`,
    );
  }
  if (typeof tool.description !== 'string' || !tool.description.trim()) {
    throw new InvalidToolDefinitionError(`工具 "${tool.name}" 缺少非空 description`);
  }
  if (!tool.parameters || typeof tool.parameters !== 'object') {
    throw new InvalidToolDefinitionError(`工具 "${tool.name}" 的 parameters 必须是 JSON Schema 对象`);
  }
  if (typeof tool.execute !== 'function') {
    throw new InvalidToolDefinitionError(`工具 "${tool.name}" 缺少 execute 函数`);
  }
}

export class ToolsService<S extends ServiceMap = ServiceMap> implements ToolService {
  private _tools = new Map<string, ToolEntry>();
  private _generation = 0;

  constructor(private ctx: Context<S>) {}

  /**
   * 注册工具，返回幂等 Disposer（卸载插件时自动移除工具）。
   *
   * - 容器非 active（disposing / disposed）时直接拒绝
   * - 默认同名注册直接抛 DuplicateToolError；只有 `{ replace: true }` 才允许替换
   * - 先完成名称 / Schema / execute 校验再改动 Map，保证注册原子化
   * - 返回的 Disposer 只在代次仍匹配时生效，旧 Disposer 重复调用是安全空操作
   */
  register(tool: ToolDefinition, options: RegisterToolOptions = {}): Disposer {
    // 0. 容器状态守卫：disposing / disposed 期间拒绝任何新增注册
    const containerState = this.ctx.root.state;
    if (containerState !== 'active') {
      throw new ContainerDisposedError('tools.register', containerState);
    }

    // 1. 校验阶段：任何失败都不触碰内部状态
    validateToolDefinition(tool);

    const ownerId = options.ownerId ?? this.ctx.ownerId;
    const existing = this._tools.get(tool.name);
    if (existing && existing.state === 'active') {
      if (!options.replace) throw new DuplicateToolError(tool.name, existing.ownerId, ownerId);
      console.log(`  [ToolsService] ~ 替换工具: ${tool.name}（${existing.ownerId} → ${ownerId}）`);
      void this.ctx.root.emit('tools:replaced', {
        name: tool.name,
        from: existing.ownerId,
        to: ownerId,
      });
    }

    // 2. 提交阶段
    const entry: ToolEntry = {
      definition: tool,
      ownerId,
      generation: ++this._generation,
      state: 'active',
    };
    this._tools.set(tool.name, entry);
    console.log(`  [ToolsService] + 注册工具: ${tool.name}（owner: ${ownerId}）`);

    return () => {
      const current = this._tools.get(tool.name);
      if (current !== entry) return; // 已被替换或已注销 → 空操作
      if (current.state === 'disposing') return;
      current.state = 'disposing';
      this._tools.delete(tool.name);
      console.log(`  [ToolsService] - 注销工具: ${tool.name}`);
    };
  }

  getSchemas() {
    return [...this._tools.values()]
      .filter((entry) => entry.state === 'active')
      .map(({ definition: { name, description, parameters } }) => ({
        name,
        description,
        parameters,
      }));
  }

  /** 列出已注册工具及归属：只读快照，供控制台与审计使用 */
  list(): ToolRegistration[] {
    return [...this._tools.values()]
      .filter((entry) => entry.state === 'active')
      .map(({ definition: { name, description }, ownerId }) => ({ name, description, ownerId }));
  }

  /** 执行工具：通过 waterfall 拦截流水线 */
  async execute(name: string, args: any): Promise<any> {
    const entry = this._tools.get(name);
    if (!entry || entry.state !== 'active') throw new Error(`未找到工具: ${name}`);

    // 快照：注销只影响后续查询，不中断已经开始执行的调用
    const definition = entry.definition;

    // 1. 前置拦截 (tools/pre-execute)：用于参数校验、安全审查、甚至篡改输入
    const input = await this.ctx.root.runWaterfall('tools/pre-execute', { name, args });

    // 2. 实际执行
    const rawResult = await definition.execute(input.args);

    // 3. 后置拦截 (tools/post-execute)：用于格式化、敏感词脱敏
    const output = await this.ctx.root.runWaterfall('tools/post-execute', { name, result: rawResult });
    return output.result;
  }
}

/** 工具管理服务插件 */
export const ToolsPlugin = definePlugin<LatticeCoreServiceMap>()({
  id: 'tools-service',
  name: 'tools-service',
  version: '0.0.1',
  apply(ctx) {
    ctx.provide('tools', new ToolsService(ctx));
  },
});
