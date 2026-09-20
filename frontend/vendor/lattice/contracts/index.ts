// Lattice contracts
//
// 契约层统一出口。三层结构：
//   context.ts   内核：Context / 生命周期 / 事件 / Waterfall / Disposer（零依赖）
//   contracts/   本目录：能力接口与数据类型 + 应用服务表（只依赖内核的类型）
//   plugins/     具体实现（依赖内核 + 契约）
//
// 调用方（main.ts / web-server.ts / 各插件）只从本文件导入能力类型与服务表，
// 不要从 plugins/ 里导入实现（ToolsService 这类具体类只在 plugins/tools/ 内部使用）。

export * from './tools.js';
export * from './llm.js';
export * from './agent.js';
export * from './verify.js';
export * from './telemetry.js';
export * from './web-server.js';
export * from './plugin-inventory.js';
export * from './plugin-manager.js';
export * from './service-map.js';
