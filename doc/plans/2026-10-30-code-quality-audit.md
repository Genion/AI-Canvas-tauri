# 全仓代码质量审查与精简建议

日期：2026-10-30。状态：静态审查完成；Q01 已实现，自动回归与部分桌面交互已验证，真实生成及其余桌面场景待验收；其他业务精简尚未实施。

建议先收敛模型默认值和节点几何计算，再清理闲置模块、合并同领域重复函数。前两项已经存在实现差异；全仓建立通用抽象或批量拆分大文件的收益较低，影响面更难控制。

## 范围与依据

- 使用 Ponytail、Code、React 最佳实践、React Flow Code Review 与 Security Auditor Skill。
- 全仓进行文件清点、函数体及代码片段比对、导入关系分析、依赖引用搜索；对下列问题追踪真实调用链。扫描结果是静态候选，未把名称相似直接当作重复功能。
- 主要覆盖 `src/` 的 1,029 个源码与样式文件、原生侧 `src-tauri/src/` 的 74 个文件、8 个工程脚本和 581 个测试文件；同时核对根配置、SDK、页面启动脚本及 npm 锁文件。
- 第三方源码、构建产物、缓存和生成的 MCP 适配器不作为精简对象。翻译词条、模型目录与测试用例不因文本相似而批量删除。
- 最初全仓审查仅做静态核对；后续经用户授权执行的 Q01 自动检查与桌面交互见下文。未运行全仓检查、Cargo、构建或性能基准，未进行联网依赖漏洞核验。其余条目的“已确认”仍指源码与调用关系已确认，不代表功能实测通过。

## 优先处理的行为风险

### Q01 P2 模型偏好在展示与执行之间存在分叉

原问题：NodeMenu 新建文本／音频未写入历史模型身份，选择器却从 localStorage 显示历史模型；[generationService.ts](../../src/services/generationService.ts) 只读取节点或项目默认值，因而可能显示已选、实际拒绝生成。四个新建 Hook 另有各自的偏好解析。

已实现：

- [modelPreferenceService.ts](../../src/services/modelPreferenceService.ts) 统一偏好读写和类型回退。UI 新建按“当前项目默认 → 本类型历史偏好 → 对应文本／图片类型兜底 → 未选”解析，保留完整 `model/provider/workflowId`。
- [NodeMenu](../../src/components/NodeMenu.tsx)、[Sidebar](../../src/components/Sidebar.tsx)、[双击／导入 Hook](../../src/hooks/useNodeCreation.ts)、[快捷键](../../src/hooks/useKeyboardShortcuts.ts)、[右键菜单](../../src/hooks/useCanvasContextMenu.ts) 与[连线新建](../../src/hooks/useConnectionDropMenu.ts) 共用该解析，在现有 Store Action 提交节点时写入身份；四份重复加载函数已移除。
- [ModelSelector](../../src/components/nodes/shared/ModelSelector.tsx) 只显示调用方实际绑定值，不读取历史偏好冒充当前选择，也不通过 Effect 回填旧节点或临时表单。显式清空继续保持未选；用户真实选择时才保存偏好，`persistPreference=false` 继续不保存。
- 图片／视频空节点的既有参数偏好回填只复用共享读取器，没有扩展到其他类型；未修改生成执行器、Agent／MCP 工具或模型授权。源媒体导入不自动绑定，导演台继续使用自己的模型入口。
- 偏好为损坏 JSON、非对象或无效模型引用时安全降级，不自动改写存储；项目默认工作流完整保留 `workflowId`。无依赖、权限或数据库迁移。

2026-10-30 验证结果（用户已授权测试）：

