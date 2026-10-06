import type { ComponentProps, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryRecord } from '../../src/services/indexedDbService';

interface Harness {
  states: unknown[]; refs: Array<{ current: unknown }>;
  effects: Array<{ deps?: readonly unknown[]; cleanup?: () => void }>;
  pending: Array<() => void>; stateIndex: number; refIndex: number; effectIndex: number;
}
const driver = vi.hoisted(() => ({ current: null as Harness | null, load: vi.fn(), copy: vi.fn() }));
class DomElement extends EventTarget { closest = vi.fn(); }
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <T,>(initial: T | (() => T)) => {
    const scope = driver.current!; const index = scope.stateIndex++;
    if (!(index in scope.states)) scope.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [scope.states[index], (value: T | ((old: T) => T)) => {
      scope.states[index] = typeof value === 'function' ? (value as (old: T) => T)(scope.states[index] as T) : value;
    }];
  },
  useRef: <T,>(initial: T) => { const scope = driver.current!; return scope.refs[scope.refIndex++] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const scope = driver.current!; const index = scope.effectIndex++; const old = scope.effects[index];
    if (old && deps?.length === old.deps?.length && deps?.every((dep, i) => Object.is(dep, old.deps?.[i]))) return;
    scope.pending.push(() => { old?.cleanup?.(); scope.effects[index] = { deps, cleanup: effect() ?? undefined }; });
  },
}));
vi.mock('../../src/services/assetVideoDetails', async () => ({
  ...await vi.importActual<typeof import('../../src/services/assetVideoDetails')>('../../src/services/assetVideoDetails'),
  loadAssetVideoHistory: (...args: unknown[]) => driver.load(...args),
}));
vi.mock('../../src/services/clipboardService', () => ({ copyText: driver.copy }));
vi.mock('../../src/components/shared/ModalOverlay', () => ({ default: 'modal-overlay' }));
import AssetVideoPreview from '../../src/components/assets/AssetVideoPreview';

type Element = ReactElement<Record<string, unknown> & { children?: unknown; ref?: { current: unknown } }>;
type Props = ComponentProps<typeof AssetVideoPreview>;
let scope: Harness; let input: Props; let tree: unknown; let win: EventTarget;
let video: { src: string; paused: boolean; currentTime: number; muted: boolean; volume: number; playbackRate: number;
  buffered: { length: number; start: (index: number) => number; end: (index: number) => number };
  videoWidth: number; videoHeight: number; duration: number; readyState: number; error: null; play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn>; getAttribute: ReturnType<typeof vi.fn> };
let doc: { fullscreenElement: unknown; exitFullscreen: ReturnType<typeof vi.fn> };
let stage: { requestFullscreen: ReturnType<typeof vi.fn>; querySelector: ReturnType<typeof vi.fn>; contains: ReturnType<typeof vi.fn> };
let progress: { style: { setProperty: ReturnType<typeof vi.fn> }; value: string };
let frames: Map<number, FrameRequestCallback>; let nextFrame: number;
const history = (id = 'record'): HistoryRecord => ({ id, projectId: 'project', nodeId: 'node', nodeLabel: '视频', timestamp: 1,
  prompt: `提示词 ${id}`, output: 'https://videos.test/a.mp4', filePath: '/a.mp4', nodeType: 'ai-video', model: 'video-model',
  provider: 'provider', status: 'success', params: { seedanceResolution: '1080p', seedanceDuration: 5 } });
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element; return [element, ...elements(element.props.children)];
}
function find(predicate: (element: Element) => boolean): Element { const found = elements(tree).find(predicate); expect(found).toBeDefined(); return found!; }
function control(label: string) { return find((el) => el.props['aria-label'] === label || el.props.children === label
  || el.type === 'button' && Array.isArray(el.props.children) && el.props.children.includes(label)); }
