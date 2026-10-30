# 全仓代码质量审查与精简建议

日期：2026-10-30。状态：静态审查完成；Q01 自动回归与部分桌面交互已验证，真实生成等场景待验收；Q02 与 Q03 运行时保护已实现、尚未运行测试；Q04 闲置模块及专属样式已清理，Q05 音视频工具栏预设执行、Q06 历史筛选、Q07 参考媒体串行处理、Q08 模型协议基础逻辑已合并，均待用户验收；Q09～Q11 尚未实施。

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

原问题：[共享包围盒](../../src/utils/nodeBounds.ts) 只读业务估值，吸附与分组命中则各有实测／样式／业务值的回退顺序，默认尺寸也有重复实现；[压缩副本](../../src/services/imageLosslessCompression.ts) 按共享包围盒右边界放置，可能与放大后的原图重叠。新建分组还按节点数组预计算尺寸，却按选择顺序使用，顺序不同时会错配不同节点的尺寸。这些是源码结论，未做桌面复现。

实施方案（2026-10-30，已实现）：

1. 在现有 `nodeBounds.ts` 增加纯尺寸读取入口。宽高分别选择有效正数：`measured` → React Flow `width/height` → `initialWidth/initialHeight` → 数值或 px 样式 → 业务卡片／笔记尺寸 → 类型默认。前两项描述已有显示边界；没有实测值的节点按后续声明估算，不将估算写回节点。百分比、auto 和相对单位不能脱离容器解析，跳过。
2. [吸附](../../src/hooks/useNodeSnap.ts)、共享包围盒、[分组命中](../../src/store/store.nodes.ts) 和[新建分组包围盒](../../src/store/store.groups.ts) 共用 `getNodeSize()`；吸附父链仍使用 Map，几何位置与历史提交沿用原路径。新建分组直接读取当前节点尺寸，不再用数组下标关联选择顺序。逐镜排版和折叠展开的目标尺寸保留原职责，Q03 父链循环保护不在本项处理。
3. 默认尺寸按生成／源媒体同类解析；过滤非有限值、零和负值，笔记缺少卡片镜像字段时可按自身尺寸估算。读取过程不改写节点，不新增持久化字段、依赖或权限。
4. 新增 [nodeBounds 回归](../../tests/utils/nodeBounds.test.ts)，补充 [groupFolders](../../tests/store/groupFolders.test.ts) 和 [imageLosslessCompression](../../tests/services/imageLosslessCompression.test.ts)，覆盖优先级、异常值、音频／笔记／未挂载分组、嵌套坐标、反向选择与压缩副本放置。

状态：已完成源码、引用、UTF-8 和差异空白静态核对；提交时复用既有钩子执行本批 7 个 TS 文件的定向 ESLint。本次未运行测试、类型检查、构建或桌面验收，待用户验收；Q01 的既有结果不代表 Q02 已验证。

Tauri 桌面验收：

1. 在测试项目准备不同宽高的图片、音频和画布笔记，缩放图片后分别拖拽对齐与平均分布；吸附线、间距手柄应贴合当前显示边界，音频不因旧卡片高度产生额外间距。
2. 以不同顺序选中两个大小明显不同的节点创建分组，分组应包住同一内容范围；撤销／重做保留位置和成员。把未生成音频移到展开分组的边缘，按节点中心判定入组；回归嵌套分组移动、折叠展开及隐藏子节点不参与吸附。
3. 对放大的组内可压缩 PNG／JPEG 执行“无损压缩”。实际产生副本时，应位于原图当前右边缘外 40 个画布单位，纵坐标与原图绝对坐标一致；没有压缩收益时沿用不创建副本的行为。
4. 保存重开项目，再检查音频、笔记、分组和图片首次挂载前后的尺寸恢复；比例／auto 样式无法独立换算时安全采用业务估值。异常数值和未实测场景优先由下列定向回归覆盖。

回归命令（仓库根目录，尚未执行）：`npx vitest run tests/utils/nodeBounds.test.ts tests/hooks/useNodeSnap.test.ts tests/store/groupFolders.test.ts tests/services/imageLosslessCompression.test.ts tests/components/distributionGapHandles.test.tsx`。类型检查按需执行 `npm run typecheck` 与 `npm run test:typecheck`。

