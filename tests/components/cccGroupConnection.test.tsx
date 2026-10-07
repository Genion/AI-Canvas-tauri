import type { ComponentProps, ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface HookScope { values: unknown[]; index: number }
const driver = vi.hoisted(() => ({ scope: null as HookScope | null, catalog: vi.fn() }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: <T,>(initial: T | (() => T)) => {
    const scope = driver.scope!;
    const index = scope.index++;
    if (!(index in scope.values)) scope.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [scope.values[index] as T, (value: T | ((previous: T) => T)) => {
      scope.values[index] = typeof value === 'function' ? (value as (previous: T) => T)(scope.values[index] as T) : value;
    }];
  },
  useRef: <T,>(initial: T) => {
    const scope = driver.scope!;
    return scope.values[scope.index++] ??= { current: initial };
  },
  useMemo: <T,>(factory: () => T) => factory(),
  useEffect: () => {},
}));
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }));
vi.mock('../../src/i18n', () => ({ useT: () => (text: string) => text }));
vi.mock('../../src/store/useAppStore', () => ({ useAppStore: { getState: () => ({ workflows: [] }) } }));
vi.mock('../../src/services/ai/providerCatalogService', async (original) => ({
  ...await original<typeof import('../../src/services/ai/providerCatalogService')>(),
  fetchProviderModelCatalog: (...args: unknown[]) => driver.catalog(...args),
}));
import ProviderConnectionDialog from '../../src/components/settings/ProviderConnectionDialog';
import ProviderConnectionForm from '../../src/components/settings/providerConnection/ProviderConnectionForm';
import ProviderModelSection from '../../src/components/settings/providerConnection/ProviderModelSection';
import AnimatedButton from '../../src/components/shared/AnimatedButton';
import { getProviderDefinition } from '../../src/services/ai/providerCatalogService';

type Element = ReactElement<Record<string, unknown> & { children?: unknown }>;
type Props = ComponentProps<typeof ProviderConnectionDialog>;
let props: Props;
let tree: unknown;
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function render() {
  driver.scope!.index = 0;
  tree = ProviderConnectionDialog(props);
}
function form() {
  return elements(tree).find((element) => element.type === ProviderConnectionForm)!.props as unknown as ComponentProps<typeof ProviderConnectionForm>;
}
function section() {
  return elements(tree).find((element) => element.type === ProviderModelSection)!.props as unknown as ComponentProps<typeof ProviderModelSection>;
}
async function save() {
  const button = elements(tree).find((element) => element.type === AnimatedButton
    && ['添加厂商', '保存更改'].includes(String(element.props.children)))!;
  expect(button.props.disabled).toBe(false);
  (button.props.onClick as () => void)();
  await new Promise<void>((resolve) => setImmediate(resolve));
  render();
}
function chooseCcc() {
  const button = elements(tree).find((element) => element.props.className === 'provider-picker-item'
    && elements(element).some((child) => child.props.children === 'CCC API'))!;
  expect(button).toBeDefined();
  (button.props.onClick as () => void)();
  render();
}

beforeEach(() => {
  driver.scope = { values: [], index: 0 };
  driver.catalog.mockReset().mockResolvedValue({ source: 'remote', models: [
    { id: 'gpt-image-2', name: 'GPT Image 2', category: 'image', provider: 'cccapi' },
  ] });
  vi.stubGlobal('document', { body: {} });
  props = { isOpen: true, providerConfigs: {}, connectedProviderIds: ['cccapi'],
    fallbackModels: { cccapi: [...getProviderDefinition('cccapi')!.models!] },
    dreaminaLoggedIn: false, dreaminaLoading: false,
    onDreaminaLogin: vi.fn(), onClose: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined),
  };
});

