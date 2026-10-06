import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppState } from '../../src/store/useAppStore';
import type { AssetFileEntry, AssetFolderEntry } from '../../src/services/fileService';
import { createUISlice } from '../../src/store/store.ui';
import type { NodeType } from '../../src/types';

interface Element { type: unknown; props: Record<string, unknown> & { children?: unknown } }
const driver = vi.hoisted(() => ({
  store: null as StoreApi<AppState> | null,
  states: [] as unknown[], refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{ deps?: readonly unknown[]; cleanup?: () => void }>,
  pending: [] as Array<() => void>, stateIndex: 0, refIndex: 0, effectIndex: 1,
  dirty: false, listProject: vi.fn(), listGlobal: vi.fn(), listExternal: vi.fn(), drag: vi.fn(),
  portal: vi.fn((children: unknown) => children),
  memos: [] as Array<{ value: unknown; deps: readonly unknown[] }>, memoIndex: 0,
  reduceMotion: true,
  createFolder: vi.fn(), resolveFolder: vi.fn(), copyFolder: vi.fn(), copyClipboard: vi.fn(), readClipboard: vi.fn(),
  globalFolders: [] as AssetFolderEntry[],
}));

// 与仓库其他组件交互测试一样，驱动真实组件的状态、effect 和事件，不依赖 DOM 库。
vi.mock('react', async () => {
  const memo = <T,>(factory: () => T, deps: readonly unknown[]) => {
    const index = driver.memoIndex++;
    const previous = driver.memos[index];
    if (!previous || deps.length !== previous.deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      driver.memos[index] = { value: factory(), deps };
    }
    return driver.memos[index].value as T;
  };
  return {
  ...await vi.importActual<typeof import('react')>('react'),
  useCallback: <T,>(callback: T, deps: readonly unknown[]) => memo(() => callback, deps),
  useMemo: memo,
  useDeferredValue: <T,>(value: T) => value,
  useState: <T,>(initial: T | (() => T)) => {
    const index = driver.stateIndex++;
    if (!(index in driver.states)) driver.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [driver.states[index], (next: T | ((old: T) => T)) => {
      const value = typeof next === 'function' ? (next as (old: T) => T)(driver.states[index] as T) : next;
      if (!Object.is(value, driver.states[index])) driver.dirty = true;
      driver.states[index] = value;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = driver.refIndex++;
    driver.refs[index] ??= { current: initial };
    return driver.refs[index];
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = driver.effectIndex++;
    const previous = driver.effects[index];
    if (previous && deps?.length === previous.deps?.length && deps?.every((dep, i) => Object.is(dep, previous.deps?.[i]))) return;
    // render 阶段的状态调整可能重绘；提交最后一次渲染的 effect。
    driver.pending[index] = () => {
      previous?.cleanup?.();
      driver.effects[index] = { deps, cleanup: effect() ?? undefined };
    };
  },
  };
});
vi.mock('zustand/react/shallow', () => ({ useShallow: <T,>(selector: T) => selector }));
vi.mock('react-dom', () => ({ createPortal: driver.portal }));
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (state: AppState) => unknown) => selector(driver.store!.getState()), {
    getState: () => driver.store!.getState(),
  }),
}));
vi.mock('framer-motion', () => ({
  motion: { div: 'div', button: 'button' }, AnimatePresence: 'presence', MotionConfig: 'motion-config',
  useReducedMotion: () => driver.reduceMotion,
}));
vi.mock('../../src/services/fileService', async () => ({
  listProjectFiles: driver.listProject, listGlobalFiles: driver.listGlobal,
  listGlobalFolderContents: async () => ({ files: await driver.listGlobal(), folders: driver.globalFolders, truncated: false, rootPath: '/global/file' }),
  createAssetSubfolder: driver.createFolder, resolveAssetFolderDirectory: driver.resolveFolder, copyAssetFolder: driver.copyFolder,
  listExternalFolderContents: driver.listExternal,
  selectAssetFolderFiles: (await vi.importActual<typeof import('../../src/services/fs/assetLibrary')>('../../src/services/fs/assetLibrary')).selectAssetFolderFiles,
  extractFilesFromNodeData: () => null,
  addAssetFilesToGlobal: vi.fn(), pickAssetFolder: vi.fn(), saveAssetToPermanent: vi.fn(), deletePermanentFile: vi.fn(),
  CATEGORY_LABELS: { image: '图像', video: '视频', audio: '音频', text: '文本', other: '其他' },
}));
vi.mock('../../src/services/clipboardService', () => ({ copyFile: driver.copyClipboard, readClipboardFolders: driver.readClipboard }));
vi.mock('../../src/services/indexedDbService', () => ({
  getAllAssetMeta: async () => [], putAssetMeta: vi.fn(), deleteAssetMeta: vi.fn(),
}));
vi.mock('../../src/store/store.dramaAssets', () => ({ countUnreadDramaAssets: () => 0 }));
vi.mock('../../src/utils/assetDrag', () => ({ startAssetDrag: driver.drag, prepareDragIcon: async () => {} }));
vi.mock('../../src/utils/assetSearchWindow', () => ({ openAssetSearchWindow: vi.fn() }));
vi.mock('../../src/utils/nodeAnimations', () => ({ playNodeExit: vi.fn() }));
vi.mock('../../src/services/pollManager', () => ({ cancelNodePolling: vi.fn() }));
vi.mock('../../src/services/canvasPointerService', () => ({ getCanvasPointerPosition: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => { throw new Error('Web test'); } }));
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({}));
vi.mock('../../src/components/shared/AssetThumb', () => ({ default: 'asset-thumb' }));
vi.mock('../../src/components/shared/Select', () => ({ default: 'asset-select' }));
vi.mock('../../src/components/assets/AssetImagePreview', () => ({ default: 'asset-image-preview' }));

