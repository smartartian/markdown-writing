// Lattice plugin: calculator tool

import { definePlugin } from '../../context.js';
import { LatticeCoreServiceMap } from '../../contracts/index.js';

/** 计算器工具插件：声明依赖 ['tools']，就绪后注册工具 */
export const CalculatorToolPlugin = definePlugin<LatticeCoreServiceMap>()({
  id: 'calculator-tool',
  name: 'calculator-tool',
  version: '0.0.1',
  inject: ['tools'],
  apply(ctx) {
    // 显式用 ctx.effect 绑定副作用：即使注册工具之后插件的初始化又失败，
    // 工具也会随子上下文回滚，不会残留在 ToolsService 里。
    ctx.effect(
      ctx.tools.register(
        {
          name: 'calculate',
          description: '执行简单的数学表达式计算',
          parameters: {
            type: 'object',
            properties: { expression: { type: 'string', description: '数学表达式' } },
            required: ['expression'],
          },
          execute: async (args: { expression: string }) =>
            Function(`"use strict"; return (${args.expression});`)(),
        },
        { ownerId: ctx.ownerId },
      ),
    );
  },
});