回滚：撤销共享尺寸读取及四处接入、对应回归和文档差异；节点记录与项目存储格式不迁移。Q03 的独立实施状态见下文。

### Q03 P2 两处父级遍历缺少循环终止条件

原问题：[nodeBounds.ts](../../src/utils/nodeBounds.ts) 和 [useNodeSnap.ts](../../src/hooks/useNodeSnap.ts) 曾各自通过无 visited 集合的 `while (pid)` 累加父级偏移；[store.nodes.ts](../../src/store/store.nodes.ts) 另有带循环保护的同类逻辑。A 的父级为 B、B 的父级为 A 时，前两处自身无法结束遍历。这是静态控制流结论，未实际加载损坏归档。

实施结果（2026-10-30）：

1. `nodeBounds.ts` 的 `getParentOffset()` 统一父链偏移计算，visited 从当前节点 ID 开始；每个祖先至多累加一次，自引用、祖先重复或父节点缺失时终止。保留已找到祖先的偏移，不改写父链。
2. `getNodeBounds()` 支持数组和 Map 查找；吸附直接复用共享包围盒与 `NodeBounds` 类型，移除重复的父链、包围盒实现和类型声明。Map 直接按 ID 查父节点，不重新转成数组；原预计算、回调、视口裁剪和尺寸规则沿用。
3. 分组 `absoluteNodePosition()` 复用共享偏移，移除本地重复遍历；未变更 Store Action、历史提交和持久化结构。
4. [nodeBounds 回归](../../tests/utils/nodeBounds.test.ts) 同时覆盖数组／Map 的自引用、两节点循环、上游祖先循环、缺失父级、合法多级链和当前传入位置，另含 2,000 层 Map 父链；异常用例限制查询次数，保护失效时直接失败，避免挂住测试进程。[groupFolders](../../tests/store/groupFolders.test.ts) 补充历史自引用分组不重复累加自身坐标的回归。

状态：运行时终止保护已实现，完成源码、引用、UTF-8 与差异空白静态核对；提交时复用既有钩子执行本批 5 个 TS 文件的定向 ESLint。本次未运行测试、类型检查、构建或桌面验收，待用户验收。

边界：运行时截断只保证本项几何遍历结束，不表示异常父链可由整个 React Flow 或其他模块合法加载。[projectTransferService.ts](../../src/services/projectTransferService.ts) 的归档形状检查尚未校验节点父链，归档入口的拒绝／修复策略仍需独立处理；本次不变更导入合同，也不自动修复历史数据。

Tauri 桌面验收：

1. 准备含合法嵌套分组、图片、音频和笔记的测试项目，拖动组内节点进行边缘／中心吸附和平均分布；父组移动后再操作，预期祖先偏移只累加一次，不出现坐标漂移。
2. 新建、拖入／拖出普通分组，回归成员关系、绝对位置及撤销／重做；组内图片生成压缩副本时仍按当前绝对右边缘放置。保存重开后合法项目布局应一致。
3. 自引用、循环、缺失父节点与深链由本次纯几何／Store 定向回归验收，检查有限返回、坐标约定与原记录不变；这不替代归档入口和其他模块的坏数据验证。

回归命令（仓库根目录，尚未执行）：`npx vitest run tests/utils/nodeBounds.test.ts tests/hooks/useNodeSnap.test.ts tests/store/groupFolders.test.ts tests/services/imageLosslessCompression.test.ts tests/components/distributionGapHandles.test.tsx`。类型检查按需执行 `npm run typecheck` 与 `npm run test:typecheck`。

回滚：撤销共享父链保护、吸附／分组接入、对应回归及文档差异；无数据库迁移、依赖、权限或原始节点记录变更。

## 已确认的精简候选

### Q04 P3 四个模块未找到使用入口

2026-10-30 已按用户要求重新核对并删除：

