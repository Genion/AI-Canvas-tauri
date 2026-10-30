import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseNodeData } from '../../src/types';
import type { SelectOption } from '../../src/components/shared/Select';

const hooks = vi.hoisted(() => ({ store: {} as unknown, refs: [] as Array<{ current: unknown }>, refIndex: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useRef: <T,>(initial: T) => hooks.refs[hooks.refIndex++] ??= { current: initial },
  useId: () => 'cinema', useEffect: () => {},
}));
vi.mock('../../src/i18n', () => ({ useT: () => (text: string) => text }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: Object.assign(
  (selector: (state: unknown) => unknown) => selector(hooks.store), { getState: () => hooks.store },
) }));
vi.mock('../../src/components/shared/ModalOverlay', () => ({ default: 'modal-overlay' }));
vi.mock('../../src/components/shared/Select', () => ({ default: 'cinema-select' }));
import ShotlistCinematographyDialog from '../../src/components/nodes/ShotlistCinematographyDialog';

type Element = ReactElement<Record<string, unknown> & { children?: unknown }>;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function content(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(content).join('');
  return value && typeof value === 'object' && 'props' in value ? content((value as Element).props.children) : '';
}
beforeEach(() => { hooks.refs = []; hooks.refIndex = 0; });
function setup(rowId?: string) {
  const node = { id: 'table', data: { type: 'ai-shotlist', label: '第一场',
    shotlistCinematography: { cameraId: 'sony-venice-2', lensId: 'zeiss-supreme', focalLengthMm: 85, apertureT: 2 },
    shotlistRows: [{ id: 'one', shotNo: '1', content: '保留内容', dialogue: '保留台词', frame: { nodeId: 'image', kind: 'image' } },
      { id: 'two', shotNo: '2', content: '另一个镜头' }],
  } as BaseNodeData };
  const state = { currentProjectId: 'project-a', projectLoadStatus: 'ready', nodes: [node],
    isCreatingProject: false, isReturningToStartPage: false, switchingProjectName: null as string | null,
    updateNodeData: vi.fn((id: string, patch: Partial<BaseNodeData>) => {
      const target = state.nodes.find((item) => item.id === id);
      if (target) target.data = { ...target.data, ...patch };
    }), commitToHistory: vi.fn(),
  };
  hooks.store = state;
  let tree: Element[];
  const onClose = vi.fn();
  const render = () => {
    hooks.refIndex = 0;
    tree = elements(ShotlistCinematographyDialog({ nodeId: 'table', rowId, projectId: 'project-a', onClose }));
  };
  render();
  const select = (label: string) => tree.find((item) => item.type === 'cinema-select' && item.props['aria-label'] === label)!;
  const change = (label: string, value: string) => (select(label).props.onChange as (value: string) => void)(value);
  const click = (label: string) => (tree.find((item) => item.type === 'button' && content(item.props.children) === label)!.props.onClick as () => void)();
  return { node, state, render, select, change, click, onClose, text: () => tree.map((item) => content(item.props.children)).join(' ') };
}

describe('分镜摄影选择', () => {
  it('摄影机和镜头选项展示常用场景，使用共用防裁剪 Select', () => {
    const view = setup();
    const cameras = view.select('摄影机').props.options as SelectOption[];
    const lenses = view.select('镜头系列').props.options as SelectOption[];
    expect(content(cameras.find((item) => item.value === 'arri-alexa-35')!.label)).toContain('常用于剧情长片');
    expect(content(lenses.find((item) => item.value === 'laowa-proteus-blue')!.label)).toContain('常用于夜景霓虹');
    expect(view.select('摄影机').props.fixedMenu).not.toBe(false);
  });

  it('整表默认只修改默认摄影，不把配置复制进各镜头', () => {
    const view = setup();
    const originalRows = view.node.data.shotlistRows;
    view.change('摄影机', 'arri-alexa-35');
    expect(view.node.data.shotlistCinematography?.cameraId).toBe('arri-alexa-35');
    expect(view.node.data.shotlistRows).toBe(originalRows);
    expect(view.state.updateNodeData).toHaveBeenCalledOnce();
    expect(view.state.commitToHistory).toHaveBeenCalledOnce();
  });

  it('单镜可逐项覆盖、设为自动和恢复继承，保留其他字段和重排', () => {
    const view = setup('one');
    expect(view.select('焦段').props.value).toBe('inherit');
    const [first, second] = view.node.data.shotlistRows!;
    view.node.data.shotlistRows = [second, first];
    view.change('焦段', '50'); view.render();
    expect(view.node.data.shotlistRows![1]).toEqual({ ...first, cinematography: { focalLengthMm: 50 } });
    view.change('焦段', ''); view.render();
    expect(view.node.data.shotlistRows![1].cinematography?.focalLengthMm).toBeNull();
    view.change('焦段', 'inherit'); view.render();
    expect(view.node.data.shotlistRows![1].cinematography).toBeUndefined();
    expect(view.select('焦段').props.value).toBe('inherit');
    expect(view.node.data.shotlistCinematography?.focalLengthMm).toBe(85);
  });

  it('更换镜头联动合法焦段和光圈，整表默认保持不变', () => {
    const view = setup('one');
    view.change('镜头系列', 'laowa-pro2be'); view.render();
    expect(view.node.data.shotlistRows![0].cinematography).toMatchObject({ lensId: 'laowa-pro2be', focalLengthMm: 24, apertureT: 8 });
    expect(view.node.data.shotlistCinematography).toMatchObject({ lensId: 'zeiss-supreme', focalLengthMm: 85, apertureT: 2 });
    expect(view.text()).toContain('Laowa Pro2be');
    view.click('恢复整表摄影'); view.render();
    expect(view.node.data.shotlistRows![0].cinematography).toBeUndefined();
  });

  it('效果预设一次填充推荐器材并更新预览，可单独改光圈', () => {
    const view = setup('one');
    view.change('效果预设', 'anamorphic'); view.render();
    expect(view.node.data.shotlistRows![0].cinematography).toMatchObject({ effectId: 'anamorphic', lensId: 'laowa-proteus-blue', focalLengthMm: 35 });
    expect(view.text()).toContain('blue horizontal flares');
    expect(view.state.updateNodeData).toHaveBeenCalledOnce();
    view.change('拍摄光圈', '4');
    expect(view.node.data.shotlistRows![0].cinematography?.apertureT).toBe(4);
  });

  it.each(['project', 'loading', 'deleted', 'generating', 'closed'])('%s 后拒绝迟到的选项回写', (kind) => {
    const view = setup('one');
    const previousChange = view.select('摄影机').props.onChange as (value: string) => void;
    if (kind === 'project') view.state.currentProjectId = 'project-b';
    if (kind === 'loading') view.state.projectLoadStatus = 'loading';
    if (kind === 'deleted') view.node.data.shotlistRows = [];
    if (kind === 'generating') view.node.data.status = 'loading';
    if (kind === 'closed') view.click('完成');
    previousChange('arri-alexa-35');
    expect(view.state.updateNodeData).not.toHaveBeenCalled();
    expect(view.state.commitToHistory).not.toHaveBeenCalled();
  });
});
