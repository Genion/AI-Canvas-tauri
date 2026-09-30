import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { useAppStore } from '../../store/useAppStore';
import type { AppearanceTheme } from '../../types';
import { getBuiltinAppearanceTheme, normalizeAppearanceTheme } from '../../services/appearance/appearanceDefaults';
import { resolveAppearanceMode, resolveAppearanceTheme } from '../../services/appearance/appearanceRuntime';
import { exportAppearanceTheme, importAppearanceTheme } from '../../services/appearance/appearanceThemeService';
import { saveBinaryToLocalFile } from '../../services/fileService';
import { isTauriEnv } from '../../services/fs/core';
import { registerSettingsProducer } from '../../services/configPersistenceQueue';
import AnimatedButton from '../shared/AnimatedButton';
import ModalOverlay from '../shared/ModalOverlay';
import { useT } from '../../i18n';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-canvas-text-secondary">
      <span className="shrink-0">{label}</span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </label>
  );
}

const THEME_COLOR_SWATCHES = [
  '#5368d6', '#2563eb', '#0f766e', '#b45309', '#be4b78', '#7c3aed',
] as const;

function ColorSwatches({ colors, value, onChange, label }: {
  colors: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={`${label}常用颜色`}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={`h-6 w-6 rounded-md border transition-transform hover:scale-110 ${value.toLowerCase() === color.toLowerCase() ? 'border-canvas-text ring-2 ring-brand/30' : 'border-canvas-border'}`}
          style={{ backgroundColor: color }}
          aria-label={`${label} ${color}`}
          title={color}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

function ColorField({ label, value, onChange, colors }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colors?: readonly string[];
}) {
  return (
    <div className="grid gap-1.5">
      <Field label={label}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#5368d6'} onChange={(event) => onChange(event.target.value)} className="h-7 w-9 cursor-pointer rounded border border-canvas-border bg-transparent p-0.5" />
        <input value={value} onChange={(event) => onChange(event.target.value)} className="ui-input w-28 text-xs" />
      </Field>
      {colors && <ColorSwatches colors={colors} value={value} onChange={onChange} label={label} />}
    </div>
  );
}

function CompactColorField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 rounded-xl border border-canvas-border/70 bg-canvas-card/50 px-3 py-2.5">
      <span className="text-[11px] font-medium text-canvas-text-secondary">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#5368d6'} onChange={(event) => onChange(event.target.value)} className="h-7 w-9 shrink-0 cursor-pointer rounded border border-canvas-border bg-transparent p-0.5" />
        <input value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label}颜色代码`} className="ui-input min-w-0 flex-1 text-xs" />
      </span>
    </label>
  );
}

function RangeNumberField({ label, value, min, max, step = 1, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid min-w-0 gap-2 rounded-xl border border-canvas-border/70 bg-canvas-card/50 px-3 py-2.5">
      <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-canvas-text-secondary">
        <span>{label}</span>
        <span className="flex shrink-0 items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="ui-input w-16 text-xs"
          aria-label={`${label}数值`}
        />
          <span className="text-xs text-canvas-text-muted">px</span>
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={`${label}滑块`} className="w-full" />
    </label>
  );
}

const SECTION_ICONS: Record<string, string> = {
  '外观预设': 'lucide:layers-3',
  '主题模式': 'lucide:sun-moon',
  '主题色': 'lucide:palette',
  '画布': 'lucide:layout-dashboard',
  '节点外观': 'lucide:box',
  '连接线': 'lucide:route',
  '连接手柄': 'lucide:mouse-pointer-2',
};

function EditorSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-canvas-border bg-canvas-surface/80 p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Icon icon={SECTION_ICONS[title] ?? 'lucide:sliders-horizontal'} width="16" height="16" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-canvas-text">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-canvas-text-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 1024 1024" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M757.934 1024H205.213c-37.08 0-70.971-31.966-70.971-68.162V323.102l67.245-31.593h557.249l67.243 31.593v632.736c0 36.196-30.971 68.162-68.045 68.162zM196.95 330.778v625.06c0 1.968 3.714 5.577 9.774 5.577h546.681c6.06 0 9.773-3.615 9.773-5.577v-625.06H196.95z" />
      <path d="M885.083 331.135H75.482c-37.077 0-67.24-27.443-67.24-61.172v-66.397c0-33.723 30.163-61.161 67.24-61.161h809.601c37.079 0 67.243 27.438 67.243 61.161v66.397c0 33.729-30.164 61.172-67.243 61.172zM71.073 268.228h817.832v-63.324H71.073v63.324z" />
      <path d="M633.102 201.67H332.368c-37.083 0-71.877-27.443-71.877-61.172V77.607c0-33.723 34.794-61.161 71.877-61.161h300.734c37.08 0 67.244 27.438 67.244 61.161v62.891c0 33.729-92.972 61.172-67.244 61.172zM638.024 140.295V79.427H323.2v60.868h314.824z" />
      <path d="M322.84 457.025h62.985v377.63H322.84zM449.015 457.025H512v377.63h-62.985zM574.832 457.025h62.985v377.63h-62.985z" />
    </svg>
  );
}

function imagePreviewStyle(imageDataUrl: string | undefined, size: CSSProperties['backgroundSize'] = 'cover'): CSSProperties | undefined {
  return imageDataUrl
    ? { backgroundImage: `url(${imageDataUrl})`, backgroundPosition: 'center', backgroundSize: size === 'fill' ? '100% 100%' : size }
    : undefined;
}

function ThemePreview({ theme }: { theme: AppearanceTheme }) {
  const resolved = resolveAppearanceTheme(theme);
  const canvasStyle = resolved.canvas.kind === 'color'
    ? { backgroundColor: resolved.canvas.color }
    : resolved.canvas.kind === 'image'
      ? imagePreviewStyle(resolved.canvas.imageDataUrl)
      : { backgroundColor: resolved.ui.background };
  const gridColor = /^#[0-9a-f]{6}$/i.test(resolved.canvas.gridColor) ? resolved.canvas.gridColor : '#ffffff';
  const handleStyle = resolved.handle.kind === 'image' && resolved.handle.imageDataUrl
    ? imagePreviewStyle(resolved.handle.imageDataUrl, resolved.handle.imageFit)
    : { backgroundColor: resolved.handle.color };
  return (
    <div className="relative h-20 overflow-hidden rounded-xl border border-canvas-border/70" style={canvasStyle}>
      <div className="absolute inset-0 opacity-35" style={{ backgroundImage: `radial-gradient(circle, ${gridColor} 1px, transparent 1px)`, backgroundSize: '14px 14px' }} />
      <div className="absolute bottom-2 left-3 right-3 flex items-end gap-2">
        <span className="h-8 w-20 rounded-md border" style={{ backgroundColor: resolved.node.background, borderColor: resolved.node.border }} />
        <span className="mb-2 h-5 flex-1 rounded-full" style={{ backgroundColor: resolved.ui.accent, opacity: 0.8 }} />
        <span className="h-5 w-5 rounded-full border-2 bg-center bg-no-repeat" style={{ ...handleStyle, borderColor: resolved.handle.hoverColor }} />
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const t = useT();
  const config = useAppStore((state) => state.config);
  const themes = useAppStore((state) => state.appearanceThemes);
  const preview = useAppStore((state) => state.previewAppearanceTheme);
  const clearPreview = useAppStore((state) => state.clearAppearancePreview);
  const activate = useAppStore((state) => state.activateAppearanceTheme);
  const saveTheme = useAppStore((state) => state.saveAppearanceTheme);
  const duplicateTheme = useAppStore((state) => state.duplicateAppearanceTheme);
  const renameTheme = useAppStore((state) => state.renameAppearanceTheme);
  const deleteTheme = useAppStore((state) => state.deleteAppearanceTheme);
  const showToast = useAppStore((state) => state.showToast);
  const importRef = useRef<HTMLInputElement>(null);
  const canvasImageRef = useRef<HTMLInputElement>(null);
  const handleImageRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<AppearanceTheme | null>(null);
  const draftRef = useRef<AppearanceTheme | null>(null);
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const [presetName, setPresetName] = useState('');
  const [isNamingPreset, setIsNamingPreset] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');
  const [confirmation, setConfirmation] = useState<{ kind: 'delete' | 'overwrite'; theme: AppearanceTheme } | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const persistedTheme = config.appearance
    ? normalizeAppearanceTheme(config.appearance)
    : themes.find((theme) => theme.id === config.theme)
    ?? themes[0];
  const savedActive = normalizeAppearanceTheme(persistedTheme);
  const active = draft ?? savedActive;
  const presetThemes = themes;
  const currentPreset = themes.find((theme) => theme.id === savedActive.id);
  useEffect(() => () => {
    if (useAppStore.getState().appearancePreview) clearPreview();
  }, [clearPreview]);

  const update = (patch: (theme: AppearanceTheme) => AppearanceTheme) => {
    const editable = structuredClone(draft ?? savedActive);
    const next = normalizeAppearanceTheme(patch(editable));
    draftRef.current = next;
    setDraft(next);
    setAutoSaveStatus('saving');
    preview(next);
  };

  const flushDraft = useCallback(async () => {
    while (true) {
      if (pendingSaveRef.current) {
        await pendingSaveRef.current;
        continue;
      }
      const pending = draftRef.current;
      if (!pending) return;
      const save = activate({ ...pending, updatedAt: Date.now() });
      pendingSaveRef.current = save;
      try {
        await save;
        if (draftRef.current === pending) {
          draftRef.current = null;
          setDraft(null);
          setAutoSaveStatus('saved');
        }
      } catch (error) {
        if (draftRef.current === pending) setAutoSaveStatus('error');
        throw error;
      } finally {
        if (pendingSaveRef.current === save) pendingSaveRef.current = null;
      }
    }
  }, [activate]);

  useEffect(() => registerSettingsProducer(flushDraft), [flushDraft]);

  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(() => {
      void flushDraft().catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, flushDraft]);

  if (!active) return null;

  const updateMode = async (mode: AppearanceTheme['mode']) => {
    const resolvedMode = resolveAppearanceMode(mode);
    const base = getBuiltinAppearanceTheme(`standard-${resolvedMode}`);
    draftRef.current = null;
    setDraft(null);
    setAutoSaveStatus('idle');
    await activate({ ...base, mode });
  };

  const importTheme = async (file: File) => {
    try {
      const theme = await importAppearanceTheme(file);
      await saveTheme(theme);
      draftRef.current = null;
      setDraft(null);
      setAutoSaveStatus('idle');
      showToast(t('主题已导入'), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('主题导入失败'), 'error');
    }
  };

  const exportTheme = async () => {
    const fileName = `${active.name || 'ai-canvas-theme'}.aicanvas-theme`;
    const blob = exportAppearanceTheme(active);
    try {
      if (isTauriEnv()) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const savedPath = await saveBinaryToLocalFile(bytes, fileName, [
          { name: 'AI Canvas 主题', extensions: ['aicanvas-theme'] },
          { name: 'JSON 文件', extensions: ['json'] },
        ]);
        if (savedPath) showToast(t('主题已导出'), 'success');
        return;
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(t('主题已导出'), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('主题导出失败'), 'error');
    }
  };

  const setCanvasImage = async (file: File) => {
    const imageDataUrl = await readFileAsDataUrl(file);
    update((theme) => ({ ...theme, canvas: { ...theme.canvas, kind: 'image', imageDataUrl } }));
  };

  const setHandleImage = async (file: File) => {
    const imageDataUrl = await readFileAsDataUrl(file);
    update((theme) => ({ ...theme, handle: { ...theme.handle, kind: 'image', imageDataUrl } }));
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) {
      showToast(t('请输入预设名称'), 'info');
      return;
    }
    try {
      await duplicateTheme(active, name);
      setPresetName('');
      setIsNamingPreset(false);
      draftRef.current = null;
      setDraft(null);
      showToast(t('预设已保存'), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('预设保存失败'), 'error');
    }
  };

  const renamePreset = async (theme: AppearanceTheme) => {
    if (editingPresetId !== theme.id) return;
    const name = editingPresetName.trim();
    setEditingPresetId(null);
    if (!name || name === theme.name || theme.builtin) return;
    try {
      await renameTheme(theme.id, name);
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('预设重命名失败'), 'error');
    }
  };

  const confirmPresetAction = async () => {
    const pending = confirmation;
    if (!pending) return;
    setConfirmation(null);
    try {
      if (pending.kind === 'delete') {
        if (pending.theme.id === savedActive.id) {
          draftRef.current = null;
          setDraft(null);
        }
        await deleteTheme(pending.theme.id);
        setAutoSaveStatus('saved');
        return;
      }
      await saveTheme({
        ...active,
        id: pending.theme.id,
        name: pending.theme.name,
        builtin: false,
        updatedAt: Date.now(),
      });
      draftRef.current = null;
      setDraft(null);
      setAutoSaveStatus('saved');
      showToast(t('当前预设已覆盖'), 'success');
    } catch (error) {
      setAutoSaveStatus('error');
      showToast(error instanceof Error ? error.message : t('预设操作失败'), 'error');
    }
  };

  return (
    <div className="space-y-7 pb-3">
      <header className="border-b border-canvas-border/80 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-canvas-border bg-canvas-card text-brand shadow-sm">
              <Icon icon="lucide:sparkles" width="21" height="21" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-canvas-text">{t('外观')}</h3>
                <span className="rounded-full border border-canvas-border bg-canvas-card px-2 py-0.5 text-[10px] text-canvas-text-muted">{active.name}</span>
              </div>
              <p className="mt-1 max-w-xl text-xs leading-5 text-canvas-text-muted">{t('外观预设包含画布、节点、连接线、连接手柄和所有页面配色')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex w-36 shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] ${autoSaveStatus === 'error' ? 'text-danger' : 'text-canvas-text-muted'}`} role="status">
              <span className={`h-1.5 w-1.5 rounded-full ${autoSaveStatus === 'saving' ? 'animate-pulse bg-brand' : autoSaveStatus === 'error' ? 'bg-danger' : 'bg-emerald-400'}`} />
              {autoSaveStatus === 'saving' ? t('正在自动保存…') : autoSaveStatus === 'saved' ? t('已自动保存') : autoSaveStatus === 'error' ? t('自动保存失败，请重试') : t('自动保存')}
            </span>
            <AnimatedButton type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => importRef.current?.click()}><Icon icon="lucide:upload" />{t('导入')}</AnimatedButton>
            <AnimatedButton type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => void exportTheme()}><Icon icon="lucide:download" />{t('导出')}</AnimatedButton>
            {isNamingPreset && <input autoFocus value={presetName} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void savePreset(); if (event.key === 'Escape') { setPresetName(''); setIsNamingPreset(false); } }} placeholder={t('输入预设名称')} className="ui-input w-44 text-xs" />}
            {isNamingPreset && <AnimatedButton type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => void savePreset()}><Icon icon="lucide:check" />{t('确认保存')}</AnimatedButton>}
            {isNamingPreset && <AnimatedButton type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { setPresetName(''); setIsNamingPreset(false); }}>{t('取消')}</AnimatedButton>}
            {!isNamingPreset && <AnimatedButton type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => { setPresetName(''); setIsNamingPreset(true); }}><Icon icon="lucide:save" />{t('保存预设')}</AnimatedButton>}
            {!isNamingPreset && <AnimatedButton type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!currentPreset || currentPreset.builtin} title={currentPreset?.builtin ? t('内置预设不可覆盖') : t('覆盖当前预设')} onClick={() => { if (currentPreset && !currentPreset.builtin) setConfirmation({ kind: 'overwrite', theme: currentPreset }); }}><Icon icon="lucide:refresh-cw" />{t('覆盖当前预设')}</AnimatedButton>}
            <input ref={importRef} type="file" accept=".aicanvas-theme,.json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importTheme(file); event.currentTarget.value = ''; }} />
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <ThemePreview theme={active} />
          <div className="flex items-center gap-2 sm:flex-col sm:items-end">
            <span className="text-[10px] uppercase tracking-[0.16em] text-canvas-text-muted">{t('当前主题')}</span>
            <span className="text-xs font-medium text-canvas-text">{active.mode === 'dark' ? t('深色') : active.mode === 'light' ? t('浅色') : t('跟随系统')}</span>
          </div>
        </div>
      </header>

      <EditorSection title={t('外观预设')} description={t('选择、保存或管理完整外观配置')}>
        <div className="grid max-h-[18rem] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {presetThemes.map((theme) => (
            <div key={theme.id} className={`group rounded-xl border p-2 transition-colors ${theme.id === active.id ? 'border-brand/70 bg-brand/5 shadow-sm' : 'border-canvas-border bg-canvas-card/70 hover:border-canvas-hover'}`}>
              <button type="button" onClick={() => { draftRef.current = null; setDraft(null); setAutoSaveStatus('idle'); void activate(theme); }} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
                <ThemePreview theme={theme} />
              </button>
              <div className="mt-2 space-y-2 px-1">
                {editingPresetId === theme.id ? (
                  <input autoFocus value={editingPresetName} onChange={(event) => setEditingPresetName(event.target.value)} onBlur={() => void renamePreset(theme)} onKeyDown={(event) => { if (event.key === 'Enter') void renamePreset(theme); if (event.key === 'Escape') setEditingPresetId(null); }} className="ui-input w-full py-1 text-xs" aria-label={t('预设名称')} />
                ) : (
                  theme.builtin ? (
                    <span className="block w-full whitespace-normal break-all text-xs font-medium leading-4 text-canvas-text" title={theme.name}>{theme.name}</span>
                  ) : (
                    <button type="button" className="group/name flex w-full min-w-0 items-start gap-1 rounded px-1 py-0.5 text-left text-xs font-medium leading-4 text-canvas-text transition-colors hover:bg-brand/10 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50" title={t('双击修改名称')} aria-label={`${theme.name}，${t('双击修改名称')}`} onDoubleClick={() => { setEditingPresetId(theme.id); setEditingPresetName(theme.name); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); setEditingPresetId(theme.id); setEditingPresetName(theme.name); } }}>
                      <span className="min-w-0 flex-1 whitespace-normal break-all group-hover/name:underline group-hover/name:underline-offset-2">{theme.name}</span>
                      <Icon icon="lucide:pencil" width="11" height="11" className="shrink-0 opacity-0 transition-opacity group-hover/name:opacity-100 group-focus-visible/name:opacity-100" />
                    </button>
                  )
                )}
                <div className="flex min-h-6 items-center gap-2">
                  {theme.id === active.id && <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[9px] font-medium text-brand">{t('当前使用')}</span>}
                  <span className="rounded-full border border-canvas-border px-1.5 py-0.5 text-[9px] text-canvas-text-muted">{theme.builtin ? t('内置') : t('自定义')}</span>
                  {!theme.builtin && <button type="button" className="ui-icon-btn ui-icon-btn--sm ml-auto text-canvas-text-muted opacity-60 transition-opacity hover:text-danger group-hover:opacity-100" aria-label={t('删除预设')} data-tooltip={t('删除预设')} onClick={() => { setConfirmation({ kind: 'delete', theme }); }}><TrashIcon /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </EditorSection>

      <div className="space-y-3">
        <EditorSection title={t('主题模式')} description={t('选择整套界面的明暗基调')}>
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-canvas-card/70 p-1.5">
            {(['dark', 'light', 'system'] as const).map((mode) => (
              <AnimatedButton key={mode} type="button" className={`ui-btn ui-btn--secondary ui-btn--sm w-full ${active.mode === mode ? 'is-active' : ''}`} onClick={() => void updateMode(mode)}>
                <Icon icon={mode === 'dark' ? 'lucide:moon' : mode === 'light' ? 'lucide:sun' : 'lucide:monitor'} width="14" height="14" />
                {mode === 'dark' ? t('深色') : mode === 'light' ? t('浅色') : t('跟随系统')}
              </AnimatedButton>
            ))}
          </div>
        </EditorSection>

        <EditorSection title={t('主题色')} description={t('统一按钮和选中态强调色')}>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 space-y-2">
              <CompactColorField label={t('主题色')} value={active.ui.accent} onChange={(value) => update((theme) => ({ ...theme, ui: { ...theme.ui, accent: value, accentStrong: value, accentSoft: value, focus: value } }))} />
              <ColorSwatches colors={THEME_COLOR_SWATCHES} value={active.ui.accent} onChange={(value) => update((theme) => ({ ...theme, ui: { ...theme.ui, accent: value, accentStrong: value, accentSoft: value, focus: value } }))} label={t('主题色')} />
            </div>
          </div>
        </EditorSection>

        <EditorSection title={t('界面底色')} description={t('分别配置页面、窗口和组件各层底色')}>
          <div className="grid grid-cols-2 gap-2">
            <CompactColorField label={t('页面背景')} value={active.ui.background} onChange={(value) => update((theme) => ({ ...theme, ui: { ...theme.ui, background: value } }))} />
            <CompactColorField label={t('窗口背景')} value={active.ui.surface} onChange={(value) => update((theme) => ({ ...theme, ui: { ...theme.ui, surface: value } }))} />
            <CompactColorField label={t('组件底色')} value={active.ui.card} onChange={(value) => update((theme) => ({ ...theme, ui: { ...theme.ui, card: value } }))} />
            <CompactColorField label={t('组件悬浮底色')} value={active.ui.hover} onChange={(value) => update((theme) => ({ ...theme, ui: { ...theme.ui, hover: value } }))} />
            <CompactColorField label={t('组件边框')} value={active.ui.border} onChange={(value) => update((theme) => ({ ...theme, ui: { ...theme.ui, border: value } }))} />
          </div>
        </EditorSection>

        <EditorSection title={t('画布')} description={t('背景与网格')}>
          <div className="space-y-3">
            <Field label={t('背景类型')}><select className="ui-select w-40" value={active.canvas.kind} onChange={(event) => update((theme) => ({ ...theme, canvas: { ...theme.canvas, kind: event.target.value as AppearanceTheme['canvas']['kind'] } }))}><option value="color">{t('纯色')}</option><option value="image">{t('图片')}</option><option value="solar-system">{t('太阳系')}</option><option value="frosted-glass">{t('磨砂暖光')}</option></select></Field>
            {active.canvas.kind === 'color' && <CompactColorField label={t('自定义颜色')} value={active.canvas.color} onChange={(value) => update((theme) => ({ ...theme, canvas: { ...theme.canvas, color: value, kind: 'color' } }))} />}
            {active.canvas.kind === 'image' && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-canvas-border/70 bg-canvas-card/50 p-3">
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md border border-canvas-border bg-canvas-surface bg-cover bg-center" style={imagePreviewStyle(active.canvas.imageDataUrl)}>
                  {!active.canvas.imageDataUrl && <span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-canvas-text-muted">{t('未上传图片')}</span>}
                </div>
                <div className="flex flex-wrap gap-2"><AnimatedButton type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => canvasImageRef.current?.click()}>{t('选择画布图片')}</AnimatedButton>{active.canvas.imageDataUrl && <AnimatedButton type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => update((theme) => ({ ...theme, canvas: { ...theme.canvas, imageDataUrl: undefined } }))}>{t('移除图片')}</AnimatedButton>}<input ref={canvasImageRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void setCanvasImage(file); event.currentTarget.value = ''; }} /></div>
              </div>
            )}
            {(active.canvas.kind === 'color' || active.canvas.kind === 'image') && (
              <div className="grid grid-cols-2 items-center gap-3 rounded-xl border border-canvas-border/70 bg-canvas-card/50 p-3">
                <Field label={t('网格')}><input type="checkbox" checked={active.canvas.gridVisible} onChange={(event) => update((theme) => ({ ...theme, canvas: { ...theme.canvas, gridVisible: event.target.checked } }))} /></Field>
                <CompactColorField label={t('网格颜色')} value={active.canvas.gridColor} onChange={(value) => update((theme) => ({ ...theme, canvas: { ...theme.canvas, gridColor: value } }))} />
              </div>
            )}
          </div>
        </EditorSection>

        <EditorSection title={t('节点外观')} description={t('所有节点共用同一套样式')}>
          <div className="grid grid-cols-2 gap-2">
            {([['background', '节点底色'], ['border', '节点边框'], ['selectedBorder', '选中边框']] as const).map(([key, label]) => <CompactColorField key={key} label={t(label)} value={active.node[key]} onChange={(value) => update((theme) => ({ ...theme, node: { ...theme.node, [key]: value } }))} />)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <RangeNumberField label={t('节点圆角')} min={0} max={24} value={active.node.radius} onChange={(value) => update((theme) => ({ ...theme, node: { ...theme.node, radius: Math.min(24, Math.max(0, value || 0)) } }))} />
            <RangeNumberField label={t('节点边框宽度')} min={0} max={3} step={0.5} value={active.node.borderWidth} onChange={(value) => update((theme) => ({ ...theme, node: { ...theme.node, borderWidth: Math.min(3, Math.max(0, value || 0)) } }))} />
          </div>
        </EditorSection>

        <EditorSection title={t('连接线')} description={t('普通连线、流光与拖拽预览')}>
          <div className="grid grid-cols-2 gap-2">
            <CompactColorField label={t('连接线颜色')} value={active.edge.color} onChange={(value) => update((theme) => ({ ...theme, edge: { ...theme.edge, color: value } }))} />
            <CompactColorField label={t('高亮动画颜色')} value={active.edge.flowColor} onChange={(value) => update((theme) => ({ ...theme, edge: { ...theme.edge, flowColor: value } }))} />
            <CompactColorField label={t('拖拽时连线颜色')} value={active.edge.previewColor} onChange={(value) => update((theme) => ({ ...theme, edge: { ...theme.edge, previewColor: value } }))} />
            <label className="flex items-center justify-between gap-2 rounded-xl border border-canvas-border/70 bg-canvas-card/50 px-3 py-2.5 text-[11px] font-medium text-canvas-text-secondary"><span>{t('启用高亮动画')}</span><input type="checkbox" checked={active.edge.animationEnabled} onChange={(event) => update((theme) => ({ ...theme, edge: { ...theme.edge, animationEnabled: event.target.checked } }))} /></label>
          </div>
        </EditorSection>

        <EditorSection title={t('连接手柄')} description={t('设置节点连接入口的颜色或图片样式')}>
          <div className="space-y-3">
            <div className="rounded-xl border border-canvas-border/70 bg-canvas-card/50 p-3">
              <Field label={t('手柄类型')}>
                <select className="ui-select w-full max-w-[180px]" value={active.handle.kind} onChange={(event) => update((theme) => ({ ...theme, handle: { ...theme.handle, kind: event.target.value as AppearanceTheme['handle']['kind'] } }))}>
                  <option value="color">{t('纯色')}</option>
                  <option value="image">{t('图片')}</option>
                </select>
              </Field>
            </div>

            {active.handle.kind === 'color' && (
              <div className="space-y-2 rounded-xl border border-canvas-border/70 bg-canvas-card/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-canvas-text-secondary">{t('颜色设置')}</span>
                  <span className="text-[10px] text-canvas-text-muted">{t('普通状态与悬浮状态')}</span>
                </div>
                <div className="grid gap-2">
                  <ColorField label={t('手柄颜色')} value={active.handle.color} colors={THEME_COLOR_SWATCHES} onChange={(value) => update((theme) => ({ ...theme, handle: { ...theme.handle, kind: 'color', color: value } }))} />
                  <ColorField label={t('悬浮颜色')} value={active.handle.hoverColor} colors={THEME_COLOR_SWATCHES} onChange={(value) => update((theme) => ({ ...theme, handle: { ...theme.handle, kind: 'color', hoverColor: value } }))} />
                </div>
              </div>
            )}

            {active.handle.kind === 'image' && (
              <div className="space-y-3 rounded-xl border border-canvas-border/70 bg-canvas-card/50 p-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-canvas-border bg-canvas-surface bg-center bg-no-repeat" style={imagePreviewStyle(active.handle.imageDataUrl, active.handle.imageFit)}>
                    {!active.handle.imageDataUrl && <span className="flex h-full items-center justify-center px-1 text-center text-[9px] text-canvas-text-muted">{t('未上传')}</span>}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <AnimatedButton type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => handleImageRef.current?.click()}>{t('选择手柄图片')}</AnimatedButton>
                      {active.handle.imageDataUrl && <AnimatedButton type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => update((theme) => ({ ...theme, handle: { ...theme.handle, imageDataUrl: undefined } }))}>{t('移除图片')}</AnimatedButton>}
                      <input ref={handleImageRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void setHandleImage(file); event.currentTarget.value = ''; }} />
                    </div>
                    <p className="text-[10px] leading-4 text-canvas-text-muted">{t('上传图片后会立即应用到节点连接手柄')}</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label={t('图片适配')}>
                    <select className="ui-select w-full" value={active.handle.imageFit} onChange={(event) => update((theme) => ({ ...theme, handle: { ...theme.handle, imageFit: event.target.value as AppearanceTheme['handle']['imageFit'] } }))}>
                      <option value="contain">{t('完整显示')}</option>
                      <option value="cover">{t('铺满')}</option>
                      <option value="fill">{t('拉伸')}</option>
                    </select>
                  </Field>
                  <Field label={t('图片不透明度')}>
                    <input type="range" min="0.2" max="1" step="0.05" value={active.handle.opacity} onChange={(event) => update((theme) => ({ ...theme, handle: { ...theme.handle, opacity: Number(event.target.value) } }))} className="w-full" />
                    <span className="w-10 shrink-0 text-right tabular-nums">{Math.round(active.handle.opacity * 100)}%</span>
                  </Field>
                </div>
              </div>
            )}

            <RangeNumberField label={t('手柄尺寸')} min={24} max={64} value={active.handle.size} onChange={(value) => update((theme) => ({ ...theme, handle: { ...theme.handle, size: Math.min(64, Math.max(24, value || 24)) } }))} />
          </div>
        </EditorSection>
      </div>
      <ModalOverlay
        isOpen={confirmation !== null}
        onClose={() => setConfirmation(null)}
        ariaLabel={confirmation?.kind === 'delete' ? t('确认删除预设') : t('确认覆盖当前预设')}
        className="w-[min(420px,calc(100vw-32px))] p-5"
        motionPreset="quick"
      >
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${confirmation?.kind === 'delete' ? 'bg-danger/10 text-danger' : 'bg-brand/10 text-brand'}`}>
            <Icon icon={confirmation?.kind === 'delete' ? 'lucide:trash-2' : 'lucide:refresh-cw'} width="19" height="19" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-canvas-text">{confirmation?.kind === 'delete' ? t('确认删除预设') : t('确认覆盖当前预设')}</h3>
            <p className="mt-2 text-xs leading-5 text-canvas-text-secondary">
              {confirmation?.kind === 'delete'
                ? t('确定要删除预设“{name}”吗？此操作无法恢复。', { name: confirmation.theme.name })
                : t('将当前外观配置覆盖到预设“{name}”，原配置会被替换。', { name: confirmation?.theme.name ?? '' })}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <AnimatedButton type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setConfirmation(null)}>{t('取消')}</AnimatedButton>
          <AnimatedButton type="button" className={`ui-btn ui-btn--sm ${confirmation?.kind === 'delete' ? 'ui-btn--danger' : 'ui-btn--primary'}`} onClick={() => void confirmPresetAction()}>
            {confirmation?.kind === 'delete' ? t('确认删除') : t('确认覆盖')}
          </AnimatedButton>
        </div>
      </ModalOverlay>
    </div>
  );
}