| 已删除文件 | 静态核对依据 | 当前使用入口 |
|---|---|---|
| `src/components/ProjectSwitchOverlay.tsx` | 无导入、重导出或组件使用点 | [App.tsx](../../src/App.tsx) 通过 `showProjectSplash`／`splashReady` 使用 `SplashScreen`，仍读取 `switchingProjectName` |
| `src/components/nodes/shared/VideoNodeControls.tsx` | 无导入或组件使用点；七个专属 CSS 类及两项视频进度／音量变量只由本文件使用 | [VideoNode.tsx](../../src/components/nodes/VideoNode.tsx) 使用公共 [VideoPlayer.tsx](../../src/components/shared/VideoPlayer.tsx) |
| `src/services/ai/providers/runninghubImage.ts` | 旧包装函数 `generateRunningHubImagesBatch` 及参数类型无仓内调用或重导出；项目为 private 包，无此模块的发布入口 | [mediaProviderRegistry.ts](../../src/services/ai/mediaProviderRegistry.ts) 注册 [runninghubMedia.ts](../../src/services/ai/providers/runninghubMedia.ts) 的标准 Adapter |
| `src/components/shared/mascot/loadingText.ts` | `createLoadingText` 与 `LoadingText` 类型无导入或调用点 | [Mascot.tsx](../../src/components/shared/mascot/Mascot.tsx) 的加载状态使用 `createOrbitRibbons` 彩带动画 |

删除前实数为四个模块 444 行，并删除 [nodes.css](../../src/styles/nodes.css) 中 153 行独占控件规则（含悬浮、聚焦、滑块和减少动态效果分支），合计 597 行，包含注释与空行。同步移除目录清单和架构说明中的过期入口。此数字表示源码维护量，不代表生产包一定减少相同体积，未引用模块可能已被构建工具排除。

静态核对覆盖仓内源码、测试、SDK、脚本、配置、入口与文档中的文件名、导出符号、动态加载和专属选择器；当前 `import.meta.glob` 只加载工作流 JSON，不为上述四个模块提供入口。已经排除误报：[mcpCaptureWorker.ts](../../src/services/mcp/mcpCaptureWorker.ts) 由 [mcpUiRuntimeService.ts](../../src/services/mcp/mcpUiRuntimeService.ts) 通过 `new Worker(new URL(...))` 加载，继续保留。共享 Store 字段、视频播放器、翻译词条、标准 Adapter、动画与 Three.js 依赖不在本次删除范围。

本次未运行测试，待用户验收；未执行 ESLint、类型检查、构建或桌面实测。仅完成引用复核、差异空白检查及 UTF-8 编码确认。

Tauri 桌面验收（准备两个现有项目、可播放的本地视频及已有 RunningHub 模型配置）：

1. 从项目库打开项目，再通过项目栏切换到另一项目；预期加载遮罩正常完成、画布可交互，快速连续切换不会残留遮罩。
2. 打开已有视频节点，检查紧凑预览和全屏播放器的播放／暂停、进度拖动、静音及音量调节；预期控制正常、画面比例不变，深浅主题与减少动态效果下无样式缺失。
3. 打开 RunningHub 图片／视频／音频模型选择与参数面板；预期目录和参数正常。需要验证真实提交时使用既有生成入口，成功／失败与恢复仍由标准 Adapter 处理（会产生模型调用费用）。
4. 在既有模型请求期间观察吉祥物；预期显示当前彩带加载态，完成后恢复，性能模式和关闭动态效果的行为保持原样。

回滚：恢复这四个文件、对应专属 CSS 及本节相关文档差异；无数据或配置迁移。

### Q05 P3 音频和视频工具栏重复执行预设

原问题：[AudioNodeToolbar.tsx](../../src/components/nodes/shared/AudioNodeToolbar.tsx) 与 [VideoNodeToolbar.tsx](../../src/components/nodes/shared/VideoNodeToolbar.tsx) 重复编排读取最新节点和预设、判断顺序预设、解析动作、创建节点与边及启动生成。

2026-10-30 已实现：