import AssetsPanel from '../../src/components/AssetsPanel';
import Tabs, { type TabsProps } from '../../src/components/shared/Tabs';
import AssetFolderNavigation, { type AssetFolderNavigationProps } from '../../src/components/assets/AssetFolderNavigation';
import { useKeyboardShortcuts } from '../../src/hooks/useKeyboardShortcuts';

class Target {
  tagName = 'DIV'; isContentEditable = false; canvas = true; control = false; drawer = false;
  closest(selector: string) {
    if (selector === '.react-flow') return this.canvas ? this : null;
    if (selector === '.assets-panel--drawer') return this.drawer ? this : null;
    return this.control ? this : null;
  }
}
let doc: EventTarget & { body: Target; documentElement: Target; querySelector: (selector: string) => Target | null };
let win: EventTarget;
let blockingModal: boolean;
let tree: unknown;

function all(root: unknown, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(root)) return root.flatMap((item) => all(item, predicate));
  if (!root || typeof root !== 'object' || !('props' in root)) return [];
  const element = root as Element;
  return [...(predicate(element) ? [element] : []), ...all(element.props.children, predicate)];
}
function find(predicate: (element: Element) => boolean): Element {
  const result = all(tree, predicate)[0];
  if (!result) throw new Error('Missing element');
  return result;
}
function button(label: string) { return find((el) => el.props['aria-label'] === label); }
function click(element: Element) { (element.props.onClick as () => void)(); }
// 展开真实 Tabs 子组件，沿用同一套 hook 驱动，保留业务级交互回归。
function renderTabs(root: unknown): unknown {
  if (Array.isArray(root)) return root.map(renderTabs);
  if (!root || typeof root !== 'object' || !('props' in root)) return root;
  const element = root as Element;
  if (element.type === Tabs) return Tabs(element.props as unknown as TabsProps);
  if (element.type === AssetFolderNavigation) return renderTabs(AssetFolderNavigation(element.props as unknown as AssetFolderNavigationProps));
  return { ...element, props: { ...element.props, children: renderTabs(element.props.children) } };
}
function render() {
  for (let pass = 0; pass < 5; pass++) {
    driver.stateIndex = 0; driver.refIndex = 0; driver.effectIndex = 1; driver.memoIndex = 0; driver.dirty = false;
    tree = renderTabs(AssetsPanel());
    if (!driver.dirty) break;
  }
  const pending = driver.pending;
  driver.pending = [];
  pending.forEach((effect) => effect());
}
async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); render(); }
function key(keyName = 'Tab', target = doc.body, options: Record<string, unknown> = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  Object.assign(event, { key: keyName, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...options });
  doc.dispatchEvent(event);
  return event;
}
function file(name: string, tags: string[] = []): AssetFileEntry {
  return { name, path: `assets/${name}.png`, category: 'image', size: 123, tags };
}
function cards() { return all(tree, (element) => !!element.props.file); }
function canvasNode(id: string, type: NodeType, label = id): AppState['nodes'][number] {
  return { id, type, position: { x: 0, y: 0 }, data: { type, label } };
}
function nodeRows() { return all(tree, (element) => typeof element.props['data-node-id'] === 'string'); }
function openNodeList() {
  click(all(tree, (el) => el.props.role === 'tab')[4]); render();
}

