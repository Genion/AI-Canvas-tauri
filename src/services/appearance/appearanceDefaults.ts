import type { AppearanceTheme, AppearanceMode } from '../../types';
import libTvThemeJson from './libtv-theme.json?raw';

const DARK_UI = {
  background: '#0a0a0f',
  surface: '#14141c',
  card: '#1a1a26',
  hover: '#252535',
  border: '#2a2a3a',
  text: '#dddde4',
  textSecondary: '#8888a0',
  textMuted: '#7d7d91',
  accent: '#6366f1',
  accentStrong: '#818cf8',
  accentSoft: '#a5b4fc',
  focus: '#6366f1',
  success: '#22c55e',
  warning: '#f97316',
  danger: '#ef4444',
  info: '#3b82f6',
  radius: 8,
  shadowOpacity: 0.42,
  glassOpacity: 0.77,
  glassBlur: 16,
  scrollbar: '#3a3a50',
  scrollbarHover: '#555570',
} as const;

const LIGHT_UI = {
  background: '#eef2f7',
  surface: '#ffffff',
  card: '#f7f9fc',
  hover: '#e5eaf2',
  border: '#c7d0df',
  text: '#252a38',
  textSecondary: '#4f5a6e',
  textMuted: '#657084',
  accent: '#5368d6',
  accentStrong: '#4053c0',
  accentSoft: '#3d50b8',
  focus: '#5368d6',
  success: '#23937a',
  warning: '#c06e33',
  danger: '#ce4f62',
  info: '#3b7ec4',
  radius: 8,
  shadowOpacity: 0.18,
  glassOpacity: 0.7,
  glassBlur: 16,
  scrollbar: '#b3bdce',
  scrollbarHover: '#8996aa',
} as const;

function completeTheme(
  id: string,
  name: string,
  mode: AppearanceMode,
  ui: typeof DARK_UI | typeof LIGHT_UI,
  canvas: AppearanceTheme['canvas'],
): AppearanceTheme {
  const now = 0;
  return {
    schemaVersion: 1,
    id,
    name,
    builtin: true,
    mode,
    ui: { ...ui },
    canvas,
    // These values intentionally match the current node defaults. Preset backgrounds
    // do not introduce a second node/edge/handle visual language.
    node: {
      background: ui.surface,
      backgroundOpacity: 0.94,
      border: ui.border,
      borderWidth: 1,
      radius: ui.radius,
      shadow: `0 12px 32px color-mix(in srgb, #000 42%, transparent)`,
      headerBackground: ui.card,
      selectedBorder: ui.accent,
      selectedGlow: `color-mix(in srgb, ${ui.accent} 24%, transparent)`,
      text: ui.text,
      handleColor: ui.accent,
    },
    edge: {
      color: mode === 'light' ? '#71809a' : '#33334a',
      width: 1.5,
      selectedColor: ui.accent,
      selectedWidth: 2.5,
      flowColor: ui.accentSoft,
      previewColor: ui.accent,
      animationEnabled: true,
    },
    handle: {
      kind: 'color',
      color: ui.accent,
      hoverColor: ui.accentStrong,
      size: 40,
      imageFit: 'contain',
      opacity: 1,
    },
    motion: { enabled: true, scale: 1 },
    createdAt: now,
    updatedAt: now,
  };
}
function createLibTvDarkTheme(): AppearanceTheme {
  const imported = JSON.parse(libTvThemeJson) as AppearanceTheme;
  return {
    ...imported,
    id: 'standard-dark',
    name: '深色',
    builtin: true,
    mode: 'dark',
    createdAt: 0,
    updatedAt: 0,
  };
}

export function createBuiltinAppearanceThemes(): AppearanceTheme[] {
  return [
    createLibTvDarkTheme(),
    completeTheme('standard-light', '浅色', 'light', LIGHT_UI, {
      kind: 'color', color: '#eef2f7', imageFit: 'cover', imagePosition: 'center',
      imageOpacity: 1, gridVisible: true, gridColor: '#a7b1c0', gridSize: 8,
    }),
    completeTheme('solar-system', '太阳系', 'dark', DARK_UI, {
      kind: 'solar-system', color: '#000000', imageFit: 'cover', imagePosition: 'center',
      imageOpacity: 1, gridVisible: true, gridColor: '#3a3a50', gridSize: 8,
    }),
    completeTheme('frosted-warm-light', '磨砂暖光', 'light', LIGHT_UI, {
      kind: 'frosted-glass', color: '#d9dad9', imageFit: 'cover', imagePosition: 'center',
      imageOpacity: 1, gridVisible: true, gridColor: '#a9aaa8', gridSize: 8,
    }),
  ];
}

export function cloneAppearanceTheme(theme: AppearanceTheme, id: string, name: string): AppearanceTheme {
  const now = Date.now();
  return {
    ...structuredClone(theme),
    id,
    name,
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 补齐旧版或外部导入的半成品快照。持久化数据是不可信输入，运行时不能只依赖 TS 类型。
 */
export function normalizeAppearanceTheme(input: unknown): AppearanceTheme {
  const source = isRecord(input) ? input : {};
  const mode = source.mode === 'light' || source.mode === 'system' ? source.mode : 'dark';
  const requestedId = typeof source.id === 'string' ? source.id : '';
  const base = getBuiltinAppearanceTheme(requestedId, mode === 'light' ? 'light' : 'dark');
  const ui = isRecord(source.ui) ? source.ui : {};
  const canvas = isRecord(source.canvas) ? source.canvas : {};
  const node = isRecord(source.node) ? source.node : {};
  const edge = isRecord(source.edge) ? source.edge : {};
  const handle = isRecord(source.handle) ? source.handle : {};
  const motion = isRecord(source.motion) ? source.motion : {};
  return {
    ...base,
    ...source,
    schemaVersion: 1,
    id: requestedId || base.id,
    name: typeof source.name === 'string' && source.name.trim() ? source.name : base.name,
    builtin: typeof source.builtin === 'boolean' ? source.builtin : base.builtin,
    mode,
    ui: { ...base.ui, ...ui },
    canvas: { ...base.canvas, ...canvas },
    node: { ...base.node, ...node },
    edge: { ...base.edge, ...edge },
    handle: {
      ...base.handle,
      ...handle,
      kind: handle.kind === 'image' || handle.kind === 'color'
        ? handle.kind
        : typeof handle.imageDataUrl === 'string' && handle.imageDataUrl.length > 0 ? 'image' : base.handle.kind,
    },
    motion: { ...base.motion, ...motion },
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : base.createdAt,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : base.updatedAt,
  } as AppearanceTheme;
}

export function getBuiltinAppearanceTheme(id: string, mode: 'dark' | 'light' = 'dark'): AppearanceTheme {
  return createBuiltinAppearanceThemes().find((theme) => theme.id === id)
    ?? createBuiltinAppearanceThemes().find((theme) => theme.id === `standard-${mode}`)!;
}
