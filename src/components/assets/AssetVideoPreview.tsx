import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import type { HistoryRecord } from '../../services/indexedDbService';
import { describeAssetVideoHistory, loadAssetVideoHistory } from '../../services/assetVideoDetails';
import { copyText } from '../../services/clipboardService';
import { formatSize } from '../../utils/assetFormat';
import { releaseViewportVideoElement } from '../shared/viewportVideoResource';
import ModalOverlay from '../shared/ModalOverlay';

function timeLabel(seconds: number): string {
  const value = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function seekPreview(video: HTMLVideoElement | null, time: number) {
  if (video && video.readyState > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(time, video.duration);
}

function VideoSeekPreview({ src, time }: { src: string; time: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { seekPreview(videoRef.current, time); }, [time, src]);
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.src = src;
    return () => releaseViewportVideoElement(video);
  }, [src]);
  return <div className="asset-video-seek-preview" aria-hidden="true">
    {failed ? <span className="text-xs text-canvas-text-muted">预览不可用</span>
      : <video ref={videoRef} src={src} muted playsInline preload="metadata" tabIndex={-1} onLoadedMetadata={(event) => seekPreview(event.currentTarget, time)} onError={() => setFailed(true)} />}
    <span className="asset-video-seek-time">{timeLabel(time)}</span>
  </div>;
}

