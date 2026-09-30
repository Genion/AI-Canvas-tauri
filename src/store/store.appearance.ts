import type { StateCreator } from 'zustand';
import type { AppConfig, AppearanceTheme } from '../types';
import type { AppState } from './useAppStore';
import { cloneAppearanceTheme, createBuiltinAppearanceThemes, getBuiltinAppearanceTheme, normalizeAppearanceTheme } from '../services/appearance/appearanceDefaults';
import { migrateLegacyAppearance } from '../services/appearance/appearanceMigration';
import { deleteAppearanceTheme, loadAppearanceThemes, saveAppearanceTheme } from '../services/appearance/appearanceThemeService';
import { applyAppearanceTheme } from '../services/appearance/appearanceRuntime';

function withLegacyConfig(theme: AppearanceTheme): Partial<AppConfig> {
  const canvasBackground = theme.canvas.kind === 'image'
    ? 'custom'
    : theme.canvas.kind === 'color'
      ? theme.mode === 'light' ? 'off-white' : 'default'
      : theme.canvas.kind;
  return {
    appearance: theme,
    theme: theme.mode,
    canvasBackground,
    customBackgroundUrl: theme.canvas.kind === 'image' ? theme.canvas.imageDataUrl : undefined,
    customBackgroundOpacity: theme.canvas.kind === 'image' ? theme.canvas.imageOpacity : undefined,
    offWhiteBackgroundColor: theme.canvas.kind === 'color' && theme.mode === 'light' ? theme.canvas.color : undefined,
  } as Partial<AppConfig>;
}
export interface AppearanceSlice {
  appearanceThemes: AppearanceTheme[];
  appearancePreview: AppearanceTheme | null;
  appearanceHydrated: boolean;
  loadAppearanceThemes: () => Promise<void>;
  previewAppearanceTheme: (theme: AppearanceTheme) => void;
  clearAppearancePreview: () => void;
  activateAppearanceTheme: (theme: AppearanceTheme) => Promise<void>;
  saveAppearanceTheme: (theme: AppearanceTheme) => Promise<void>;
  duplicateAppearanceTheme: (theme: AppearanceTheme, name?: string) => Promise<AppearanceTheme>;
  renameAppearanceTheme: (id: string, name: string) => Promise<void>;
  deleteAppearanceTheme: (id: string) => Promise<void>;
}

export const createAppearanceSlice: StateCreator<AppState, [], [], AppearanceSlice> = (set, get) => ({
  appearanceThemes: createBuiltinAppearanceThemes(),
  appearancePreview: null,
  appearanceHydrated: false,

  loadAppearanceThemes: async () => {
    const stored = await loadAppearanceThemes();
    const builtins = createBuiltinAppearanceThemes();
    const custom = stored.filter((theme) => !theme.builtin).map(normalizeAppearanceTheme);
    const state = get();
    const active = normalizeAppearanceTheme(state.config.appearance ?? migrateLegacyAppearance(state.config));
    const activeId = custom.some((theme) => theme.id === active.id) || builtins.some((theme) => theme.id === active.id)
      ? active.id
      : active.id;
    if (!state.config.appearance || state.config.appearance.id !== activeId) {
      state.updateConfig(withLegacyConfig(active));
    }
    set({ appearanceThemes: [...builtins, ...custom], appearanceHydrated: true });
  },

  previewAppearanceTheme: (theme) => {
    const next = normalizeAppearanceTheme(theme);
    set({ appearancePreview: next });
    applyAppearanceTheme(next);
  },

  clearAppearancePreview: () => set({ appearancePreview: null }),

  activateAppearanceTheme: async (theme) => {
    const next = normalizeAppearanceTheme(theme);
    get().updateConfig(withLegacyConfig(next));
    set({ appearancePreview: null });
    await get().saveConfig({ silent: true });
  },

  saveAppearanceTheme: async (theme) => {
    const next = { ...normalizeAppearanceTheme(theme), builtin: false, updatedAt: Date.now() };
    set({ appearanceThemes: get().appearanceThemes.some((item) => item.id === next.id)
      ? get().appearanceThemes.map((item) => item.id === next.id ? next : item)
      : [...get().appearanceThemes, next] });
    await saveAppearanceTheme(next);
    await get().activateAppearanceTheme(next);
  },

  duplicateAppearanceTheme: async (theme, name) => {
    const id = `theme-${Date.now().toString(36)}`;
    const next = cloneAppearanceTheme(theme, id, name?.trim() || `${theme.name}（自定义）`);
    await get().saveAppearanceTheme(next);
    return next;
  },

  renameAppearanceTheme: async (id, name) => {
    const item = get().appearanceThemes.find((theme) => theme.id === id);
    const trimmed = name.trim();
    if (!item || item.builtin || !trimmed || trimmed === item.name) return;
    const next = { ...item, name: trimmed, updatedAt: Date.now(), builtin: false };
    set({ appearanceThemes: get().appearanceThemes.map((theme) => theme.id === id ? next : theme) });
    await saveAppearanceTheme(next);
    if (get().config.appearance?.id === id) await get().activateAppearanceTheme(next);
  },

  deleteAppearanceTheme: async (id) => {
    const item = get().appearanceThemes.find((theme) => theme.id === id);
    if (!item || item.builtin) return;
    await deleteAppearanceTheme(id);
    const fallback = getBuiltinAppearanceTheme('standard-dark');
    set({ appearanceThemes: get().appearanceThemes.filter((theme) => theme.id !== id) });
    if (get().config.appearance?.id === id) await get().activateAppearanceTheme(fallback);
  },
});
