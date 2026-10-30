import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n';
import type { CinemaLens, CinematographySettings } from '../../types/cinematography';
import { CINEMA_CAMERAS, CINEMA_EFFECTS, CINEMA_FILM_STOCKS, CINEMA_LENSES } from '../../data/cinematography';
import { buildGenerationCameraPrompt, cinemaMinT, cinematographyCompatibility, CINEMA_FORMAT_LABELS, CINEMA_T_STOPS, resolveCinematography, supportsCinemaFocal } from '../../utils/cinematography';
import ModalOverlay from '../shared/ModalOverlay';
import PopupCloseButton from '../shared/PopupCloseButton';
import Select, { type SelectOption } from '../shared/Select';

const FIELD_KEYS = ['cameraId', 'lensId', 'recordingFormat', 'focalLengthMm', 'apertureT', 'effectId', 'depthOfField', 'focus', 'focusDistanceM', 'flare', 'filmStockId', 'grain', 'shutterEffect'] as const;
const FIELD_OPTIONS: Partial<Record<keyof CinematographySettings, readonly [string, string][]>> = {
  depthOfField: [['shallow', '浅景深'], ['balanced', '均衡景深'], ['deep', '深景深']],
  focus: [['eyes', '人物眼睛'], ['foreground', '前景主体'], ['background', '远景主体'], ['rack', '前后景焦点转移']],
  flare: [['none', '克制耀光'], ['subtle', '轻微耀光'], ['strong', '明显耀光']],
  grain: [['none', '不添加颗粒'], ['subtle', '轻微颗粒'], ['visible', '明显颗粒']],
  shutterEffect: [['natural', '自然运动模糊'], ['freeze', '清脆冻结动作'], ['motion', '运动拖影'], ['light-trails', '长曝光光轨']],
};