- 5 个定向 Vitest 文件、63 项用例通过，覆盖偏好优先级、完整节点绑定、工作流身份、损坏存储、选择器受控展示与源媒体导入边界。
- `npm run typecheck`、`npm run test:typecheck` 与本批 13 个 TS／TSX 文件的定向 ESLint 均通过。检查发现的 React 编译器 memo 依赖问题已修正；修正后两套类型检查、定向 ESLint 与选择器 16 项用例复跑通过。
- 在当前 Tauri 开发窗口的“测试”画布，通过右键菜单新建音频／图片临时节点。未绑定音频显示“选择模型”且生成按钮禁用；图片继承已有模型偏好，清空后关闭重开仍保持未选；后续新建图片仍继承原偏好。临时节点与清空动作均已撤销，原香水节点和连线保留，未发起生成请求。
- 该项目原有文本默认模型已隐藏，本次未修改项目配置。项目默认／文本与音频历史偏好／工作流优先级由自动回归覆盖，尚未在此画布完成对应桌面实测。其他新建入口的完整桌面遍历、保存重开、跨项目／独立窗口与真实模型调用仍待验收；未运行构建。

Tauri 桌面剩余验收：

1. 准备可用的文本和音频模型，各选择一次保存偏好；当前项目不设默认模型。分别通过浮动菜单、侧栏、快捷键、右键及连线菜单新建，检查显示与节点实际绑定一致，手动生成时不再提示未选择模型。
2. 为项目设另一文本／音频模型及图片工作流，再新建节点；预期项目默认优先，工作流选择与真实 `workflowId` 一致。动画自带提示词不能使历史图片偏好抢占项目默认。
3. 清除当前节点模型后关闭重开、保存重开，预期保持未选；打开旧的无模型节点或空反推／预设表单时不展示虚假的历史选择，真实已绑模型不被改写。
4. 回归源图片／视频／音频导入、预设步骤显式选择、临时润色选择、分镜与全景类型目录，以及主／独立助手的实际绑定。切换项目、撤销／重做与保存重开保持原语义；Agent／MCP 不新增 UI 偏好回退。

已执行的回归命令（仓库根目录）：`npx vitest run tests/services/modelPreferenceService.test.ts tests/components/nodeMenuModelPreferences.test.tsx tests/components/modelSelectorWorkflows.test.tsx tests/hooks/useNodeCreation.test.tsx tests/services/projectSettingsService.test.ts`。类型检查命令为 `npm run typecheck` 与 `npm run test:typecheck`；修正后的选择器复跑命令为 `npx vitest run tests/components/modelSelectorWorkflows.test.tsx`。

回滚：撤销本项共享偏好解析、UI 调用及对应回归差异；已有节点、项目默认和 localStorage 存储格式不迁移、不清理。Q02～Q11 不在本次实现范围。

### Q02 P2 节点尺寸计算存在多套优先级

证据：