- 既有 [presetAction.ts](../../src/components/nodes/shared/toolbar/presetAction.ts) 增加 `executeToolbarPreset`，点击时从同一份最新 Store 快照读取源节点、预设及写入 Action。源节点或预设已失效时直接结束；顺序预设优先交给 `requestPresetSequence`，不提前创建节点或调用模型。
- 普通预设继续经 `resolvePresetAction`／`createPresetNode` 解析与派生，通过 `addNodeWithEdge` 一次提交节点和连线及历史，再将含 `@{源节点:名称}` 的完整提示词与新节点数据交给 `executeGeneration`。保留 direct／insertPrompt 在工具栏中派生并生成的既有行为、模型与工作流解析及后处理参数。
- 两个工具栏保留 `stopPropagation`、稳定回调和各自按钮交互，移除重复业务体、仅执行时需要的 Action 订阅和多余类型转换。文本、图片、全景工具栏及 Agent／MCP 调用保留原入口；无依赖、配置或持久化迁移。
- 在 [presetNodeWorkflow.test.ts](../../tests/components/presetNodeWorkflow.test.ts) 补充两种媒体共 8 个回归场景，覆盖最新提示词／预设、替换／追加、源引用与 ComfyUI 身份、一次历史及生成、顺序预设分流和已删除目标。用例已编写，尚未执行。

Q05 已提交为 `3b70ec9a`，提交钩子完成 4 个 TS／TSX 文件的定向 ESLint。回归用例尚未运行，类型检查、构建与桌面实测仍待用户验收；实现阶段仅完成调用链、差异、UTF-8／原 BOM 与换行及空白静态核对。

Tauri 桌面验收（准备测试项目、音频／视频素材节点、可用模型，以及对应的普通和顺序预设）：

1. 分别选中音频和视频节点，保持工具栏显示，更新源提示词、名称及预设模板后点击预设；预期只新增一个对应生成节点和一条连线，提示词采用最新内容并保留源节点与已有素材引用，原始素材不变，生成只启动一次。
2. 普通预设分别使用 direct 与 insertPrompt；预期模板替换／追加规则、模型覆盖和 ComfyUI 工作流身份与原行为一致。一次撤销移除本次派生节点及连线，重做恢复；保存重开后引用和连线仍正确。
3. 点击顺序预设，预期先打开既有运行配置，确认前节点数及连线数不变；取消不发起模型调用，确认后按原 Runner 执行。回归视频截帧、全屏及反推，音频播放、转录和语音识别，以及工具栏编辑与更多菜单。

自动回归由用户在仓库根目录执行：`npx vitest run tests/components/presetNodeWorkflow.test.ts tests/services/presetSequencePlan.test.ts tests/services/presetSequenceRunner.test.ts`；类型检查可执行 `npm run typecheck` 与 `npm run test:typecheck`。以上命令本批均未运行。

回滚：恢复两个工具栏、共享 `presetAction.ts`、相应回归用例和本节文档差异。

### Q06 P3 历史筛选规则重复

[store.historyRecord.ts](../../src/store/store.historyRecord.ts) 和 [indexedDbService.ts](../../src/services/indexedDbService.ts) 的 `matchesHistoryQuery` 函数体相同；本批调用链复核还确认 [OutputHistoryPanel.tsx](../../src/components/OutputHistoryPanel.tsx) 的筛选与之同义。

2026-10-30 已实现：

- 新增 [historyQuery.ts](../../src/utils/historyQuery.ts) 的纯函数 `matchesHistoryQuery`，只引用领域类型，不加载 Store 或数据库。节点类型仍精确匹配；关键词去首尾空白、忽略大小写，在提示词／输出／模型／节点名称中任一命中。空条件表示不限，不扩展到供应商、错误信息或参数字段。
- [Store](../../src/store/store.historyRecord.ts) 新增记录、[面板](../../src/components/OutputHistoryPanel.tsx) 内存列表、数据库分页及导出共用该函数，删除原两份谓词及面板中的同义规则。`HistoryQuery` 移至 [types/index.ts](../../src/types/index.ts)，数据库服务保留类型重导出，既有导入路径可继续使用；保留持久化记录的字符串类型兼容性。
- 项目隔离仍由各调用入口负责，查询身份比较、分页游标、倒序读取、失效素材过滤和每项目 16 条保留策略均沿用原实现，无数据、索引或配置迁移。
- 在 [imageGenerationHistory.test.ts](../../tests/services/imageGenerationHistory.test.ts) 补充一项集成回归，使用 9 组查询条件对比内存筛选、每页 2 条的数据库游标读取与完整导出，覆盖四个搜索字段、大小写、首尾／纯空白、类型与关键词组合、未命中、旧类型字符串、项目隔离和相同时间戳排序。用例已编写，尚未执行。