function click(element: Element) { (element.props.onClick as () => void)(); }
function render() {
  driver.current = scope; scope.stateIndex = scope.refIndex = scope.effectIndex = 0; tree = AssetVideoPreview(input);
  elements(tree).forEach((el) => { if (el.props.ref) el.props.ref.current = el.type === 'video' ? video : el.type === 'input' || el.props.className === 'asset-video-preview-progress' ? progress : stage; });
  scope.pending.splice(0).forEach((effect) => effect());
}
async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); render(); }
function event(type: string) { (find((el) => el.type === 'video').props[type] as (event: unknown) => void)({ currentTarget: video }); render(); }
function key() { const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }); win.dispatchEvent(event); return event; }
beforeEach(() => {
  scope = { states: [], refs: [], effects: [], pending: [], stateIndex: 0, refIndex: 0, effectIndex: 0 };
  input = { src: 'https://videos.test/a.mp4?preview=1', querySrc: 'https://videos.test/a.mp4', filePath: '/a.mp4', name: '视频.mp4',
    projectId: 'project', unavailable: true, size: 1024, onClose: vi.fn(), onSourceError: vi.fn() };
  win = new class extends EventTarget {
    override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null) { super.addEventListener(type, callback); }
    override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null) { super.removeEventListener(type, callback); }
  }();
  doc = { fullscreenElement: null, exitFullscreen: vi.fn().mockResolvedValue(undefined) };
  stage = { requestFullscreen: vi.fn().mockResolvedValue(undefined), querySelector: vi.fn(() => ({ focus: vi.fn() })), contains: vi.fn(() => false) };
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('Element', DomElement);
  progress = { style: { setProperty: vi.fn() }, value: '' }; frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  video = { src: '', paused: true, currentTime: 0, muted: false, volume: 1, playbackRate: 1, videoWidth: 1920, videoHeight: 1080, duration: 5, readyState: 1, error: null,
    buffered: { length: 1, start: () => 0, end: () => 4 },
    play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), load: vi.fn(), getAttribute: vi.fn(() => video.src),
    removeAttribute: vi.fn(() => { video.src = ''; }) };
  driver.load.mockReset().mockResolvedValue(history()); driver.copy.mockReset().mockResolvedValue(true);
});
afterEach(() => { scope.effects.forEach((effect) => effect.cleanup?.()); vi.unstubAllGlobals(); });

