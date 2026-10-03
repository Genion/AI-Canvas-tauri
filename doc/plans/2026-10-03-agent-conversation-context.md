# Agent 对话续接与 Pi 上下文机制接入

状态：代码与自动验证已完成；真实模型与桌面验收待补。

## 范围与来源

第一阶段改善“继续上一任务”“修改刚才结果”和长工具链的上下文衔接，复用现有 Runtime、Store、Registry 与 Policy，不替换整个 Agent 框架。

改编来源为 [Pi](https://github.com/earendil-works/pi)，固定 revision `a276dabe57911253350bffb93cb7d7aff6a73261`。接入 `compaction.ts` 的倒序预算与有效切点算法、`utils.ts` 的带角色序列化，适配应用自己的消息与工具快照。MIT 许可与改编说明随应用分发在 [Pi-LICENSE.txt](../../public/licenses/Pi-LICENSE.txt)、[Pi-NOTICE.txt](../../public/licenses/Pi-NOTICE.txt)。没有新增 npm/cargo 依赖。

源码入口：

- [contextTranscript.ts](../../src/services/chat/contextTranscript.ts)：完整历史轮次、工具调用/结果切点、脱敏任务记录与压缩输入序列化。
- [contextManager.ts](../../src/services/chat/contextManager.ts)：同项目、同会话历史结果注入，按连续完整轮次保留最近历史。
- [contextCompressionService.ts](../../src/services/chat/contextCompressionService.ts)：历史压缩与执行中的内存 checkpoint，项目模型路由、取消与结果校验。
- [agentRuntime.ts](../../src/services/chat/agentRuntime.ts)：续聊规则与模型轮次前的压缩接入。

## 行为与固定边界

- “继续”“按刚才的方案做”“修改刚才结果”结合近期对话和执行记录解释；明确的新目标仍不能自动触发历史中的其他请求。普通问答允许直接完整回答。
- 历史工具记录只从消息关联的同项目、同会话 AgentTask 注入，包含状态、结果摘要与节点/资产引用；不复制原始参数或网页、文件正文。不完整的活动消息占位不进入历史，暂停后的 partial 回复仍可使用。
- 历史裁剪保留连续的最近完整用户轮次，不跳过一段大历史后重新塞入更早的小消息；压缩覆盖边界不能拆开同时间戳消息。
- 执行消息达到约 90% 输入预算时尝试压缩早期内容，保留系统规则、当前用户目标、执行中补充要求和最近工具调用/结果对。摘要需包含规定区段及来源、节点/资产锚点；压缩无效或仍超限时暂停。固定目标与最近完整工具组本身过大时仍不能自动继续。
- 执行 checkpoint 仅在当前请求数组内存中替换，保持数组身份及任务步骤/画布 checkpoint，保留恢复写入去重。摘要请求禁用工具，使用任务项目模型，并把执行压缩的 token 与耗时计入任务指标；原有轮次、工具与终身预算仍复核。
- 历史摘要沿用原持久化类型与 Store Action；取消、会话离开当前内存或摘要版本发生变化后不写回。没有数据库 schema、工具权限或桌面安全配置变更。

## 自动验证与验收缺口

- 定向 Vitest：`agentConversationContext`、`contextManagerSources`、`contextCompression`、`agentRuntimeDiagnostics`、`agentApproval`、`agentRoundExecutor`。
- 前端与测试类型：`npm run typecheck`、`npm run test:typecheck`。
- 修改的四个源码文件与两个测试文件通过定向 ESLint。
- Vite 生产构建输出到系统临时目录；许可文件随 public 资源输出。构建存在大 chunk 与静态/动态重复导入提示，不作为运行时正确性的证据。
- UTF-8 编码与差异空白检查通过。

自动用例覆盖续聊工具结果与真实引用、无文本工具回复、连续轮次裁剪、跨项目/会话隔离、项目切换时的模型路由、取消与停止、无效摘要暂停、执行压缩后继续完成、恢复写入去重。模型请求由测试替身提供，因此不能据此认定真实模型的主观对话质量已经改善。

尚未完成：真实厂商多轮对话、桌面双窗口、重启后实机续接与付费媒体验收。当前只改上下文与续聊，不接入 Pi 的 Provider、文件/进程工具、会话存储或整个执行器。

## 回滚

撤回上述源码改动、移植辅助文件及其引用即可恢复原对话链路；没有依赖升级、数据库迁移或历史删除。期间生成的历史摘要仍使用既有 formatVersion 2，可由原版本读取。