Q06 已提交为 `b0ad129c`，提交钩子完成 6 个 TS／TSX 文件的定向 ESLint。回归用例尚未运行，类型检查、构建与桌面实测仍待用户验收；实现阶段仅完成调用链、差异、UTF-8／原 BOM 与换行及空白静态核对。

Tauri 桌面验收（准备两个有现存生成历史的项目，当前项目包含文本、图片、视频和音频记录）：

1. 打开「输出历史」，分别搜索某条记录的提示词、输出、模型与节点名称；改变关键词大小写并添加首尾空格，预期命中相同记录，按原倒序排列。
2. 组合选择节点类型与关键词，再试纯空白、无结果和「全部」；预期类型与关键词同时生效，清空搜索后恢复该类型记录。对各筛选结果导出 JSON，核对记录范围及顺序与面板一致。
3. 保持筛选时等待已有生成任务完成；匹配的新记录进入列表，不匹配的记录在切换到对应条件后可见。回归历史面板固定／展开、查看原节点、删除记录及清空操作。
4. 切换到另一项目并重复筛选，预期只显示及导出当前项目记录；重开面板后结果正确。分页边界与同时间戳数据由上述每页 2 条的集成用例补充验收。

自动回归由用户在仓库根目录执行：`npx vitest run tests/services/imageGenerationHistory.test.ts tests/store/historyRecord.test.ts`；类型检查可执行 `npm run typecheck` 与 `npm run test:typecheck`。以上命令本批均未运行。

回滚：恢复 Store、数据库服务、面板和领域类型中的本批差异，移除共享筛选文件及新增回归，恢复相关文档状态；无需回滚数据。

### Q07 P3 参考媒体串行处理重复

[generateVideo.ts](../../src/services/ai/generateVideo.ts) 和 [apimartMedia.ts](../../src/services/ai/providers/apimartMedia.ts) 的 `mapSequentially` 完全重复，后续 `resolveImageUrlsSequentially` 也相同。

2026-10-30 已实现：

- 新增 [referenceMediaPreparation.ts](../../src/services/ai/referenceMediaPreparation.ts)，原样迁入并导出 `mapSequentially` 和 `resolveImageUrlsSequentially`。串行映射逐项开始前检查取消，透传原取消原因，首个失败即结束；保持输入顺序、重复项、原下标与空数组语义，不引入额外并发或重试。
- 两个调用方移除本地副本并导入共享函数，所有业务调用及参数保持原样。图片仍每次以单张数组交给 `resolveImageUrlArray`，完整传递厂商与 signal；首尾帧、参考角色及图片／视频／音频映射顺序不变。火山引用分支原有的单张图片解析继续保留。
- 现有 [referenceImageUpload.ts](../../src/services/ai/referenceImageUpload.ts) 的最多两项并发、[batchUtils.ts](../../src/services/ai/batchUtils.ts) 的部分成功合同均继续独立使用；它们不替代本项串行路径。请求级 Data URL 总预算、上传限制、模型提交、轮询与暂停恢复不变，无依赖或数据迁移。
- 新增 [referenceMediaPreparation.test.ts](../../tests/services/referenceMediaPreparation.test.ts) 的 6 个回归场景，覆盖前项等待、重复输入及下标、失败停止且不重试、开始前／项间取消及原因透传、空输入、逐张图片解析与厂商／信号传递。用例已编写，尚未执行。

Q07 已提交为 `ff5b5d57`，提交钩子完成 4 个 TS 文件的定向 ESLint。回归用例尚未运行，类型检查、构建与桌面实测仍待用户验收；实现阶段仅完成调用链、迁移文本、UTF-8／原 BOM 与换行及差异空白静态核对。

Tauri 桌面验收（准备测试项目、已有的通用视频模型协议与 APIMart 配置、两张可区分图片及视频／音频参考素材，优先使用可控测试接口）：