describe('CCC group connection orchestration', () => {
  it('shows Banana image models without a Key and preserves the selection while entering the Key', async () => {
    render(); chooseCcc();
    form().onCccGroupChange!('🍌香蕉（官k）'); render();
    expect(section().models.map((model) => model.id)).toEqual([
      'gemini-3-pro-image-preview', 'gemini-3-pro-image', 'gemini-3.1-flash-image',
      'gemini-2.5-flash-image', 'nano-banana2', 'nano-banana-pro',
    ]);
    expect(section().models.every((model) => model.category === 'image')).toBe(true);
    expect(section().catalogMessage).toContain('尚未验证 Key 权限');
    expect(form().missingCredentials).toBe(true);
    section().onToggleModel('nano-banana-pro'); render();
    form().setApiKey('banana-fixture'); render();
    expect(section().models).toHaveLength(6);
    expect(section().selectedModels.map((model) => model.id)).toEqual(['nano-banana-pro']);
    expect(driver.catalog).not.toHaveBeenCalled();
    await save();
    expect(props.onSave).toHaveBeenCalledWith(expect.stringMatching(/^cccapi-/), expect.objectContaining({
      cccGroup: '🍌香蕉（官k）', apiKey: 'banana-fixture',
      selectedModels: [expect.objectContaining({ id: 'nano-banana-pro' })],
    }), undefined);
  });

  it('loads a group preset when reopening a connection without a catalog or Key', () => {
    props.connectionId = 'cccapi-banana';
    props.initialConfig = { name: 'CCC', apiKey: '', catalogId: 'cccapi', cccGroup: '🍌香蕉（官k）' };
    render();
    expect(section().models).toHaveLength(6);
    expect(section().catalogStatus).toBe('warning');
    expect(form().missingCredentials).toBe(true);
  });

  it('resets old search and category filters when changing to an image group', () => {
    render(); chooseCcc();
    form().onCccGroupChange!('国模-稳定2折'); render();
    expect(section().models).toHaveLength(5);
    section().setQuery('DeepSeek'); section().setCategory('text');
    section().onToggleModel('DeepSeek-V4.1-Flash'); render();
    form().setApiKey('domestic-fixture'); render();
    form().onCccGroupChange!('🍌香蕉（官k）'); render();
    expect(section().query).toBe('');
    expect(section().category).toBe('all');
    expect(section().filteredModels).toHaveLength(6);
    expect(section().selectedModels).toEqual([]);
    expect(form().apiKey).toBe('');
  });

  it('allows another CCC connection and saves only models returned for its Key', async () => {
    render(); chooseCcc();
    expect(section().models).toEqual([]);
    form().setApiKey('unassigned-fixture'); render();
    expect(form().missingCredentials).toBe(true);
    form().onCccGroupChange!('CCC生图稳定'); render();
    expect(form().missingCredentials).toBe(true);
    form().setApiKey('stable-fixture'); render();
    await section().onFetchModels(); render();
    expect(driver.catalog).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ cccGroup: 'CCC生图稳定', apiKey: 'stable-fixture' }) }));
    expect(section().models.map((model) => model.id)).toEqual(['gpt-image-2']);
    section().onToggleModel('gpt-image-2'); render();
    await save();
    expect(props.onSave).toHaveBeenCalledWith(expect.stringMatching(/^cccapi-/), expect.objectContaining({
      name: 'CCC API · CCC生图稳定', cccGroup: 'CCC生图稳定', apiKey: 'stable-fixture', catalogId: 'cccapi',
      selectedModels: [expect.objectContaining({ id: 'gpt-image-2', provider: expect.stringMatching(/^cccapi-/) })],
    }), undefined);
  });

  it('keeps legacy selected models compatible without importing the full built-in catalog', async () => {
    props.connectionId = 'cccapi';
    props.initialConfig = { name: 'CCC', apiKey: 'legacy-fixture', catalogId: 'cccapi',
      selectedModels: [{ id: 'old-model', name: 'Old', category: 'image', provider: 'cccapi' }] };
    render();
    expect(form().cccGroup).toBe('');
    expect(section().models.map((model) => model.id)).toEqual(['old-model']);
    await save();
    expect(props.onSave).toHaveBeenCalledWith('cccapi', expect.objectContaining({ cccGroup: undefined, apiKey: 'legacy-fixture' }), undefined);
  });

  it.each(['key', 'group'] as const)('clears stale models and ignores a pending response after a %s change', async (change) => {
    props.connectionId = 'cccapi-stable';
    props.initialConfig = { name: 'CCC', catalogId: 'cccapi', cccGroup: 'CCC生图稳定', apiKey: 'stable-fixture',
      catalogModels: [{ id: 'old-model', name: 'Old', category: 'image', provider: 'cccapi-stable' }],
      selectedModels: [{ id: 'old-model', name: 'Old', category: 'image', provider: 'cccapi-stable' }] };
    let finish!: (value: unknown) => void;
    driver.catalog.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render();
    const fetching = section().onFetchModels();
    if (change === 'key') form().setApiKey('replacement-fixture');
    else form().onCccGroupChange!('CCC生图白嫖');
    render();
    expect(section().models.length).toBeGreaterThan(0);
    expect(section().models.some((model) => model.id === 'old-model')).toBe(false);
    expect(section().selectedModels).toEqual([]);
    expect(form().apiKey).toBe(change === 'key' ? 'replacement-fixture' : '');
    expect(driver.catalog.mock.calls[0][0].signal.aborted).toBe(true);
    finish({ source: 'remote', models: [{ id: 'stale', name: 'Stale', category: 'image', provider: 'cccapi' }] });
    await fetching; render();
    expect(section().models.some((model) => model.id === 'stale' || model.id === 'old-model')).toBe(false);
    expect(section().catalogStatus).toBe('warning');
  });

  it('keeps the group preview visible and reports an error when pulling the directory fails', async () => {
    render(); chooseCcc();
    form().onCccGroupChange!('🍌香蕉（官k）'); render();
    form().setApiKey('invalid-fixture'); render();
    driver.catalog.mockRejectedValueOnce(new Error('模型目录请求失败（403）'));
    await section().onFetchModels(); render();
    expect(section().models).toHaveLength(6);
    expect(section().catalogStatus).toBe('error');
    expect(section().catalogMessage).toContain('403');
  });

  it('drops models no longer returned by the group directory while preserving matching edits', async () => {
    props.connectionId = 'cccapi-stable';
    props.initialConfig = { name: 'CCC', apiKey: 'fixture', catalogId: 'cccapi', cccGroup: 'CCC生图稳定', selectedModels: [
      { id: 'gpt-image-gone', name: 'Gone', category: 'image', provider: 'cccapi-stable' },
      { id: 'gpt-image-2', name: 'My Image', category: 'image', provider: 'cccapi-stable', description: '我的说明', descriptionManual: true },
    ] };
    render();
    section().setProtocolModelId('gpt-image-gone'); section().setProtocolValid(false); render();
    await section().onFetchModels(); render();
    expect(section().models).toHaveLength(1);
    expect(section().models[0].description).toBe('我的说明');
    expect(section().selectedModels.map((model) => model.id)).toEqual(['gpt-image-2']);
    expect(section().protocolModel).toBeUndefined();
    await save();
  });
});
