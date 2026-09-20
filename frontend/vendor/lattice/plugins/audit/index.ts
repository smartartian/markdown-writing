// Lattice plugin: audit

import { definePlugin } from '../../context.js';
import { LatticeCoreServiceMap } from '../../contracts/index.js';

/** 安全/审计拦截插件：演示 Lattice 的 waterfall 机制 */
export const AuditPlugin = definePlugin<LatticeCoreServiceMap>()({
  id: 'audit-plugin',
  name: 'audit-plugin',
  version: '0.0.1',
  apply(ctx) {
    // 拦截工具执行前置
    ctx.waterfall('tools/pre-execute', async (req: any, next) => {
      console.log(`  [Audit 🛡️] 校验工具调用: ${req.name}，参数:`, JSON.stringify(req.args));
      return next(); // 放行
    });

    // 拦截工具执行结果
    ctx.waterfall('tools/post-execute', async (res: any, next) => {
      console.log(`  [Audit 🛡️] 工具 ${res.name} 执行完毕，返回值: ${res.result}`);
      return next();
    });
  },
});