1. 通用视频协议分别加入本地和远端图片、视频、音频；预期素材按既有顺序和原连接策略准备，图片逐张处理，提示词引用编号与对应素材一致，准备完成后才进入原模型提交流程。
2. 使用当前 APIMart 配置中支持首尾帧／多参考的模型，组合首帧、尾帧和普通参考；预期角色与顺序保持，音视频仍沿用原公共上传入口。回归火山方舟已有图片／视频／音频参考及虚拟人像素材路径。
3. 在可控接口中阻塞第一份素材，预期后一份尚未开始；令第二份素材准备失败或中途取消，预期停止后续项、保留原错误／取消表现，不因合并新增提交重试。
4. 回归空参考、单张图片、原始模型引用顺序，以及超出既有媒体预算时的拒绝；生成后的查询／暂停／继续保存沿用原任务身份。最大两项并发的其他图片路径仍按原策略工作。

自动回归由用户在仓库根目录执行：`npx vitest run tests/services/referenceMediaPreparation.test.ts tests/services/generateVideo.test.ts tests/services/apimartGen.test.ts tests/services/referenceImageUpload.test.ts tests/services/mediaReferenceMemoryGuards.test.ts`；类型检查可执行 `npm run typecheck` 与 `npm run test:typecheck`。以上命令本批均未运行。

回滚：恢复两个调用方中的本地函数及导入，移除共享模块与新增回归文件，并恢复本节相关文档状态；无数据回滚。

### Q08 P3 模型协议基础逻辑未完全收口

原问题：RelayOn／LIBAPI 的规范协议比较函数相同；Shared／Response 重复声明危险路径集合，Body 重复 MIME 正则；对象形状判断散落在多个子模块，其中 JSON 成员与 unknown 成员的类型收窄不同。本批进一步确认 Import 的危险字面量键集合也与共享集合完全相同。

2026-10-30 已实现：

- [modelProtocol.ts](../../src/services/ai/modelProtocol.ts) 承接原样迁入的 `comparableProtocol`，复用既有解析入口，递归排序对象键后比较完整规范协议；数组顺序仍有意义，无法解析或不适用的协议继续返回 undefined。[RelayOn](../../src/services/ai/providers/relayonModelManifest.ts)／[LIBAPI](../../src/services/ai/providers/libapiModelManifest.ts) 仅改为导入，型号识别、严格合同匹配、旧模板兼容和用户自定义分支均保留。
- [modelProtocolShared.ts](../../src/services/ai/modelProtocolShared.ts) 保留唯一 MIME 正则和危险路径集合；[Body](../../src/services/ai/modelProtocolBody.ts)／[Response](../../src/services/ai/modelProtocolResponse.ts) 直接复用，[Import](../../src/services/ai/modelProtocolImport.ts) 将危险键集合以原局部名导入。常量内容不变，路径的自身属性检查、multipart 元数据处理及原错误分支不变。
- 共享 `isRecord` 保留原运行时对象形状检查，增加已知 `ProtocolJsonValue | undefined` 与 unknown 输入的两个类型重载。Body／Import 的输入已经是 JSON 域类型，继续保留 JSON 成员收窄；Response／[Runtime](../../src/services/ai/modelProtocolRuntime.ts) 的未知数据仍只得到 unknown 成员，不借浅层对象判断递归认定 JSON 合法性。四处本地实现已移除，无新增泛型断言或宽泛类型转换。
- 比较函数留在已依赖解析器的协议入口，共享基础模块不反向依赖入口；未新增文件、依赖、厂商合同、鉴权策略或数据迁移。
- 在现有 [modelProtocol.test.ts](../../tests/services/modelProtocol.test.ts) 补充 9 个回归场景，覆盖对象键序／数组顺序、输入不被改写、无法比较的配置、JSON／unknown 成员类型、三个危险路径段，以及校验与 multipart 编码对三种非法 MIME 的拒绝。用例已编写，尚未执行；类型断言仍待测试类型检查。

本次未运行测试，待用户验收；未执行 Q08 ESLint、类型检查、构建、厂商调用或桌面实测。仅完成引用、调用链、迁移文本、UTF-8／原 BOM 与混合换行及差异空白静态核对。

