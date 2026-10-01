import { describe, expect, it, vi } from 'vitest';
import { createBuiltinAppearanceThemes, normalizeAppearanceTheme } from '../../src/services/appearance/appearanceDefaults';
import { migrateLegacyAppearance } from '../../src/services/appearance/appearanceMigration';
import { applyAppearanceTheme } from '../../src/services/appearance/appearanceRuntime';
import type { AppConfig } from '../../src/types';

describe('appearance themes', () => {
  it('ships complete snapshots for every built-in preset', () => {
    const themes = createBuiltinAppearanceThemes();
    expect(themes.map((theme) => theme.id)).toEqual([
      'standard-dark', 'standard-light', 'solar-system', 'frosted-warm-light',
    ]);
    for (const theme of themes) {
      expect(theme.ui).toBeDefined();
      expect(theme.canvas).toBeDefined();
      expect(theme.node).toBeDefined();
      expect(theme.edge).toBeDefined();
      expect(theme.handle).toBeDefined();
      expect(theme.motion).toBeDefined();
    }
    expect(themes.find((theme) => theme.id === 'solar-system')?.node.background).toBe('#14141c');
    const dark = themes.find((theme) => theme.id === 'standard-dark');
    expect(dark?.ui).toEqual(expect.objectContaining({
      surface: '#14141c',
      accent: '#6366f1',
      card: '#1a1a26',
    }));
    expect(dark?.canvas).toEqual(expect.objectContaining({
      kind: 'color',
      color: '#0a0a0f',
      gridColor: '#585868',
    }));
    expect(dark?.node).toEqual(expect.objectContaining({
      background: '#14141c',
      border: '#2a2a3a',
      borderWidth: 0,
      radius: 12,
      selectedBorder: '#6366f1',
    }));
    expect(dark?.edge).toEqual(expect.objectContaining({
      color: '#33334a',
      flowColor: '#818cf8',
    }));
    expect(dark?.handle).toEqual(expect.objectContaining({
      kind: 'color',
      color: '#6366f1',
      hoverColor: '#818cf8',
    }));
    const light = themes.find((theme) => theme.id === 'standard-light');
    expect(light?.canvas).toEqual(expect.objectContaining({ kind: 'color', color: '#F4F6FB', gridColor: '#B1B1B7' }));
    expect(light?.ui).toEqual(expect.objectContaining({ text: '#33364D', textSecondary: '#6E7488', border: '#E4E8F2' }));
    expect(light?.edge.color).toBe('#B1B1B7');
  });

  it('maps legacy canvas settings into one complete appearance snapshot', () => {
    const config = {
      providers: {},
      theme: 'light',
      canvasBackground: 'custom',
      customBackgroundUrl: 'data:image/png;base64,fixture',
      customBackgroundOpacity: 0.4,
    } as AppConfig;
    const theme = migrateLegacyAppearance(config);
    expect(theme.mode).toBe('light');
    expect(theme.canvas.kind).toBe('image');
    expect(theme.canvas.imageDataUrl).toContain('data:image/png');
    expect(theme.canvas.imageOpacity).toBe(0.4);
    expect(theme.node).toBeDefined();
    expect(theme.edge).toBeDefined();
    expect(theme.handle).toBeDefined();
  });

  it('fills missing sections in older persisted snapshots', () => {
    const theme = normalizeAppearanceTheme({ id: 'old-custom', name: '旧主题', mode: 'dark', ui: { accent: '#ff00aa' } });
    expect(theme.id).toBe('old-custom');
    expect(theme.ui.accent).toBe('#ff00aa');
    expect(theme.motion.enabled).toBe(true);
    expect(theme.canvas.gridVisible).toBe(true);
    expect(theme.edge.color).toBeDefined();
    expect(theme.handle.size).toBe(40);
    expect(theme.handle.kind).toBe('color');
  });

  it('infers image handle mode for older themes that only stored the image data', () => {
    const theme = normalizeAppearanceTheme({
      id: 'old-image-handle',
      handle: { imageDataUrl: 'data:image/png;base64,fixture' },
    });
    expect(theme.handle.kind).toBe('image');
  });

  it('preserves valid custom colors while normalizing the surrounding snapshot', () => {
    const theme = normalizeAppearanceTheme({
      id: 'custom-colors',
      mode: 'dark',
      ui: {
        accent: '#ffffff',
        accentStrong: '#ffffff',
        surface: '#141414',
        card: '#171717',
        hover: '#262626',
        border: '#363636',
      },
      canvas: { kind: 'color', color: '#141414', gridColor: '#474747' },
      node: { background: '#262626', border: '#363636', selectedBorder: '#a8a8a8' },
      edge: { color: '#86909C', flowColor: '#6bb6fb', previewColor: '#86909C' },
    });

    expect(theme.ui).toEqual(expect.objectContaining({
      accent: '#ffffff',
      accentStrong: '#ffffff',
      surface: '#141414',
      card: '#171717',
      hover: '#262626',
      border: '#363636',
    }));
    expect(theme.canvas).toEqual(expect.objectContaining({ color: '#141414', gridColor: '#474747' }));
    expect(theme.node).toEqual(expect.objectContaining({ background: '#262626', border: '#363636', selectedBorder: '#a8a8a8' }));
    expect(theme.edge).toEqual(expect.objectContaining({ color: '#86909C', flowColor: '#6bb6fb', previewColor: '#86909C' }));
  });

  it('derives every brand alpha token from the active accent color', () => {
    const values = new Map<string, string>();
    const root = {
      dataset: {},
      setAttribute: vi.fn(),
      style: {
        setProperty: (name: string, value: string) => values.set(name, value),
        removeProperty: (name: string) => values.delete(name),
      },
    } as unknown as HTMLElement;
    vi.stubGlobal('document', { documentElement: root });

    try {
      const base = createBuiltinAppearanceThemes()[0];
      applyAppearanceTheme({ ...base, ui: { ...base.ui, accent: '#c24172' } });

      for (const opacity of [4, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 80]) {
        const token = `--brand-alpha-${String(opacity).padStart(2, '0')}`;
        expect(values.get(token)).toBe(`color-mix(in srgb, #c24172 ${opacity}%, transparent)`);
      }
      expect(values.get('--tw-indigo-500')).toBe('194 65 114');
      expect(values.get('--white-alpha-10')).toBe('color-mix(in srgb, #ffffff 10%, transparent)');
      expect(values.get('--black-alpha-50')).toBe('rgba(0, 0, 0, 0.5)');
      expect(values.get('--theme-bg')).toBe('#0a0a0f');
      expect(values.get('--theme-surface')).toBe('#14141c');
      expect(values.get('--glass-panel-bg')).toBe('#14141c');
      expect(values.get('--theme-card')).toBe('#1a1a26');
      expect(values.get('--theme-hover')).toBe('#252535');
      expect(values.get('--theme-border')).toBe('#2a2a3a');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the solar preset neutral and restores its translucent panels', () => {
    const values = new Map<string, string>();
    const root = {
      dataset: {},
      setAttribute: vi.fn(),
      style: {
        setProperty: (name: string, value: string) => values.set(name, value),
        removeProperty: (name: string) => values.delete(name),
      },
    } as unknown as HTMLElement;
    vi.stubGlobal('document', { documentElement: root });

    try {
      const solar = createBuiltinAppearanceThemes().find((theme) => theme.id === 'solar-system')!;
      applyAppearanceTheme(solar);
      expect(values.get('--theme-surface')).toBe('#14141c');
      expect(values.get('--theme-card')).toBe('#1a1a26');
      expect(values.get('--theme-hover')).toBe('#252535');
      expect(values.get('--theme-border')).toBe('#2a2a3a');
      expect(values.get('--glass-panel-bg')).toBe('color-mix(in srgb, #14141c 77%, transparent)');
      expect(values.get('--brand')).toBe('#6366f1');
      expect(values.get('--node-image')).toBeUndefined();
      applyAppearanceTheme({ ...solar, ui: { ...solar.ui, surface: '#ffffff', card: '#f4f4f4' } });
      expect(values.get('--glass-panel-bg')).toBe('#ffffff');
      expect(values.get('--glass-bg-node')).toBe('#f4f4f4');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('correctly maps "transparent" / "none" / "无" border and background colors to transparent in CSS variables', () => {
    const values = new Map<string, string>();
    const root = {
      dataset: {},
      setAttribute: vi.fn(),
      style: {
        setProperty: (name: string, value: string) => values.set(name, value),
        removeProperty: (name: string) => values.delete(name),
      },
    } as unknown as HTMLElement;
    vi.stubGlobal('document', { documentElement: root });

    try {
      const base = createBuiltinAppearanceThemes()[0];
      applyAppearanceTheme({
        ...base,
        node: {
          ...base.node,
          background: 'transparent',
          border: 'none',
          selectedBorder: '无',
        },
        canvas: {
          ...base.canvas,
          gridColor: 'transparent',
        },
      });

      expect(values.get('--appearance-node-background')).toBe('transparent');
      expect(values.get('--appearance-node-border')).toBe('transparent');
      expect(values.get('--appearance-node-selected-border')).toBe('transparent');
      expect(values.get('--canvas-grid-color')).toBe('transparent');
      expect(values.get('--appearance-node-radius')).toBe(`${base.node.radius}px`);
      expect(values.get('--appearance-node-radius-inner')).toBe(`${Math.max(0, base.node.radius - 4)}px`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