/** 与图片预览共用布局样式；只在用户打开时挂载播放器和读取生成历史。 */
export default function AssetVideoPreview({ src, querySrc, filePath, poster, name, size, projectId, historyRecord, unavailable, onClose, onSourceError }: {
  src?: string; querySrc?: string; filePath?: string; poster?: string; name: string; size?: number;
  projectId?: string; historyRecord?: HistoryRecord; unavailable: boolean; onClose: () => void; onSourceError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const progressInputRef = useRef<HTMLInputElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [menu, setMenu] = useState<'speed' | 'time' | null>(null);
  const [remainingTime, setRemainingTime] = useState(false);
  const [hover, setHover] = useState<{ ratio: number; time: number } | null>(null);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ src: string; width: number; height: number; duration: number } | null>(null);
  const [metadata, setMetadata] = useState<{ key: string; record: HistoryRecord | null; error: boolean } | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ key: string; message: string } | null>(null);
  const key = JSON.stringify([filePath, querySrc, projectId, historyRecord?.id, retry]);
  const current = metadata?.key === key ? metadata : null;
  const history = historyRecord ?? current?.record;
  const loading = !historyRecord && !current;
  const details = history ? describeAssetVideoHistory(history) : [];
  const mediaInfo = dimensions?.src === src ? dimensions : null;
  const duration = mediaInfo && Number.isFinite(mediaInfo.duration) && mediaInfo.duration > 0 ? mediaInfo.duration : 0;
  const played = duration ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
  const buffered = duration ? Math.min(100, Math.max(played, bufferedEnd / duration * 100)) : 0;
  const silent = muted || volume === 0;
  const updateBuffer = (video: HTMLVideoElement) => {
    let end = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime) end = video.buffered.end(i);
    }
    setBufferedEnd(end);
  };
  const play = () => {
    const video = videoRef.current; if (!video || !src) return;
    if (video.error || !video.getAttribute('src')) { video.src = src; video.load(); }
    void video.play().catch(() => { if (videoRef.current === video && video.getAttribute('src') === src) setBlocked(true); });
  };
  const fullscreen = () => {
    const operation = document.fullscreenElement ? document.exitFullscreen?.() : stageRef.current?.requestFullscreen?.();
    if (operation) void operation.catch(() => setFullscreenError(true));
    else setFullscreenError(true);
  };

  useEffect(() => {
    if (historyRecord) return;
    const controller = new AbortController();
    void loadAssetVideoHistory(filePath, querySrc, projectId, controller.signal).then((record) => {
      if (!controller.signal.aborted) setMetadata({ key, record, error: false });
    }, () => { if (!controller.signal.aborted) setMetadata({ key, record: null, error: true }); });
    return () => controller.abort();
  }, [key, filePath, querySrc, projectId, historyRecord]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let current = true;
    // 清理移除 src，StrictMode 重放时必须重新恢复。
    video.src = src;
    void video.play().catch(() => { if (current) setBlocked(true); });
    return () => { current = false; releaseViewportVideoElement(video); };
  }, [src]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      // 让浏览器退出播放器全屏，但阻止宿主模态框把同一次 Esc 当作关闭。
      if (document.fullscreenElement) { event.stopImmediatePropagation(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (menu) { setMenu(null); controlsRef.current?.querySelector<HTMLButtonElement>(`[data-video-${menu}-trigger]`)?.focus(); }
      else onClose();
    };
    window.addEventListener('keydown', keyboard, true);
    return () => window.removeEventListener('keydown', keyboard, true);
  }, [onClose, menu]);

  useEffect(() => {
    const video = videoRef.current;
    if (!playing || !video || !src) return;
    let frame: number;
    const refresh = () => {
      if (video.paused || video.ended) return;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const position = Math.min(video.duration, Math.max(0, video.currentTime));
        // 仅刷新进度几何，信息面板与时间文字保持媒体事件的更新频率。
        progressRef.current?.style.setProperty('--video-played', `${position / video.duration * 100}%`);
        if (progressInputRef.current) progressInputRef.current.value = String(position);
      }
      frame = requestAnimationFrame(refresh);
    };
    frame = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(frame);
  }, [playing, src]);

  useEffect(() => {
    if (!menu) return;
    popupRef.current?.querySelector<HTMLElement>(menu === 'speed' ? 'input' : '[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      // 按钮等交互目标先完成自己的点击；例如关闭预览不应被收起菜单打断。
      if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) return;
      if (!controlsRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [menu]);

  return <ModalOverlay isOpen onClose={onClose} ariaLabel="视频与生成信息" className="asset-image-preview"
    zIndex={360} motionPreset="quick" backdropBlur={false} closeOnBackdrop={false}>
    {poster && <img className="asset-image-preview-backdrop" src={poster} alt="" aria-hidden="true" />}
    <div className="asset-image-preview-layout">
      <div ref={stageRef} className="asset-image-preview-stage asset-video-preview-stage">
        <div className="asset-video-preview-view">
        {src ? <>
          <video ref={videoRef} src={src} poster={poster} playsInline preload="auto" aria-label={`${name} 视频播放`}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDimensions({ src, width: video.videoWidth, height: video.videoHeight, duration: video.duration });
              updateBuffer(video);
            }}
            onTimeUpdate={(event) => { setTime(event.currentTarget.currentTime); updateBuffer(event.currentTarget); }}
            onProgress={(event) => updateBuffer(event.currentTarget)}
            onPlay={() => { setPlaying(true); setBlocked(false); setFailed(null); }}
            onPause={(event) => { setPlaying(false); setTime(event.currentTarget.currentTime); }}
            onEnded={(event) => { setPlaying(false); setTime(event.currentTarget.currentTime); }}
            onSeeking={(event) => setTime(event.currentTarget.currentTime)}
            onSeeked={(event) => setTime(event.currentTarget.currentTime)}
            onVolumeChange={(event) => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume); }}
            onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
            onError={() => { setPlaying(false); setFailed(src); setBlocked(true); onSourceError(); }} />
          {(blocked || failed === src) && <button type="button" className="ui-btn asset-video-preview-retry" onClick={play}>{failed === src ? '视频加载失败，点击重试' : '点击播放'}</button>}
        </> : <p role="status" className="text-sm text-canvas-text-muted">{unavailable ? '视频不可用' : '加载视频…'}</p>}
        </div>
        <div ref={controlsRef} className="asset-video-preview-controls p-3" aria-label="视频播放控件">
          <div ref={progressRef} className="asset-video-preview-progress" style={{ '--video-played': `${played}%`, '--video-buffered': `${buffered}%` } as CSSProperties}
            onPointerMove={(event) => {
              if (!duration || !src || event.pointerType === 'touch') return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
              setHover({ ratio, time: Math.round(ratio * duration * 5) / 5 });
            }} onPointerLeave={() => setHover(null)}>
          <div className="asset-video-progress-track" aria-hidden="true"><span className="asset-video-progress-empty" /><span className="asset-video-progress-buffer" /><span className="asset-video-progress-played" /></div>
          <span className="asset-video-progress-marker" aria-hidden="true" />
          <input ref={progressInputRef} type="range" className="asset-video-range-hit" min={0} max={duration || 1} step={0.01} value={Math.min(time, duration)} disabled={!duration}
            aria-label="播放进度" aria-valuetext={`${timeLabel(time)} / ${timeLabel(duration)}`}
            onChange={(event) => { const video = videoRef.current; if (video && duration) { video.currentTime = Number(event.currentTarget.value); setTime(video.currentTime); } }} />
          {hover && src && <div className="asset-video-seek-anchor" style={{ '--video-hover': `${hover.ratio * 100}%` } as CSSProperties}><VideoSeekPreview key={src} src={src} time={hover.time} /></div>}
          </div>
          <div className="asset-video-control-row">
            <div className="asset-video-control-left">
              <button type="button" className="ui-btn ui-btn--ghost asset-video-control" aria-label={playing ? '暂停视频' : '播放视频'} disabled={!src}
                onClick={() => { if (videoRef.current?.paused) play(); else videoRef.current?.pause(); }}><Icon icon={playing ? 'lucide:pause' : 'lucide:play'} className="asset-video-play-icon" aria-hidden="true" /></button>
              <div className="asset-video-control-anchor">
                <button type="button" className="ui-btn ui-btn--ghost asset-video-control asset-video-speed-trigger" data-video-speed-trigger
                  aria-label="播放速度" aria-haspopup="dialog" aria-expanded={menu === 'speed'} disabled={!src} onClick={() => setMenu(menu === 'speed' ? null : 'speed')}>{rate}×</button>
                {menu === 'speed' && <div ref={popupRef} className="ui-menu ui-menu--up asset-video-speed-popover p-3" role="dialog" aria-label="播放速度设置">
                  <h2 className="pb-3 text-sm font-semibold text-canvas-text">播放速度</h2>
                  <div className="asset-video-speed-options">{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => <button type="button" key={value}
                    className={`ui-btn ui-btn--ghost asset-video-speed-option${rate === value ? ' is-selected' : ''}`} aria-label={`${value} 倍速`} aria-pressed={rate === value}
                    onClick={() => { if (videoRef.current) videoRef.current.playbackRate = value; }}>{value}</button>)}</div>
                  <div className="asset-video-value-track" style={{ '--video-value': `${(rate - 0.25) / 1.75 * 100}%` } as CSSProperties}><span aria-hidden="true" className="asset-video-value-fill" /><span aria-hidden="true" className="asset-video-value-marker" />
                    <input className="asset-video-range-hit" type="range" min={0.25} max={2} step={0.25} value={rate} aria-label="调整播放速度"
                      onChange={(event) => { if (videoRef.current) videoRef.current.playbackRate = Number(event.currentTarget.value); }} />
                  </div>
                </div>}
              </div>
              <div className="asset-video-volume">
                <button type="button" className="ui-btn ui-btn--ghost asset-video-control" aria-label={silent ? '取消静音' : '静音视频'} disabled={!src}
                  onClick={() => { const video = videoRef.current; if (!video) return; if (silent) { if (!video.volume) video.volume = 1; video.muted = false; } else video.muted = true; }}><Icon icon={silent ? 'lucide:volume-x' : 'lucide:volume-2'} aria-hidden="true" /></button>
                <div className="asset-video-value-track asset-video-volume-track" style={{ '--video-value': `${silent ? 0 : volume * 100}%` } as CSSProperties}><span aria-hidden="true" className="asset-video-value-fill" /><span aria-hidden="true" className="asset-video-value-marker" />
                  <input className="asset-video-range-hit" type="range" min={0} max={1} step={0.01} value={silent ? 0 : volume} aria-label="视频音量" disabled={!src}
                    onChange={(event) => { const video = videoRef.current; if (video) { video.volume = Number(event.currentTarget.value); video.muted = video.volume === 0; } }} />
                </div>
              </div>
            </div>
            <div className="asset-video-time-format asset-video-control-anchor">
              <time className="text-sm font-medium tabular-nums text-canvas-text">{remainingTime ? `-${timeLabel(duration - time)}` : timeLabel(time)} / {timeLabel(duration)}</time>
              <button type="button" className="ui-btn ui-btn--ghost asset-video-control asset-video-time-trigger" data-video-time-trigger aria-label="时间显示格式" aria-haspopup="menu" aria-expanded={menu === 'time'} onClick={() => setMenu(menu === 'time' ? null : 'time')}><Icon icon="lucide:chevron-down" aria-hidden="true" /></button>
              {menu === 'time' && <div ref={popupRef} className="ui-menu ui-menu--up asset-video-time-popover" role="menu" aria-label="时间显示格式选项"
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
                  const index = options.indexOf(event.target as HTMLButtonElement);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                  event.preventDefault(); event.stopPropagation(); options[next]?.focus();
                }}>
                {[false, true].map((value) => <button type="button" key={String(value)} className={`ui-menu__item${remainingTime === value ? ' is-active' : ''}`} role="menuitemradio" aria-checked={remainingTime === value}
                  onClick={() => { setRemainingTime(value); setMenu(null); controlsRef.current?.querySelector<HTMLButtonElement>('[data-video-time-trigger]')?.focus(); }}>{value ? '剩余时间 / 总时长' : '已播放 / 总时长'}</button>)}
              </div>}
            </div>
            <div className="flex justify-end"><button type="button" className="ui-btn ui-btn--ghost asset-video-control asset-video-fullscreen-control" aria-label="全屏播放视频" onClick={fullscreen}><Icon icon="lucide:expand" aria-hidden="true" /></button></div>
          </div>
          {fullscreenError && <p role="status" className="pt-2 text-xs text-canvas-text-secondary">此窗口暂不支持播放器全屏</p>}
        </div>
      </div>
      <aside className="asset-image-preview-info" aria-label="视频提示词和参数">
        <header className="flex shrink-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-hover text-canvas-text-secondary"><Icon icon="lucide:film" className="h-4 w-4" aria-hidden="true" /></div>
          <h1 className="min-w-0 flex-1 break-words text-sm font-semibold text-canvas-text">{name}</h1>
          <button type="button" className="ui-close-btn" aria-label="关闭视频预览" title="关闭（Esc）" onClick={onClose}><Icon icon="lucide:x" aria-hidden="true" /></button>
        </header>
        <div className="asset-image-preview-info-content">
          <section className="ui-card asset-image-preview-section p-3" aria-label="提示词">
            <div className="flex items-center justify-between gap-2 pb-2"><h2 className="flex items-center gap-2 text-xs font-medium text-canvas-text-secondary"><Icon icon="lucide:sparkles" className="h-3.5 w-3.5" aria-hidden="true" />提示词</h2>
              <button type="button" className="ui-btn ui-btn--sm" disabled={!history?.prompt?.trim()} onClick={() => {
                if (!history?.prompt) return;
                void copyText(history.prompt).then((copied) => setCopyStatus({ key, message: copied ? '提示词已复制' : '复制失败，请重试' }));
              }}><Icon icon="lucide:copy" aria-hidden="true" />复制提示词</button>
            </div>
            {loading ? <p role="status" className="text-xs text-canvas-text-muted">正在读取生成信息…</p>
              : current?.error ? <div role="alert" className="space-y-2 text-xs text-canvas-text-secondary"><p>生成信息读取失败</p><button type="button" className="ui-btn ui-btn--sm" onClick={() => setRetry((value) => value + 1)}>重试读取</button></div>
                : <p className="asset-image-preview-prompt whitespace-pre-wrap break-words text-sm leading-relaxed text-canvas-text">{history?.prompt?.trim() ? history.prompt : history ? '此记录未保存提示词' : '暂无生成信息'}</p>}
            {copyStatus?.key === key && <p role="status" className="pt-2 text-xs text-canvas-text-secondary">{copyStatus.message}</p>}
          </section>
          <section className="asset-image-preview-parameters" aria-label="生成参数">
            <h2 className="flex items-center gap-2 pb-3 text-xs font-medium text-canvas-text-secondary"><Icon icon="lucide:info" className="h-3.5 w-3.5" aria-hidden="true" />参数与文件信息</h2>
            <dl className="ui-card asset-image-preview-section space-y-3 p-3 text-sm">
              {details.map(({ label, value }) => <div className="flex items-start justify-between gap-3" key={label}><dt className="shrink-0 text-canvas-text-muted">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-right text-canvas-text">{value}</dd></div>)}
              <div className="flex justify-between gap-3"><dt className="text-canvas-text-muted">视频尺寸</dt><dd className="text-canvas-text">{mediaInfo && mediaInfo.width > 0 && mediaInfo.height > 0 ? `${mediaInfo.width} × ${mediaInfo.height}` : failed === src || unavailable && !src ? '无法读取' : '正在读取…'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-canvas-text-muted">视频时长</dt><dd className="text-canvas-text">{mediaInfo && Number.isFinite(mediaInfo.duration) && mediaInfo.duration > 0 ? `${Number(mediaInfo.duration.toFixed(2))} 秒` : '未知'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-canvas-text-muted">文件大小</dt><dd className="text-canvas-text">{size && size > 0 ? formatSize(size) : '未知'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-canvas-text-muted">来源</dt><dd className="text-canvas-text">{filePath ? '本地文件' : '媒体资源'}</dd></div>
            </dl>
          </section>
        </div>
        <footer className="asset-image-preview-footer"><p className="text-center text-xs text-canvas-text-muted">Esc 关闭 · 底部可调整进度、速度和声音</p></footer>
      </aside>
    </div>
  </ModalOverlay>;
}
