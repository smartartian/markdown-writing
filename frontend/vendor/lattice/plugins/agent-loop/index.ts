// Lattice plugin: agent loop

import { definePlugin } from '../../context.js';
import {
  LatticeCoreServiceMap,
  ChatMessage,
  AgentService,
  AgentStep,
  AgentRunResult,
} from '../../contracts/index.js';

const DEFAULT_MAX_STEPS = 5;

/** Agent 主循环插件：声明依赖 ['tools', 'llm']，就绪后 provide 出 agent 服务 */
export const AgentLoopPlugin = definePlugin<LatticeCoreServiceMap>()({
  id: 'agent-loop',
  name: 'agent-loop',
  version: '0.0.1',
  inject: ['tools', 'llm'],
  apply(ctx) {
    const agent: AgentService = {
      async run(goal, opts = {}): Promise<AgentRunResult> {
        // inject 已声明 ['tools', 'llm']，由 PluginContext 推导出类型，无需断言
        const tools = ctx.tools;
        const llm = ctx.llm;
        const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

        const traceId = `trace_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const steps: AgentStep[] = [];
        const history: ChatMessage[] = [{ role: 'user', content: goal }];

        console.log(`\n==============================================`);
        console.log(`🚀 [AgentTurn] 开始处理: "${goal}" (${traceId})`);
        console.log(`==============================================`);

        for (let idx = 0; idx < maxSteps; idx++) {
          const response = await llm.chat(history, tools.getSchemas());
          history.push(response);
          steps.push({ idx, kind: 'llm', input: goal, output: response, ts: Date.now() });

          // 没有工具调用，说明模型已产出最终答复
          if (!response.tool_calls || response.tool_calls.length === 0) {
            console.log(`\n🤖 [Agent 最终答复]:\n${response.content}`);
            steps.push({ idx, kind: 'final', output: response.content, ts: Date.now() });
            return { traceId, answer: response.content ?? '', steps };
          }

          // 处理工具调用
          for (const call of response.tool_calls) {
            console.log(`\n⚙️  [Agent 执行工具]: ${call.name}`);
            const result = await tools.execute(call.name, call.args);
            history.push({
              role: 'tool',
              content: JSON.stringify(result),
            });
            steps.push({ idx, kind: 'tool', input: call, output: result, ts: Date.now() });
          }
        }

        console.log(`\n🏁 [AgentTurn] 运行完成\n`);
        return { traceId, answer: '超过最大执行步数。', steps };
      },
    };

    ctx.provide('agent', agent);
  },
});