export default function ShotlistCinematographyDialog({ nodeId, rowId, projectId, onClose }: {
  nodeId: string; rowId?: string; projectId: string | undefined; onClose: () => void;
}) {
  const t = useT();
  const prefix = useId();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const node = useAppStore((state) => (state.currentProjectId ?? undefined) === projectId
    ? state.nodes.find((item) => item.id === nodeId && item.data.type === 'ai-shotlist') : undefined);
  const ready = useAppStore((state) => state.projectLoadStatus === 'ready' && !state.isCreatingProject
    && !state.isReturningToStartPage && state.switchingProjectName === null);
  const row = rowId ? node?.data.shotlistRows?.find((item) => item.id === rowId) : undefined;
  const defaults = node?.data.shotlistCinematography;
  const value = rowId ? row?.cinematography : defaults;
  const resolved = resolveCinematography(rowId ? defaults : undefined, value);
  const camera = CINEMA_CAMERAS.find((item) => item.id === resolved.cameraId);
  const lens = CINEMA_LENSES.find((item) => item.id === resolved.lensId);
  const recommended = (item: CinemaLens) => !!camera && item.mounts.some((mount) => mount === camera.mount || camera.adapters.includes(mount))
    && (item.coverage === 'ff' || ['s16', 's35'].includes(resolved.recordingFormat ?? camera.formats[0]));
  const lenses = [...CINEMA_LENSES].sort((left, right) => Number(recommended(right)) - Number(recommended(left)));
  const disabled = !ready || !node || node.data.status === 'loading' || (!!rowId && !row);
  const title = rowId ? `${t('摄影设置')} · ${t('镜头 {number}', { number: row?.shotNo || rowId })}` : t('整表摄影默认');
  const close = () => { active.current = false; onClose(); };

  const write = (change: (current: CinematographySettings | undefined, table: CinematographySettings | undefined) => CinematographySettings | undefined) => {
    const state = useAppStore.getState();
    const latest = state.nodes.find((item) => item.id === nodeId && item.data.type === 'ai-shotlist');
    if (!active.current || !latest || latest.data.status === 'loading' || (state.currentProjectId ?? undefined) !== projectId
      || state.projectLoadStatus !== 'ready' || state.isCreatingProject || state.isReturningToStartPage || state.switchingProjectName !== null) return;
    const target = rowId ? latest.data.shotlistRows?.find((item) => item.id === rowId) : undefined;
    if (rowId && !target) return;
    const old = rowId ? target?.cinematography : latest.data.shotlistCinematography;
    const next = change(old, rowId ? latest.data.shotlistCinematography : undefined);
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    state.updateNodeData(nodeId, rowId ? { shotlistRows: latest.data.shotlistRows!.map((item) => item.id === rowId ? { ...item, cinematography: next } : item) }
      : { shotlistCinematography: next });
    state.commitToHistory();
  };
  const update = <K extends keyof CinematographySettings>(key: K, nextValue: CinematographySettings[K]) => write((current, table) => {
    const next = { ...current };
    if (nextValue === undefined) delete next[key]; else Object.assign(next, { [key]: nextValue });
    let effective = resolveCinematography(table, next);
    if (key === 'cameraId' && nextValue !== undefined) {
      const selected = CINEMA_CAMERAS.find((item) => item.id === effective.cameraId);
      if (selected && effective.recordingFormat && !selected.formats.includes(effective.recordingFormat)) next.recordingFormat = null;
    }
    if (key === 'lensId' && nextValue !== undefined) {
      next.effectId = null;
      const selected = CINEMA_LENSES.find((item) => item.id === effective.lensId);
      if (selected && effective.focalLengthMm != null && !supportsCinemaFocal(selected, effective.focalLengthMm)) {
        next.focalLengthMm = selected.focalLengths.includes(35) ? 35 : selected.focalLengths[0];
      }
    }
    effective = resolveCinematography(table, next);
    if (key === 'lensId' || key === 'focalLengthMm') {
      const selected = CINEMA_LENSES.find((item) => item.id === effective.lensId);
      const minT = cinemaMinT(selected, effective.focalLengthMm);
      if (effective.apertureT != null && effective.apertureT < minT) next.apertureT = minT;
    }
    return Object.keys(next).length ? next : undefined;
  });
  const richLabel = (name: string, use: string, detail = '') => <span className="block min-w-0 text-left">
    <span className="block">{name}{detail ? ` · ${detail}` : ''}</span>
    <span data-cinema-use="" className="block max-w-md whitespace-normal pt-1 text-xs leading-relaxed text-canvas-text-secondary">{t(use)}</span>
  </span>;
  const display = (key: keyof CinematographySettings, item: unknown): string => {
    if (item == null) return t('自动');
    if (key === 'cameraId') return CINEMA_CAMERAS.find((entry) => entry.id === item)?.name ?? String(item);
    if (key === 'lensId') return CINEMA_LENSES.find((entry) => entry.id === item)?.name ?? String(item);
    if (key === 'effectId') return t(CINEMA_EFFECTS.find((entry) => entry.id === item)?.name ?? '自动');
    if (key === 'filmStockId') return CINEMA_FILM_STOCKS.find((entry) => entry.id === item)?.name ?? String(item);
    if (key === 'focalLengthMm') return `${item}mm`;
    if (key === 'apertureT') return `T${item}`;
    if (key === 'focusDistanceM') return `${item}m`;
    if (key === 'recordingFormat') return CINEMA_FORMAT_LABELS[item as keyof typeof CINEMA_FORMAT_LABELS] ?? String(item);
    const label = FIELD_OPTIONS[key]?.find(([entry]) => entry === item)?.[1];
    return label ? t(label) : String(item);
  };
  const options = (key: keyof CinematographySettings, items: SelectOption[]): SelectOption[] => {
    const selected = value?.[key];
    return [
      ...(rowId ? [{ value: 'inherit', label: `${t('跟随整表')} · ${display(key, defaults?.[key])}` }] : []),
      { value: '', label: t('自动') }, ...items,
      ...(selected != null && !items.some((item) => item.value === String(selected))
        ? [{ value: String(selected), label: `${display(key, selected)} · ${t('请核对当前选项')}` }] : []),
    ];
  };
  const select = <K extends keyof CinematographySettings>(key: K, label: string, items: SelectOption[], hint?: ReactNode) => <div className="min-w-0 space-y-1">
    <label htmlFor={`${prefix}-${key}`} className="block text-xs text-canvas-text-secondary">{t(label)}</label>
    <Select id={`${prefix}-${key}`} aria-label={t(label)} value={value?.[key] === undefined && rowId ? 'inherit' : String(value?.[key] ?? '')}
      options={options(key, items)} disabled={disabled} triggerClassName="[&_[data-cinema-use]]:hidden"
      onChange={(item) => {
        if (key === 'effectId' && item && item !== 'inherit') {
          const preset = CINEMA_EFFECTS.find((entry) => entry.id === item);
          if (preset) write(() => ({ ...Object.fromEntries(FIELD_KEYS.map((field) => [field, null])), ...preset.settings, effectId: preset.id }));
          return;
        }
        update(key, (item === 'inherit' ? undefined : item === '' ? null : ['focalLengthMm', 'apertureT', 'focusDistanceM'].includes(key) ? Number(item) : item) as CinematographySettings[K]);
      }} />
    {hint && <p className="text-xs leading-relaxed text-canvas-text-muted">{hint}</p>}
  </div>;
  const namedOptions = (items: readonly [string, string][]) => items.map(([key, label]) => ({ value: key, label: t(label) }));
  const warnings = cinematographyCompatibility(resolved);
  const prompt = buildGenerationCameraPrompt(undefined, resolved);
  const minT = cinemaMinT(lens, resolved.focalLengthMm);
  return <ModalOverlay isOpen onClose={close} ariaLabel={title} zIndex={410} motionPreset="quick" closeOnBackdrop={false}>
    <div className="ui-card flex max-h-[calc(100dvh-24px)] w-[min(960px,calc(100vw-24px))] flex-col p-0 nodrag nowheel">
      <header className="ui-card__header flex items-start gap-2">
        <Icon icon="lucide:camera" className="mt-1 h-5 w-5 shrink-0 text-canvas-text-secondary" aria-hidden="true" />
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{title}</h2>
          <p className="pt-1 text-xs leading-relaxed text-canvas-text-secondary">{t(rowId ? '逐项选择跟随整表或覆盖；自动表示此镜不指定该项。' : '作为本表所有镜头的摄影基础，单镜可以逐项覆盖。')}</p></div>
        <PopupCloseButton onClick={close} />
      </header>
      <div className="grid min-h-0 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
        <div className="space-y-3">
          {disabled && <p className="ui-alert ui-alert--warning" role="status">{t('当前镜头不可编辑，请关闭后重新打开')}</p>}
          {select('effectId', '效果预设', CINEMA_EFFECTS.map((item) => ({ value: item.id, label: richLabel(t(item.name), item.use) })), t('选择预设会填入推荐器材与效果，可继续逐项调整。'))}
          {select('cameraId', '摄影机', CINEMA_CAMERAS.map((item) => ({ value: item.id, label: richLabel(item.name, item.use, item.formats.map((format) => CINEMA_FORMAT_LABELS[format]).join(' / ')) })), camera && t(camera.use))}
          {select('lensId', '镜头系列', lenses.map((item) => ({ value: item.id, label: richLabel(item.name, item.use, `${item.coverage === 'ff' ? 'Full Frame' : 'Super 35'} · ${item.mounts.join('/')}${recommended(item) ? ` · ${t('推荐参考')}` : ''}`) })), lens && t(lens.use))}
          <div className="grid grid-cols-2 gap-3">
            {select('focalLengthMm', '焦段', (lens?.focalLengths ?? [15, 24, 35, 50, 85, 100, 200]).map((item) => ({ value: String(item), label: `${item}mm` })), t('焦段与记录画幅共同影响视角。'))}
            {select('apertureT', '拍摄光圈', CINEMA_T_STOPS.filter((item) => item >= minT).map((item) => ({ value: String(item), label: `T${item}` })), t('T 值为透光档位；虚化还取决于拍摄距离。'))}
          </div>
          <details className="ui-card p-3"><summary className="cursor-pointer text-xs font-medium">{t('更多摄影参数')}</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {select('recordingFormat', '记录画幅', (camera?.formats ?? ['s16', 's35', 'ff', 'lf', 'vv'] as const).map((item) => ({ value: item, label: CINEMA_FORMAT_LABELS[item] })))}
              {select('depthOfField', '景深', namedOptions(FIELD_OPTIONS.depthOfField!))}
              {select('focus', '对焦主体', namedOptions(FIELD_OPTIONS.focus!))}
              {select('focusDistanceM', '对焦距离参考', [0.5, 1, 2, 3, 5, 10, 20, 50].map((item) => ({ value: String(item), label: `${item}m` })))}
              {select('flare', '耀光', namedOptions(FIELD_OPTIONS.flare!))}
              {select('grain', '颗粒', namedOptions(FIELD_OPTIONS.grain!))}
              {select('filmStockId', '胶片风格', CINEMA_FILM_STOCKS.map((item) => ({ value: item.id, label: richLabel(item.name, item.use) })))}
              {select('shutterEffect', '快门表现', namedOptions(FIELD_OPTIONS.shutterEffect!))}
            </div>
          </details>
        </div>
        <aside className="min-w-0 space-y-3" aria-label={t('摄影提示词预览')}>
          <section className="ui-card p-3"><h3 className="text-xs font-medium">{t('摄影提示词预览')}</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-canvas-text">{prompt || t('自动，由模型决定摄影表现')}</p>
            <p className="mt-3 text-xs leading-relaxed text-canvas-text-muted">{t('生成时自动加入提示词；机身名称不改变实际输出分辨率、比例或帧率。')}</p>
          </section>
          <section className="ui-card space-y-2 p-3" aria-label={t('搭配提示')}><h3 className="text-xs font-medium">{t('搭配提示')}</h3>
            {warnings.map((item) => <p key={item} className="ui-alert ui-alert--warning text-xs">{t(item)}</p>)}
            <p className="text-xs leading-relaxed text-canvas-text-muted">{t('用途是创作建议；实拍需按具体焦段、卡口版本与记录窗口复核覆盖。')}</p>
            <p className="text-xs leading-relaxed text-canvas-text-muted">{t('已有生成节点显式设置的焦段、光圈和快门优先；单镜预览显示分镜设定。')}</p>
          </section>
        </aside>
      </div>
      <footer className="ui-card__footer flex flex-wrap justify-between gap-2">
        <button type="button" className="ui-btn ui-btn--ghost" disabled={disabled} onClick={() => write(() => undefined)}>{t(rowId ? '恢复整表摄影' : '清除整表摄影')}</button>
        <span className="self-center text-xs text-canvas-text-muted">{t('编辑后自动保存')}</span>
        <button type="button" className="ui-btn ui-btn--primary" onClick={close}>{t('完成')}</button>
      </footer>
    </div>
  </ModalOverlay>;
}
