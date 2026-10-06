import { findImageHistoryByReferences, type HistoryRecord } from './indexedDbService';
import type { AssetFileEntry } from './fileService';
import type { AssetImageLoadedDetails } from '../types/assetImage';
import { findSavedAssetImage, identifyAssetImage, resolveAssetImageReferences } from './fs/assetImageMetadata';
import { isTauriEnv } from './fs/core';

/** 仅在打开预览后读取，精确匹配图片身份；查询不产生任何持久化写入。 */
export function loadAssetImageHistory(file: AssetFileEntry, projectId?: string, signal?: AbortSignal): Promise<HistoryRecord | null> {
  return findImageHistoryByReferences([file.path, ...(file.assetUrl ? [file.assetUrl] : [])], projectId, signal);
}

export async function loadAssetImageDetails(file: AssetFileEntry, projectId?: string, signal?: AbortSignal): Promise<AssetImageLoadedDetails & { history: HistoryRecord | null }> {
  const history = await loadAssetImageHistory(file, projectId, signal);
  if (!isTauriEnv()) return { identity: null, record: null, references: [], history, contentChanged: false, warning: '编辑和添加参考图仅支持桌面应用' };
  const identity = await identifyAssetImage(file, projectId, signal);
  const saved = await findSavedAssetImage(identity, signal);
  const references = saved.record ? await resolveAssetImageReferences(saved.record.references, signal) : [];
  return { identity, record: saved.record, references, contentChanged: saved.contentChanged,
    history: saved.contentChanged && !saved.record ? null : history,
    warning: saved.ambiguous ? '找到多个相同内容的信息记录，未自动关联' : saved.contentChanged && !saved.record ? '原图内容已变化，旧提示词与参考图仍保留' : null };
}

const IMAGE_PARAMETERS: ReadonlyArray<readonly [string, string]> = [
  ['imageSize', '生成尺寸'], ['aspectRatio', '宽高比'], ['resolution', '分辨率'],
  ['quality', '质量'], ['seed', '随机种子'], ['steps', '采样步数'],
  ['guidanceScale', '引导强度'], ['cfgScale', '提示词强度'], ['sampler', '采样器'],
  ['scheduler', '调度器'], ['negativePrompt', '反向提示词'],
];

/** 只展示已保存的参数白名单，不显示凭据、路径或任意嵌套对象。 */
export function describeAssetImageHistory(history: HistoryRecord): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = [];
  if (history.model) details.push({ label: '模型', value: history.model });
  if (history.provider) details.push({ label: '供应商', value: history.provider });
  for (const [key, label] of IMAGE_PARAMETERS) {
    const value = history.params?.[key];
    if (typeof value === 'string' && value.trim() || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') {
      details.push({ label, value: String(value) });
    }
  }
  if (Number.isFinite(history.timestamp) && history.timestamp > 0) {
    details.push({ label: '生成时间', value: new Date(history.timestamp).toLocaleString() });
  }
  return details;
}