beforeEach(() => {
  driver.states = []; driver.refs = []; driver.effects = []; driver.pending = [];
  driver.memos = []; driver.memoIndex = 0;
  driver.reduceMotion = true;
  driver.globalFolders = [];
  driver.createFolder.mockReset().mockResolvedValue('/global/file/新建文件夹');
  driver.resolveFolder.mockReset().mockResolvedValue('/global/file');
  driver.copyFolder.mockReset().mockResolvedValue('/global/file/素材');
  driver.copyClipboard.mockReset().mockResolvedValue(true);
  driver.readClipboard.mockReset().mockResolvedValue(['/library/素材']);
  blockingModal = false;
  doc = Object.assign(new EventTarget(), {
    body: new Target(), documentElement: new Target(),
    querySelector: (selector: string) => selector === '.react-flow' || blockingModal ? doc.body : null,
  });
  win = new EventTarget();
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  driver.listProject.mockReset().mockResolvedValue([file('森林', ['夜景']), file('人物')]);
  driver.listGlobal.mockReset().mockResolvedValue([{ ...file('全局参考'), source: 'global' }]);
  driver.listExternal.mockReset().mockResolvedValue({ files: [], folders: [], truncated: false });
  driver.portal.mockClear();
  driver.store = createStore<AppState>()((set, get, api) => ({
    ...createUISlice(set, get, api), currentProjectId: 'project-1', nodes: [],
    projects: [{ id: 'project-1', name: '项目一' }], config: { assetWaterfallColumns: 6 },
    dramaAssets: { characters: [], scenes: [], props: [], lastViewedAt: 1 },
    setDramaAssetsPanelOpen: (open: boolean) => set({ dramaAssetsPanelOpen: open }),
    updateConfig: vi.fn(), saveConfig: vi.fn(), markDramaAssetsViewed: vi.fn(),
  } as unknown as AppState));
  driver.effectIndex = 0;
  useKeyboardShortcuts();
  driver.pending.forEach((effect) => effect());
  driver.pending = [];
});
afterEach(() => {
  driver.effects.forEach((effect) => effect?.cleanup?.());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('资产库 Tab 抽屉', () => {
  it('画布 Tab 打开/收起，长按不连发且不发生焦点跳转', () => {
    expect(key().defaultPrevented).toBe(true);
    expect(driver.store!.getState().assetsPanelMode).toBe('drawer');
    expect(driver.store!.getState().assetsPanelOpen).toBe(true);
    expect(key('Tab', doc.body, { repeat: true }).defaultPrevented).toBe(true);
    expect(driver.store!.getState().assetsPanelOpen).toBe(true);
    key();
    expect(driver.store!.getState().assetsPanelOpen).toBe(false);
  });

  it('抽屉滚动区、页签和搜索框获得焦点后按 Tab 收起，外部按钮保留焦点导航', () => {
    key(); render();
    expect(find((el) => el.props.role === 'tablist').props.tabIndex).toBe(-1);
    click(all(tree, (el) => el.props.role === 'tab')[2]); render();
    const otherButton = Object.assign(new Target(), { tagName: 'BUTTON', canvas: false, control: true });
    expect(key('Tab', otherButton).defaultPrevented).toBe(false);
    expect(driver.store!.getState().assetsPanelOpen).toBe(true);
    for (const target of [
      Object.assign(new Target(), { canvas: false, drawer: true }),
      Object.assign(new Target(), { tagName: 'BUTTON', canvas: false, control: true, drawer: true }),
      Object.assign(new Target(), { tagName: 'INPUT', canvas: false, control: true, drawer: true }),
    ]) {
      expect(key('Tab', target).defaultPrevented).toBe(true);
      expect(driver.store!.getState().assetsPanelOpen).toBe(false);
      driver.store!.getState().setAssetsPanelOpen(true, 'drawer');
    }
  });

  it.each(['shiftKey', 'ctrlKey', 'metaKey', 'altKey', 'isComposing'])('保留 %s + Tab', (modifier) => {
    expect(key('Tab', doc.body, { [modifier]: true }).defaultPrevented).toBe(false);
    expect(driver.store!.getState().assetsPanelOpen).toBe(false);
  });

  it('输入、按钮、画布外区域及上层弹窗均不被 Tab 抢占', () => {
    const input = Object.assign(new Target(), { tagName: 'INPUT' });
    const editable = Object.assign(new Target(), { isContentEditable: true });
    const control = Object.assign(new Target(), { control: true });
    const outside = Object.assign(new Target(), { canvas: false });
    for (const target of [input, editable, control, outside]) expect(key('Tab', target).defaultPrevented).toBe(false);
    blockingModal = true;
    expect(key().defaultPrevented).toBe(false);
    expect(driver.store!.getState().assetsPanelOpen).toBe(false);
    blockingModal = false;
    driver.store!.getState().setHelpOpen(true);
    expect(key().defaultPrevented).toBe(false);
  });

  it('抽屉不带全屏蒙层，原入口仍显示大弹窗', () => {
    key(); render();
    expect(find((el) => el.props.role === 'region').props['aria-modal']).toBeUndefined();
    expect(all(tree, (el) => el.props.className === 'assets-panel-backdrop')).toHaveLength(0);
    expect(driver.portal).not.toHaveBeenCalled();
    driver.store!.getState().setAssetsPanelOpen(true); render();
    expect(find((el) => el.props.role === 'dialog').props['aria-modal']).toBe(true);
    expect(all(tree, (el) => el.props.className === 'assets-panel-backdrop')).toHaveLength(1);
    expect(driver.portal).toHaveBeenLastCalledWith(expect.anything(), doc.body);
    expect(key().defaultPrevented).toBe(false);
  });

  it('抽屉从左侧整幅滑入并原向退出，关闭后保留退场宿主', () => {
    driver.reduceMotion = false;
    key(); render();
    const panel = find((el) => el.props.role === 'region');
    const variants = panel.props.variants as Record<string, Record<string, unknown>>;
    expect(variants.hidden).toMatchObject({ x: '-100%', opacity: 0 });
    expect(variants.visible).toMatchObject({ x: 0, opacity: 1 });
    expect(variants.exit).toMatchObject({ x: '-100%', opacity: 0 });
    const config = find((el) => el.type === 'motion-config');
    expect(config.props.reducedMotion).toBe('user');
    expect(config.props.transition).toEqual({ type: 'spring', visualDuration: 0.35, bounce: 0 });
    expect(variants.visible.transition).toEqual(config.props.transition);
    expect(variants.exit.transition).toEqual(config.props.transition);

    click(button('收起资产库')); render();
    expect(driver.store!.getState().assetsPanelOpen).toBe(false);
    expect(driver.store!.getState().assetsPanelMode).toBe('modal');
    expect(find((el) => el.type === 'motion-config').props.reducedMotion).toBe('user');
    expect(all(tree, (el) => el.type === 'presence')).toHaveLength(1);
    expect(all(tree, (el) => el.props.role === 'region')).toHaveLength(0);
  });

  it('系统减少动态效果时只淡入淡出，大弹窗不覆盖外层动效设置', () => {
    key(); render();
    const variants = find((el) => el.props.role === 'region').props.variants as Record<string, Record<string, unknown>>;
    expect(variants.hidden).toEqual({ x: 0, opacity: 0 });
    expect(variants.exit).toEqual({ x: 0, opacity: 0, transition: { duration: 0.12 } });
    expect(find((el) => el.type === 'motion-config').props.transition).toEqual({ duration: 0.12 });

    driver.store!.getState().setAssetsPanelOpen(true); render();
    expect(all(tree, (el) => el.type === 'motion-config')).toHaveLength(0);
  });

  it('抽屉固定三列且隐藏列数控件与提示，不改写大弹窗设置', async () => {
    key(); render(); await settle();
    expect(find((el) => el.props.className === 'assets-file-waterfall').props['data-columns']).toBe(3);
    expect(all(tree, (el) => el.props['aria-label'] === '瀑布流列数')).toHaveLength(0);
    expect(all(tree, (el) => el.props.className === 'assets-panel-subtitle')).toHaveLength(0);
    expect(driver.store!.getState().updateConfig).not.toHaveBeenCalled();
    driver.store!.getState().setAssetsPanelOpen(true); render();
    expect(button('当前 6 列').props.children).toBe(6);
    expect(button('减少瀑布流列数').props.disabled).toBe(false);
    expect(all(tree, (el) => el.props.className === 'assets-panel-subtitle')).toHaveLength(1);
  });

  it('复用名称/标签搜索、全局与创作页签，重新打开回到当前项目', async () => {
    key(); render(); await settle();
    expect(cards()).toHaveLength(2);
    const search = find((el) => el.props.placeholder === '搜索名称或标签…');
    (search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '夜景' } });
    render();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['森林']);
    const tabs = () => all(tree, (el) => el.props.role === 'tab');
    click(tabs()[1]); render(); await settle();
    // 资产库原行为：切换文件页签保留搜索词。
    expect(cards()).toHaveLength(0);
    click(button('清空')); render();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['全局参考']);
    click(tabs()[2]); render();
    expect(find((el) => el.props.compact === true)).toBeDefined();
    click(button('收起资产库')); render();
    key(); render(); await settle();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['森林', '人物']);
  });

  it('目录导航按本层筛选，子目录和空目录保留，全部资产仍汇总', async () => {
    const folders: AssetFolderEntry[] = [
      { rootPath: '/library', relativePath: '', parentRelativePath: null, name: '素材库', fileCount: 1, availability: 'online' },
      { rootPath: '/library', relativePath: '人物', parentRelativePath: '', name: '人物', fileCount: 1, availability: 'online' },
      { rootPath: '/library', relativePath: '人物/表情', parentRelativePath: '人物', name: '表情', fileCount: 1, availability: 'online' },
      { rootPath: '/library', relativePath: '空目录', parentRelativePath: '', name: '空目录', fileCount: 0, availability: 'online' },
    ];
    driver.listExternal.mockResolvedValue({ folders, truncated: false, files: [
      { ...file('根目录图片'), path: '/library/root.png', source: 'folder', tags: ['夜景'] },
      { ...file('人物图片'), path: '/library/人物/hero.png', source: 'folder' },
      { ...file('微笑视频'), path: '/library/人物/表情/smile.mp4', category: 'video', source: 'folder' },
    ] });
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    expect(cards()).toHaveLength(4);
    expect(all(tree, (el) => el.props.className === 'assets-folder-picker')).toHaveLength(1);
    expect(button('浏览文件夹 空目录')).toBeDefined();
    click(button('浏览文件夹 素材库')); render();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['根目录图片']);
    click(button('浏览文件夹 人物')); render();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['人物图片']);
    expect(button('浏览文件夹 表情')).toBeDefined();
    click(button('浏览文件夹 表情')); render();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['微笑视频']);
    click(button('浏览文件夹 空目录')); render();
    expect(cards()).toHaveLength(0);
    expect(all(tree, (el) => el.props.children === '此文件夹为空')).toHaveLength(1);
    click(button('导入文件')); render();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['全局参考']);
    click(button('全部资产')); render();
    expect(cards()).toHaveLength(4);
    expect(find((el) => el.props.className === 'assets-file-waterfall').props['data-columns']).toBe(3);
  });

  it('父目录只有子目录时给出导航提示，不混入子目录文件', async () => {
    driver.listExternal.mockResolvedValue({ truncated: false, folders: [
      { rootPath: '/library', relativePath: '', parentRelativePath: null, name: '素材库', fileCount: 0, availability: 'online' },
      { rootPath: '/library', relativePath: '人物', parentRelativePath: '', name: '人物', fileCount: 1, availability: 'online' },
    ], files: [{ ...file('人物图片'), path: '/library/人物/hero.png', source: 'folder' }] });
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    click(button('浏览文件夹 素材库')); render();
    expect(cards()).toHaveLength(0);
    expect(all(tree, (el) => el.props.children === '此文件夹没有本层文件，请选择子文件夹浏览')).toHaveLength(1);
    click(button('浏览文件夹 人物')); render();
    expect(cards()).toHaveLength(1);
  });

  it('目录切换重置类型筛选，但保留搜索并复用拖拽', async () => {
    driver.listExternal.mockResolvedValue({ truncated: false, folders: [
      { rootPath: '/library', relativePath: '', parentRelativePath: null, name: '素材库', fileCount: 2, availability: 'online' },
    ], files: [
      { ...file('人物图片'), path: '/library/hero.png', source: 'folder' },
      { ...file('人物视频'), path: '/library/hero.mp4', source: 'folder', category: 'video' },
    ] });
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    const search = find((el) => el.props.placeholder === '搜索名称或标签…');
    (search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '人物' } }); render();
    const videoFilter = find((el) => el.type === 'button' && Array.isArray(el.props.children) && el.props.children.includes('视频'));
    click(videoFilter); render();
    expect(cards()).toHaveLength(1);
    click(button('浏览文件夹 素材库')); render();
    expect(cards()).toHaveLength(2);
    expect(find((el) => el.props.placeholder === '搜索名称或标签…').props.value).toBe('人物');
    (cards()[0].props.onDragStart as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    expect(driver.drag).toHaveBeenCalledWith(expect.objectContaining({ path: '/library/hero.png' }));
  });

  it('无法访问和未扫描目录不冒充空目录，显示扫描上限提示', async () => {
    driver.listExternal.mockResolvedValue({ files: [], truncated: true, folders: [
      { rootPath: '/missing', relativePath: '', parentRelativePath: null, name: '离线目录', fileCount: 0, availability: 'offline' },
      { rootPath: '/large', relativePath: '', parentRelativePath: null, name: '未扫描目录', fileCount: 0, availability: 'unscanned' },
    ] });
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    expect(button('浏览文件夹 未扫描目录').props.disabled).toBe(true);
    expect(all(tree, (el) => el.props.role === 'status')).toHaveLength(1);
    click(button('浏览文件夹 离线目录')); render();
    expect(all(tree, (el) => el.props.children === '文件夹无法访问，请检查位置或权限')).toHaveLength(1);
  });

  it('取消目录引用后回到全部资产，并忽略迟到的旧扫描', async () => {
    const folder: AssetFolderEntry = { rootPath: '/library', relativePath: '', parentRelativePath: null,
      name: '素材库', fileCount: 1, availability: 'online' };
    const entry: AssetFileEntry = { ...file('外部图片'), path: '/library/hero.png', source: 'folder' };
    driver.store!.setState((state) => ({ config: { ...state.config, assetFolders: ['/library'] } }));
    driver.listExternal.mockResolvedValue({ files: [entry], folders: [folder], truncated: false });
    vi.mocked(driver.store!.getState().updateConfig).mockImplementation((patch) => {
      driver.store!.setState((state) => ({ config: { ...state.config, ...patch } }));
    });
    vi.mocked(driver.store!.getState().saveConfig).mockResolvedValue(undefined);
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    click(button('浏览文件夹 素材库')); render();
    expect(cards()).toHaveLength(1);
    driver.listExternal.mockResolvedValue({ files: [], folders: [], truncated: false });
    click(button('移除文件夹引用 素材库')); render(); await settle();
    expect(driver.store!.getState().config.assetFolders).toEqual([]);
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['全局参考']);
    expect(button('全部资产').props['aria-pressed']).toBe(true);

    let finishOld!: (value: { files: AssetFileEntry[]; folders: AssetFolderEntry[]; truncated: boolean }) => void;
    driver.listExternal.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    driver.store!.setState((state) => ({ config: { ...state.config, assetFolders: ['/old'] } })); render();
    driver.store!.setState((state) => ({ config: { ...state.config, assetFolders: ['/new'] } })); render(); await settle();
    finishOld({ files: [entry], folders: [folder], truncated: false }); await settle();
    expect(all(tree, (el) => el.props['aria-label'] === '浏览文件夹 素材库')).toHaveLength(0);
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['全局参考']);
  });

  it('文件夹右键创建真实子目录，失败保留名称并显示错误', async () => {
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    const context = button('导入文件').props.onContextMenu as (event: unknown) => void;
    context({ preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: {}, clientX: 100, clientY: 120 }); render();
    const menuItem = (label: string) => find((el) => el.props.role === 'menuitem' && (el.props.children as unknown[]).includes(label));
    click(menuItem('新建子文件夹')); render();
    (button('子文件夹名称').props.onChange as (event: unknown) => void)({ target: { value: '参考图' } }); render();
    driver.createFolder.mockRejectedValueOnce(new Error('同名文件夹或文件已存在'));
    (find((el) => el.props['aria-label'] === '新建子文件夹').props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    render(); await settle();
    expect(driver.createFolder).toHaveBeenCalledWith({ kind: 'global' }, [], '参考图');
    expect(button('子文件夹名称').props.value).toBe('参考图');
    expect(find((el) => el.props.role === 'alert').props.children).toBe('同名文件夹或文件已存在');
    (find((el) => el.props['aria-label'] === '新建子文件夹').props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    render(); await settle(); await settle();
    expect(all(tree, (el) => el.props['aria-label'] === '新建子文件夹')).toHaveLength(0);
    expect(driver.listGlobal.mock.calls.length).toBeGreaterThan(1);
  });

  it('右键系统复制与粘贴读取当前剪贴板，并把目录传给原生传输', async () => {
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    const openContext = () => {
      (button('导入文件').props.onContextMenu as (event: unknown) => void)({ preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: {}, clientX: 100, clientY: 120 }); render();
    };
    const item = (label: string) => find((el) => el.props.role === 'menuitem' && (el.props.children as unknown[]).includes(label));
    openContext(); click(item('复制文件夹')); render(); await settle();
    expect(driver.copyClipboard).toHaveBeenCalledExactlyOnceWith('/global/file');
    driver.readClipboard.mockResolvedValueOnce(['/library/新剪贴板']);
    openContext(); click(item('粘贴')); render(); await settle(); await settle();
    expect(driver.readClipboard).toHaveBeenCalledTimes(1);
    expect(driver.copyFolder).toHaveBeenCalledWith('/library/新剪贴板', '/global/file', expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));
    expect(driver.store!.getState().assetsPanelOpen).toBe(true);
  });

  it('粘贴中可以取消，失败后刷新目录且不显示成功提示', async () => {
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    driver.copyFolder.mockImplementationOnce((_source: string, _target: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true });
    }));
    (button('导入文件').props.onContextMenu as (event: unknown) => void)({ preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: {}, clientX: 100, clientY: 120 }); render();
    click(find((el) => el.props.role === 'menuitem' && (el.props.children as unknown[]).includes('粘贴'))); render(); await settle();
    const before = driver.listGlobal.mock.calls.length;
    click(find((el) => el.props.children === '取消复制')); render(); await settle(); await settle();
    expect(driver.listGlobal.mock.calls.length).toBeGreaterThan(before);
    expect(all(tree, (el) => el.props.children === '复制已取消；已复制内容保留在目标目录')).toHaveLength(1);
    expect(button('导入文件').props.disabled).toBe(false);
  });

  it('图片点击打开预览，关闭后保留目录和文件列表；切换项目使预览失效', async () => {
    driver.listGlobal.mockResolvedValue([{ ...file('参考图'), source: 'global', assetUrl: 'https://images.test/reference.png' }]);
    key(); render(); await settle();
    click(all(tree, (el) => el.props.role === 'tab')[1]); render(); await settle();
    click(button('导入文件')); render();
    (cards()[0].props.onImagePreview as () => void)(); render();
    const preview = find((el) => el.type === 'asset-image-preview');
    expect(preview.props.initialPath).toBe('assets/参考图.png');
    expect(preview.props.projectId).toBeUndefined();
    expect(driver.store!.getState().assetsPanelOpen).toBe(true);
    expect(button('导入文件').props['aria-pressed']).toBe(true);
    (preview.props.onClose as () => void)(); render();
    expect(all(tree, (el) => el.type === 'asset-image-preview')).toHaveLength(0);
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['参考图']);
    expect(button('导入文件').props['aria-pressed']).toBe(true);
    (cards()[0].props.onImagePreview as () => void)(); render();
    driver.store!.setState({ currentProjectId: 'other-project' }); render();
    expect(all(tree, (el) => el.type === 'asset-image-preview')).toHaveLength(0);
  });

  it('项目图片预览关联当前查看项目，并不受列表增量展示上限限制', async () => {
    driver.listProject.mockResolvedValue(Array.from({ length: 55 }, (_, i) => ({ ...file(`图片${i}`), assetUrl: `https://images.test/${i}.png` })));
    key(); render(); await settle();
    (cards()[0].props.onImagePreview as () => void)(); render();
    const preview = find((el) => el.type === 'asset-image-preview');
    expect(preview.props.projectId).toBe('project-1');
    expect((preview.props.files as AssetFileEntry[])).toHaveLength(55);
    expect(cards()).toHaveLength(48);
  });

  it('Esc 收起，确认弹窗打开时先保留抽屉', () => {
    key(); render();
    blockingModal = true;
    win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(driver.store!.getState().assetsPanelOpen).toBe(true);
    blockingModal = false;
    win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(driver.store!.getState().assetsPanelOpen).toBe(false);
  });

  it('拖入画布复用原生资产拖拽并收起抽屉', async () => {
    key(); render(); await settle();
    const card = cards()[0];
    (card.props.onDragStart as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    expect(driver.drag).toHaveBeenCalledWith(card.props.file);
    expect(driver.store!.getState().assetsPanelOpen).toBe(false);
  });

  it('项目切换后忽略旧项目的迟到列表', async () => {
    let finishOld!: (files: AssetFileEntry[]) => void;
    driver.listProject.mockImplementationOnce(() => new Promise<AssetFileEntry[]>((resolve) => { finishOld = resolve; }));
    key(); render();
    driver.store!.setState({ currentProjectId: 'project-2' });
    driver.listProject.mockResolvedValue([file('项目二')]);
    render(); await settle();
    finishOld([file('项目一迟到文件')]); await settle();
    expect(cards().map((el) => (el.props.file as AssetFileEntry).name)).toEqual(['项目二']);
  });

  it('节点列表页签列出当前画布全部类型，与文件页的项目范围和搜索独立', async () => {
    const types: NodeType[] = ['ai-text', 'ai-image', 'ai-video', 'ai-audio', 'ai-animation', 'ai-panorama',
      'ai-markdown', 'ai-storyboard', 'ai-shotlist', 'ai-director', 'source-image', 'source-video',
      'source-audio', 'source-text', 'canvas-note', 'plugin-node', 'comment'];
    driver.store!.setState({ nodes: types.map((type) => canvasNode(type, type)) });
    key(); render(); await settle();
    (find((el) => el.props.placeholder === '搜索名称或标签…').props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '无关文件关键词' } });
    (find((el) => el.type === 'asset-select').props.onChange as (value: string) => void)('another-project');
    render(); openNodeList();
    expect(nodeRows().map((el) => el.props['data-node-id'])).toEqual(types);
    expect(all(tree, (el) => el.type === 'asset-select')).toHaveLength(0);
    expect(cards()).toHaveLength(0);
    expect(find((el) => el.props.placeholder === '搜索节点名称、类型或编号…').props.value).toBe('');
    expect(all(tree, (el) => el.props.className === 'ui-tabs__count')[4].props.children).toBe(types.length);
  });

  it('节点增删、改名和项目切换后，节点列表与计数实时跟随画布', () => {
    driver.store!.setState({ nodes: [canvasNode('image', 'ai-image', '旧名称')] });
    key(); render(); openNodeList();
    driver.store!.setState({ nodes: [canvasNode('image', 'ai-image', '新名称'), canvasNode('note', 'canvas-note')] });
    render();
    expect(button('查看节点 新名称')).toBeDefined();
    expect(nodeRows()).toHaveLength(2);
    driver.store!.setState({ currentProjectId: 'project-2', nodes: [canvasNode('text', 'ai-text')] }); render();
    expect(nodeRows().map((el) => el.props['data-node-id'])).toEqual(['text']);
    expect(all(tree, (el) => el.props.className === 'ui-tabs__count')[4].props.children).toBe(1);
    driver.store!.setState({ nodes: [] }); render();
    expect(nodeRows()).toHaveLength(0);
    expect(find((el) => el.props.children === '当前画布暂无节点')).toBeDefined();
  });

  it('节点搜索支持名称、类型和编号，大列表可以继续加载全部节点', () => {
    const nodes = Array.from({ length: 55 }, (_, i) => canvasNode(`node-${i}`, 'ai-image', `图片 ${i}`));
    nodes[54] = { ...canvasNode('note', 'canvas-note', '分镜备注'), data: { type: 'canvas-note', label: '分镜备注', displayId: 99 } };
    driver.store!.setState({ nodes });
    key(); render(); openNodeList();
    expect(nodeRows()).toHaveLength(48);
    click(find((el) => el.props.children === '加载更多节点')); render();
    expect(nodeRows()).toHaveLength(55);
    for (const query of ['分镜备注', '画布笔记', '#99', '不匹配的词']) {
      (find((el) => el.props.placeholder === '搜索节点名称、类型或编号…').props.onChange as (e: { target: { value: string } }) => void)({ target: { value: query } });
      render();
      expect(nodeRows().map((el) => el.props['data-node-id'])).toEqual(query === '不匹配的词' ? [] : ['note']);
    }
  });

  it('查看节点发送与历史记录相同的定位回弹事件，抽屉保持打开', () => {
    driver.store!.setState({ nodes: [canvasNode('target', 'ai-image', '参考图')] });
    key(); render(); openNodeList();
    const focus = vi.fn();
    win.addEventListener('canvas-focus-node', (event) => focus((event as CustomEvent).detail));
    const locate = button('查看节点 参考图');
    click(locate);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ nodeId: 'target', pulse: true });
    expect(driver.store!.getState().assetsPanelOpen).toBe(true);
    driver.store!.setState({ nodes: [] });
    click(locate);
    expect(focus).toHaveBeenCalledTimes(1);
    render();
    expect(find((el) => el.props.children === '节点已不存在')).toBeDefined();
  });

  it('大弹窗先关闭再定位，切换项目后不执行迟到的定位', () => {
    vi.useFakeTimers();
    driver.store!.setState({ nodes: [canvasNode('target', 'ai-text')] });
    driver.store!.getState().setAssetsPanelOpen(true); render(); openNodeList();
    const focus = vi.fn();
    win.addEventListener('canvas-focus-node', (event) => focus((event as CustomEvent).detail));
    click(button('查看节点 target'));
    expect(driver.store!.getState().assetsPanelOpen).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ nodeId: 'target', pulse: true });
    driver.store!.getState().setAssetsPanelOpen(true); render();
    click(button('查看节点 target'));
    driver.store!.setState({ currentProjectId: 'project-2' });
    vi.advanceTimersByTime(300);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