- [nodeBounds.ts:63](../../src/utils/nodeBounds.ts#L63) 的 `getNodeBounds` 使用 `data.nodeWidth/nodeHeight` 或类型默认值。
- [useNodeSnap.ts:82](../../src/hooks/useNodeSnap.ts#L82) 的 `resolveNodeSize` 优先使用 `measured`，再回退到数据、节点尺寸和样式。
- [store.nodes.ts:331](../../src/store/store.nodes.ts#L331) 的 `nodeSize` 又使用另一套尺寸优先级。
- [nodeBounds.ts:7](../../src/utils/nodeBounds.ts#L7) 与 [useNodeSnap.ts:44](../../src/hooks/useNodeSnap.ts#L44) 的默认尺寸函数体完全重复。
- [imageLosslessCompression.ts:109](../../src/services/imageLosslessCompression.ts#L109) 使用 `getNodeBounds` 的右边界放置压缩副本。

影响：当实际测量尺寸与持久化估值不一致时，吸附、分组命中和派生节点布局可能采用不同边界。例如实际宽度大于 `data.nodeWidth` 时，按旧宽度放置的副本可能与原节点重叠。尚未进行桌面复现。

建议：先定义“实际显示尺寸”和“未挂载节点估算尺寸”的明确合同，再复用尺寸解析与默认尺寸。保留吸附路径现有 Map 索引，避免统一后退化为反复全表查找。不要机械地把所有入口替换成当前任意一套实现。

验收重点：拖拽缩放后的节点、音频卡片、分组、嵌套分组、画布笔记及未挂载节点；检查吸附线、入组命中与新副本位置。

### Q03 P2 两处父级遍历缺少循环终止条件

证据：[nodeBounds.ts:45](../../src/utils/nodeBounds.ts#L45) 和 [useNodeSnap.ts:60](../../src/hooks/useNodeSnap.ts#L60) 的父级遍历只有 `while (pid)`，没有 visited 集合；[store.nodes.ts:316](../../src/store/store.nodes.ts#L316) 已有带循环保护的同类实现。[projectTransferService.ts:233](../../src/services/projectTransferService.ts#L233) 的归档形状检查只确认节点、边等为数组，该入口没有校验节点父链。

对于 A 的父级为 B、B 的父级为 A 的输入，前两个函数自身无法结束遍历。这是静态控制流结论，未实际加载此类归档。

建议：合并父级坐标累加的纯逻辑，保留索引方式与循环保护；归档边界另外明确坏父链的拒绝或修复策略。入口校验和运行时终止保护各有职责，不能相互替代。

验收重点：自引用、两节点循环、父节点缺失及合法多级分组；异常输入应能结束处理，合法坐标不变。

## 已确认的精简候选

### Q04 P3 四个模块未找到使用入口

| 文件 | 当前结果 | 建议 |
|---|---|---|
| [ProjectSwitchOverlay.tsx](../../src/components/ProjectSwitchOverlay.tsx) | 没有导入或组件使用点 | 确认当前项目切换遮罩已承担职责后删除 |
| [VideoNodeControls.tsx](../../src/components/nodes/shared/VideoNodeControls.tsx) | 没有导入或组件使用点 | 与仅供它使用的 `.video-node-controls` 等样式一起核对后删除 |
| [runninghubImage.ts](../../src/services/ai/providers/runninghubImage.ts) | 旧兼容入口无仓内调用 | 确认无需保留外部兼容入口后删除 |
| [loadingText.ts](../../src/components/shared/mascot/loadingText.ts) | `createLoadingText` 无仓内调用 | 确认旧粒子动画已停用后删除 |

四个文件合计约 448 行，包含注释和空行；关联样式未计入。此数字表示源码维护量，不代表生产包一定减少相同体积，未引用模块可能已被构建工具排除。

已经排除误报：[mcpCaptureWorker.ts](../../src/services/mcp/mcpCaptureWorker.ts) 由 [mcpUiRuntimeService.ts:99](../../src/services/mcp/mcpUiRuntimeService.ts#L99) 通过 `new Worker(new URL(...))` 加载，不能删除。当前 `import.meta.glob` 用于工作流 JSON，不为上述四个模块提供入口。

### Q05 P3 音频和视频工具栏重复执行预设

[AudioNodeToolbar.tsx:57](../../src/components/nodes/shared/AudioNodeToolbar.tsx#L57) 与 [VideoNodeToolbar.tsx:93](../../src/components/nodes/shared/VideoNodeToolbar.tsx#L93) 的预设点击处理体相同：读取最新节点和预设、判断顺序预设、解析动作、创建节点与边、启动生成。

建议在既有 [presetAction.ts](../../src/components/nodes/shared/toolbar/presetAction.ts) 所属领域收口这段编排，两个工具栏保留自身按钮与交互。必须继续在点击时读取实时 Store，保持顺序预设、一次历史提交与生成入口的既有语义。

### Q06 P3 历史筛选规则重复

[store.historyRecord.ts:40](../../src/store/store.historyRecord.ts#L40) 和 [indexedDbService.ts:977](../../src/services/indexedDbService.ts#L977) 的 `matchesHistoryQuery` 函数体相同。

建议复用一个不依赖 Store 或数据库的纯筛选函数；内存列表、分页读取和导出共用规则。验收节点类型、大小写、空白查询、分页及导出结果一致性。

### Q07 P3 参考媒体串行处理重复

[generateVideo.ts:87](../../src/services/ai/generateVideo.ts#L87) 和 [apimartMedia.ts:41](../../src/services/ai/providers/apimartMedia.ts#L41) 的 `mapSequentially` 完全重复，后续 `resolveImageUrlsSequentially` 也相同。

建议在媒体准备领域复用串行映射与图片解析函数。已有 [referenceImageUpload.ts:124](../../src/services/ai/referenceImageUpload.ts#L124) 的 `mapReferenceImagesInOrder` 最多并发两项，合同不同，不能直接替换串行实现。必须保留引用顺序、取消传播、失败停止与现有内存上限，不增加提交重试。

### Q08 P3 模型协议基础逻辑未完全收口

- [relayonModelManifest.ts:199](../../src/services/ai/providers/relayonModelManifest.ts#L199) 与 [libapiModelManifest.ts:275](../../src/services/ai/providers/libapiModelManifest.ts#L275) 的 `comparableProtocol` 完全相同，可复用协议解析与稳定比较逻辑。
- [modelProtocolShared.ts:29](../../src/services/ai/modelProtocolShared.ts#L29) 已定义危险路径段，但 [modelProtocolResponse.ts:9](../../src/services/ai/modelProtocolResponse.ts#L9) 再次定义同一集合。
- [modelProtocolShared.ts:48](../../src/services/ai/modelProtocolShared.ts#L48) 与 [modelProtocolBody.ts:9](../../src/services/ai/modelProtocolBody.ts#L9) 重复定义 MIME 正则。
- `isRecord` 在协议子模块中重复；其中返回类型有 `unknown` 与 `ProtocolJsonValue` 的区别，合并前必须核对类型收窄，不能只替换函数名。

建议优先复用已有共享模块，不建立全仓通用校验框架。厂商各自的旧合同兼容分支继续保留；不能把“比较函数相同”解释为“厂商合同相同”。

### Q09 P3 其他适合顺手合并的小重复

| 领域 | 位置 | 合并边界 |
|---|---|---|
| ComfyUI 响应错误处理 | [comfyWorkflowService.ts:58](../../src/services/comfyWorkflowService.ts#L58)、[comfyMemory.ts:63](../../src/services/comfyMemory.ts#L63) | 保持响应读取与异常文案合同 |
| ComfyUI 工作流文件名清洗 | [comfyAgentService.ts:480](../../src/services/comfyAgentService.ts#L480)、[comfyUIWindowService.ts:68](../../src/services/comfyUIWindowService.ts#L68) | 清洗逻辑共用，调用方授权仍各自保留 |
| 视频元素资源释放 | [viewportVideoResource.ts:4](../../src/components/shared/viewportVideoResource.ts#L4)、[canvasVideoPreviewCache.ts:45](../../src/components/nodes/shared/video/canvasVideoPreviewCache.ts#L45) | 已有通用释放函数，优先复用 |
| 字节数组相等判断 | [projectFiles.ts:96](../../src/services/fs/projectFiles.ts#L96)、[directorSceneService.ts:57](../../src/services/directorSceneService.ts#L57) | 只复用字节比较，不合并文件写入权限或场景绑定 |

这些重复本身没有证明运行错误，适合随对应模块的小步维护处理，不值得单独引入多层抽象。

### Q10 P3 分组节点的 memo 边界不一致

[GroupNode.tsx:74](../../src/components/nodes/GroupNode.tsx#L74) 直接导出函数，其他主要自定义节点及自定义边使用 `memo`。它已有细粒度子节点数量与封面 selector，不应为添加 memo 而重新订阅整张画布。

建议评估直接补齐组件 memo；实际收益需要在多分组、大画布拖拽场景观察渲染次数，本轮不声称存在已测得的性能下降。

### Q11 P4 动画依赖入口可以统一，当前没有重复核心版本证据

[PanoramaViewer.tsx:28](../../src/components/nodes/panorama/internal/PanoramaViewer.tsx#L28) 使用 `motion/react`，项目其余多数地方使用 `framer-motion`；`package.json` 同时直接声明两者。

锁文件中 `motion` 与 `framer-motion` 均为 12.43.0，后者只有一份解析记录。因此可以统一导入入口、减少一个直接依赖声明，但不能据此宣称当前打包了两套动画核心。依赖修改与锁文件更新留待单独实施。

## 保留的边界与暂缓的重构

- 原生公网 IP 判断在 [agent/web.rs:323](../../src-tauri/src/agent/web.rs#L323) 与 [agent/provider_docs.rs:55](../../src-tauri/src/agent/provider_docs.rs#L55) 重复，可另行考虑复用纯 IP 判断；URL 策略不同：普通网页允许 HTTP(S) 标准端口，厂商文档只允许 HTTPS 443。不能整体合并或放松入口限制。
- 插件前端租约、Rust 活动 revision、资源摘要和最终写回检查分别位于不同信任边界；相似检查不能按普通重复逻辑删除。
- `registry.rs`、`pluginRuntime.ts`、`pollManager.ts`、`MentionEditor.tsx` 等大文件适合按稳定职责逐步收口。`registry.rs` 的总行数还包含大量内嵌单元测试，不能直接把文件总行数当作业务逻辑规模或要求一次拆完。
- 依赖导入扫描没有找到完全无人引用的直接运行依赖；这只证明存在引用，不能替代依赖漏洞检查或生产包体积分析。

## React Flow 审查门槛

| 检查项 | 静态结论 |
|---|---|
| Provider 边界 | 画布内容及相关 Hook 位于 `Canvas.tsx:1882` 的 Provider 内；Portal 保留组件上下文 |
| nodeTypes／edgeTypes 稳定性 | 在 `Canvas.tsx:141`、164、173 行的模块作用域定义 |
| 自定义节点与边 memo | 主要节点与边已有 memo；GroupNode 的缺口见 Q10 |
| 重计算与交互回调 | 关键路径使用 selector、缓存、useMemo 与 useCallback；实际热点与收益仍待性能观察 |
| 节点与边更新 | 沿用 Store Action 与不可变更新；批量写入已有 `addNodesWithEdges`，不能为精简改成循环单次写入 |
| data 更新接口 | 本项目以 Zustand 为权威，复用 Store Action；不直接改成 React Flow 自身写入接口 |
| 连线几何 | 已有共享模型、路径与裁剪模块；不建议重新建立第二套几何层 |
| fitView | 使用初始视口选项及显式事件入口，未发现每次 render 都调用的模式；聚焦路径存在 400ms 过渡 |
| 容器、样式与端口 | 画布容器具有尺寸，默认样式已导入，端口使用 Position 常量 |
| 交互隔离与类型 | 主要交互复用 nodrag／nopan 与领域 Props；全组件可访问性及拖拽交互未做实机遍历 |

## 已完成修改与验收入口

文件头处理共 936 个文件：新增 927 处职责或回归用例说明，将 9 处已有说明移到 import 前。第三方与生成文件未改。保留 UTF-8、BOM、原换行方式和脚本 shebang。

最初文件头整理的静态核对确认：移除新增注释、将搬移注释放回原处后，原始文件字节摘要一致，差异空白检查通过。该批只改注释；后续 Q01 业务修改与验收缺口见上文。

以下为全仓剩余验收，未执行全仓检查或原生检查；Q01 的定向结果见上文：

1. 在仓库根目录执行 `npm run check`，检查前端 lint、源码与测试类型及现有回归；若出现仓库规则记录的 ESLint 工具链错误，单独记录，不修改依赖绕过。
2. 在 `src-tauri/` 执行 `cargo check --lib`，确认原生源码与构建脚本编译。
3. 使用既有 Tauri 开发入口打开画布、文本／音频节点、资产库、ComfyUI 管理和插件设置；确认页面可打开、交互与原版本一致，文件头不会进入产品显示内容。
4. Q01 继续补齐上述桌面剩余场景；后续实施 Q02～Q03 时补对应行为回归，覆盖撤销重做和异常父链，不能用本次注释的静态核对替代功能验收。

## 建议实施批次

1. **默认模型与几何行为收敛**：Q01 已实现，自动回归与部分桌面交互已验证，真实生成等场景仍待验收；Q02～Q03 仍待确认并分领域实施，保留源码与测试的独立回退点。
2. **闲置入口与局部重复清理**：确认 Q04 的兼容需求后删候选，再处理 Q05～Q09；每批保持同一业务领域。
3. **低收益统一与热点重构**：处理 Q10、Q11；大模块只有在具体维护需求或性能证据出现时再按职责拆分。

除已明确实施的 Q01 外，其余均为建议，不构成架构改动、删除文件、新增依赖或运行测试的授权。
