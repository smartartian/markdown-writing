// Lattice plugin: mock LLM

import { definePlugin } from '../../context.js';
import { LatticeCoreServiceMap, LLMService } from '../../contracts/index.js';

/** 模拟 LLM 服务插件（展示 Tool Calling 驱动） */
export const MockLLMPlugin = definePlugin<LatticeCoreServiceMap>()({
  id: 'mock-llm-service',
  name: 'mock-llm-service',
  version: '0.0.1',
  apply(ctx) {
    const mockLLM: LLMService = {
      async chat(messages, _tools) {
        const lastMsg = messages[messages.length - 1];

        // 第一次用户输入：模拟 LLM 决策调用计算器
        if (lastMsg.role === 'user') {
          console.log(`  [LLM] 收到提问: "${lastMsg.content}" -> 决定调用计算工具`);
          return {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_1',
                name: 'calculate',
                args: { expression: '25 * 4 + 10' },
              },
            ],
          };
        }

        // 第二次拿到 Tool 结果：模型生成总结
        if (lastMsg.role === 'tool') {
          console.log(`  [LLM] 收到工具执行结果: ${lastMsg.content} -> 整理成最终回答`);
          return {
            role: 'assistant',
            content: `计算完成，结果为：${lastMsg.content}`,
          };
        }

        return { role: 'assistant', content: '未能识别意图。' };
      },
    };
    ctx.provide('llm', mockLLM);
  },
});