Tauri 桌面验收（准备已有的 RelayOn／LIBAPI 测试模型配置、自定义协议与可控测试接口）：

1. 打开既有内置模型的协议编辑入口，仅调整 JSON 对象字段顺序，核对原能力及生成变量转换仍能识别；改变引用数组顺序时保留新顺序。修改提交路径、响应路径或其他合同内容后，预期按用户自定义协议处理，不被内置快照覆盖。
2. 回归已保存的 RelayOn 旧模板及 LIBAPI 型号别名，核对原兼容行为；未配置或缺少自定义协议时沿用原拒绝／未识别结果，不误用某一厂商合同。
3. 使用响应预览和协议校验，分别输入含 `__proto__`、`prototype`、`constructor` 的路径；预期均被拒绝或无匹配，普通自身字段、数组通配和数字下标继续可用。
4. 导入既有 cURL／Fetch／JSON 示例并预览 JSON、form-urlencoded 与 multipart 请求；核对变量、文件名、凭据／Base64 脱敏及危险字段处理。合法 MIME 正常编码，含换行、缺少子类型或夹带参数的非法声明不被接受。
5. 使用可控接口回归同步结果、异步查询、参考媒体、取消与暂停恢复；错误和未知响应不因共享对象判断而被当作成功结果。

自动回归由用户在仓库根目录执行：`npx vitest run tests/services/modelProtocol.test.ts tests/services/modelProtocolImport.test.ts tests/services/relayonModelManifest.test.ts tests/services/libapiModelManifest.test.ts`；类型检查可执行 `npm run typecheck` 与 `npm run test:typecheck`。以上命令本批均未运行。

回滚：恢复现有协议入口、Shared、Body／Response／Runtime／Import、两个厂商清单中的本批差异，以及相应回归与文档状态；无数据回滚。

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

最初文件头整理的静态核对确认：移除新增注释、将搬移注释放回原处后，原始文件字节摘要一致，差异空白检查通过。该批只改注释；后续 Q01～Q08 修改与验收缺口见上文。

以下为全仓剩余验收，未执行全仓检查或原生检查；Q01 的定向结果见上文：

1. 在仓库根目录执行 `npm run check`，检查前端 lint、源码与测试类型及现有回归；若出现仓库规则记录的 ESLint 工具链错误，单独记录，不修改依赖绕过。
2. 在 `src-tauri/` 执行 `cargo check --lib`，确认原生源码与构建脚本编译。
3. 使用既有 Tauri 开发入口打开画布、文本／音频节点、资产库、ComfyUI 管理和插件设置；确认页面可打开、交互与原版本一致，文件头不会进入产品显示内容。
4. Q01 继续补齐上述桌面剩余场景，Q02／Q03 按各自步骤执行尺寸、父链与布局验收，Q04 回归项目切换、公共视频播放器、RunningHub 入口与吉祥物加载态，Q05 回归音视频工具栏普通及顺序预设，Q06 回归历史面板筛选、分页及导出，Q07 回归参考媒体准备顺序、取消、失败与预算边界，Q08 回归合同比较、协议导入／编码和安全校验；不能用静态核对替代功能验收。

## 建议实施批次

1. **默认模型与几何行为收敛**：Q01 自动回归与部分桌面交互已验证，真实生成等场景仍待验收；Q02 与 Q03 运行时保护已实现、尚未运行测试；归档坏父链的入口策略仍待独立处理，保留源码与测试的独立回退点。
2. **闲置入口与局部重复清理**：Q04 闲置模块与专属样式清理、Q05 音视频工具栏预设执行合并、Q06 历史筛选共享、Q07 参考媒体串行准备共享、Q08 协议基础逻辑收口已实现，尚未运行测试；Q09 待实施，每批保持同一业务领域。
3. **低收益统一与热点重构**：处理 Q10、Q11；大模块只有在具体维护需求或性能证据出现时再按职责拆分。

除已明确实施的 Q01、Q02、Q03 运行时保护、Q04 闲置模块清理、Q05 预设执行合并、Q06 历史筛选共享、Q07 参考媒体串行准备共享与 Q08 协议基础逻辑收口外，其余均为建议，不构成架构改动、删除文件、新增依赖或运行测试的授权。