describe('asset video fullscreen preview', () => {
  it('播放时逐帧同步真实进度，暂停、结束、换源及卸载取消刷新', async () => {
    const frame = () => { const [id, callback] = frames.entries().next().value!; frames.delete(id); callback(0); };
    render(); await settle(); event('onLoadedMetadata'); expect(frames.size).toBe(0);
    video.paused = false; event('onPlay'); expect(frames.size).toBe(1);
    video.currentTime = 0.016; frame();
    expect(progress.style.setProperty).toHaveBeenLastCalledWith('--video-played', '0.32%'); expect(progress.value).toBe('0.016');
    video.playbackRate = 2; video.currentTime = 0.048; frame();
    expect(Number.parseFloat(progress.style.setProperty.mock.lastCall![1])).toBeCloseTo(0.96); expect(frames.size).toBe(1);
    video.paused = true; event('onPause'); expect(frames.size).toBe(0);
    video.currentTime = 3; event('onSeeked');
    expect(find((el) => el.props.className === 'asset-video-preview-progress').props.style).toMatchObject({ '--video-played': '60%' });
    video.paused = false; event('onPlay'); video.currentTime = 5; event('onEnded'); expect(frames.size).toBe(0);
    expect(find((el) => el.props.className === 'asset-video-preview-progress').props.style).toMatchObject({ '--video-played': '100%' });
    event('onPlay'); const previous = [...frames.keys()];
    input = { ...input, src: 'https://videos.test/b.mp4' }; render();
    expect(previous.every((id) => !frames.has(id))).toBe(true);
    scope.effects.forEach((effect) => effect.cleanup?.()); scope.effects = []; expect(frames.size).toBe(0);
  });
  it('读取原始媒体引用、提示词和真实尺寸，复制保留完整文本', async () => {
    render(); await settle();
    expect(driver.load).toHaveBeenCalledWith('/a.mp4', 'https://videos.test/a.mp4', 'project', expect.any(AbortSignal));
    expect(control('提示词 record')).toBeDefined(); expect(control('1080p')).toBeDefined();
    event('onLoadedMetadata'); expect(control('1920 × 1080')).toBeDefined(); expect(control('5 秒')).toBeDefined();
    click(control('复制提示词')); await settle(); expect(driver.copy).toHaveBeenCalledWith('提示词 record');
    expect(control('提示词已复制')).toBeDefined();
    expect(find((el) => el.type === 'video').props.controls).toBeUndefined();
  });
  it('历史卡片使用指定记录，不查询另一条更晚记录', async () => {
    input = { ...input, historyRecord: history('old') }; render(); await settle();
    expect(driver.load).not.toHaveBeenCalled(); expect(control('提示词 old')).toBeDefined();
  });
  it('缺少记录与查询失败分别显示，失败可重试', async () => {
    driver.load.mockResolvedValueOnce(null); render(); await settle();
    expect(control('暂无生成信息')).toBeDefined(); expect(control('复制提示词').props.disabled).toBe(true);
    driver.load.mockRejectedValueOnce(new Error('read error')); input = { ...input, filePath: '/b.mp4' }; render(); await settle();
    expect(control('生成信息读取失败')).toBeDefined(); click(control('重试读取')); render(); await settle();
    expect(control('提示词 record')).toBeDefined();
  });
  it('切换来源取消旧读取并忽略迟到结果，卸载释放视频解码', async () => {
    let finish!: (record: HistoryRecord) => void;
    driver.load.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })); render();
    const request = driver.load.mock.calls[0][3] as AbortSignal;
    input = { ...input, filePath: '/b.mp4', src: 'https://videos.test/b.mp4', querySrc: 'https://videos.test/b.mp4' };
    render(); await settle(); finish(history('late')); await settle();
    expect(request.aborted).toBe(true); expect(control('提示词 record')).toBeDefined();
    expect(elements(tree).some((el) => el.props.children === '提示词 late')).toBe(false);
    expect(video.pause).toHaveBeenCalled(); expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.src).toBe(input.src);
    scope.effects.forEach((effect) => effect.cleanup?.()); scope.effects = [];
    expect(video.src).toBe(''); expect(video.load).toHaveBeenCalled();
  });
  it('StrictMode 清理重放恢复源和播放，关闭后 Esc 监听也被移除', async () => {
    render(); await settle(); scope.effects.forEach((effect) => effect.cleanup?.()); scope.effects = [];
    expect(video.src).toBe(''); render(); expect(video.src).toBe(input.src); expect(video.play).toHaveBeenCalledTimes(2);
    expect(key().defaultPrevented).toBe(true); expect(input.onClose).toHaveBeenCalledOnce();
    scope.effects.forEach((effect) => effect.cleanup?.()); scope.effects = []; key(); expect(input.onClose).toHaveBeenCalledOnce();
  });
  it('自动播放受限可重试，播放结束留在全屏，源失败通知上层回退', async () => {
    video.play.mockRejectedValueOnce(new Error('autoplay blocked')); render(); await settle();
    click(control('点击播放')); await settle(); expect(video.play).toHaveBeenCalledTimes(2);
    video.paused = false; event('onPlay'); click(control('暂停视频')); expect(video.pause).toHaveBeenCalled();
    event('onEnded'); expect(input.onClose).not.toHaveBeenCalled();
    event('onError'); expect(input.onSourceError).toHaveBeenCalledOnce(); expect(control('视频加载失败，点击重试')).toBeDefined();
  });
  it('底部控件更新进度、速度和静音，原生全屏 Esc 不关闭详情层', async () => {
    render(); await settle(); event('onLoadedMetadata');
    (control('播放进度').props.onChange as (event: unknown) => void)({ currentTarget: { value: '3.25' } }); render();
    expect(video.currentTime).toBe(3.25);
    click(control('播放速度')); render();
    (control('调整播放速度').props.onChange as (event: unknown) => void)({ currentTarget: { value: '1.5' } });
    expect(video.playbackRate).toBe(1.5); event('onRateChange'); expect(control('调整播放速度').props.value).toBe(1.5);
    key(); render(); expect(input.onClose).not.toHaveBeenCalled();
    click(control('静音视频')); expect(video.muted).toBe(true); event('onVolumeChange'); expect(control('取消静音')).toBeDefined();
    click(control('全屏播放视频')); expect(stage.requestFullscreen).toHaveBeenCalledOnce();
    const outerModal = vi.fn(); win.addEventListener('keydown', outerModal);
    doc.fullscreenElement = stage; expect(key().defaultPrevented).toBe(false); expect(input.onClose).not.toHaveBeenCalled();
    expect(outerModal).not.toHaveBeenCalled();
    click(control('全屏播放视频')); expect(doc.exitFullscreen).toHaveBeenCalledOnce();
  });
  it('全屏不可用显示状态，源未就绪不创建视频且禁用进度', async () => {
    input = { ...input, src: undefined, unavailable: false }; stage.requestFullscreen.mockRejectedValueOnce(new Error('unsupported'));
    render(); await settle(); expect(elements(tree).some((el) => el.type === 'video')).toBe(false);
    expect(control('加载视频…')).toBeDefined(); expect(control('播放进度').props.disabled).toBe(true);
    click(control('全屏播放视频')); await settle(); expect(control('此窗口暂不支持播放器全屏')).toBeDefined();
  });
  it('速度弹层支持细分倍速与滑杆，Esc 只关弹层，外部点击关闭', async () => {
    render(); await settle(); click(control('播放速度')); render();
    expect(control('播放速度').props['aria-expanded']).toBe(true);
    expect(stage.querySelector).toHaveBeenCalledWith('input');
    click(control('0.75 倍速')); expect(video.playbackRate).toBe(0.75); event('onRateChange');
    expect(control('调整播放速度').props.value).toBe(0.75);
    (control('调整播放速度').props.onChange as (event: unknown) => void)({ currentTarget: { value: '1.75' } });
    expect(video.playbackRate).toBe(1.75); event('onRateChange');
    expect(key().defaultPrevented).toBe(true); render();
    expect(input.onClose).not.toHaveBeenCalled(); expect(control('播放速度').props['aria-expanded']).toBe(false);
    click(control('播放速度')); render(); win.dispatchEvent(new Event('pointerdown')); render();
    expect(control('播放速度').props['aria-expanded']).toBe(false);
  });
  it('时间菜单切换剩余时间并支持键盘导航，居中时间不受左侧控件宽度影响', async () => {
    render(); await settle(); event('onLoadedMetadata'); video.currentTime = 2; event('onTimeUpdate');
    click(control('时间显示格式')); render();
    const menu = control('时间显示格式选项');
    const options = [{ focus: vi.fn() }, { focus: vi.fn() }];
    const preventDefault = vi.fn();
    (menu.props.onKeyDown as (event: unknown) => void)({ key: 'ArrowDown', currentTarget: { querySelectorAll: () => options }, target: options[0], preventDefault, stopPropagation: vi.fn() });
    expect(options[1].focus).toHaveBeenCalledOnce(); expect(preventDefault).toHaveBeenCalledOnce();
    click(control('剩余时间 / 总时长')); render();
    expect(control('时间显示格式').props['aria-expanded']).toBe(false);
    const text = find((el) => el.type === 'time').props.children as string[];
    expect(text.join('')).toBe('-0:03 / 0:05');
    expect(input.onClose).not.toHaveBeenCalled();
  });
  it('菜单打开时点击关闭按钮不被外部指针监听抢先收起', async () => {
    render(); await settle(); click(control('播放速度')); render();
    const target = new DomElement(); target.closest.mockReturnValue(target);
    const pointer = new Event('pointerdown'); Object.defineProperty(pointer, 'target', { value: target });
    win.dispatchEvent(pointer); render();
    expect(control('播放速度').props['aria-expanded']).toBe(true);
    click(control('关闭视频预览')); expect(input.onClose).toHaveBeenCalledOnce();
  });
  it('音量滑杆解除静音，零音量可恢复，缓冲只显示当前连续区间', async () => {
    render(); await settle(); event('onLoadedMetadata'); video.currentTime = 2; event('onTimeUpdate');
    const progress = find((el) => el.props.className === 'asset-video-preview-progress');
    expect(progress.props.style).toMatchObject({ '--video-played': '40%', '--video-buffered': '80%' });
    video.buffered = { length: 2, start: (index) => index === 0 ? 0 : 4.5, end: (index) => index === 0 ? 3 : 5 };
    event('onProgress'); expect(find((el) => el.props.className === 'asset-video-preview-progress').props.style).toMatchObject({ '--video-buffered': '60%' });
    (control('视频音量').props.onChange as (event: unknown) => void)({ currentTarget: { value: '0' } }); event('onVolumeChange');
    expect(video.muted).toBe(true); click(control('取消静音')); event('onVolumeChange');
    expect(video.volume).toBe(1); expect(video.muted).toBe(false);
    (control('视频音量').props.onChange as (event: unknown) => void)({ currentTarget: { value: '0.35' } }); event('onVolumeChange');
    expect(control('视频音量').props.value).toBe(0.35);
  });
  it('悬停只打开独立静音预览，不跳动主视频，离开移除并释放预览源', async () => {
    render(); await settle(); event('onLoadedMetadata');
    const progress = find((el) => el.props.className === 'asset-video-preview-progress');
    (progress.props.onPointerMove as (event: unknown) => void)({ pointerType: 'mouse', clientX: 100, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 200 }) } }); render();
    const child = find((el) => typeof el.type === 'function' && el.props.time !== undefined);
    const mainVideo = video;
    const previewVideo = { ...video, src: '', pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(() => { previewVideo.src = ''; }) };
    const mainScope = scope;
    const previewScope: Harness = { states: [], refs: [], effects: [], pending: [], stateIndex: 0, refIndex: 0, effectIndex: 0 };
    driver.current = previewScope;
    const previewTree = (child.type as (props: { src: string; time: number }) => unknown)(child.props as { src: string; time: number });
    elements(previewTree).forEach((el) => { if (el.props.ref) el.props.ref.current = previewVideo; });
    previewScope.pending.splice(0).forEach((effect) => effect());
    expect(previewVideo.currentTime).toBe(2.6); expect(mainVideo.currentTime).toBe(0);
    expect(find((el) => el.type === 'video').props.muted).toBeUndefined();
    expect(elements(previewTree).find((el) => el.type === 'video')?.props.muted).toBe(true);
    previewScope.effects.forEach((effect) => effect.cleanup?.());
    expect(previewVideo.pause).toHaveBeenCalledOnce(); expect(previewVideo.src).toBe('');
    driver.current = mainScope;
    (progress.props.onPointerLeave as () => void)(); render();
    expect(elements(tree).some((el) => el.props.className === 'asset-video-seek-anchor')).toBe(false);
  });
});
