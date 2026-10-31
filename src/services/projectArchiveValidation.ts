/** 外部旧归档与历史记录的可移植边界；不接受运行任务、授权或本机路径。 */
import type { ProjectSaveData } from './storageService';
import type { ProjectArchiveChatPayload } from './projectTransferService';
import type { ProjectExchangeSnapshot, ProjectExchangeState } from '../types/projectExchange';
import { safeExchangePath, type ArchiveAssetDigest } from './projectExchangeDomain';

const privateFields = new Set(['filepath', 'imagefilepath', 'directorcapturefilepaths', 'taskid', 'agenttaskid',
  'apikey', 'apikeyref', 'accesskeyid', 'secretaccesskey', 'sessiontoken', 'token', 'accesstoken', 'refreshtoken',
  'password', 'authorization', 'abortcontroller', 'volcenginebinding', 'polltaskid', 'requestid',
  'videotaskstate', 'mediataskstate', 'mediataskstage', 'runninghubstage', 'workflowapistage', 'generationstartedat']);

export function sanitizeLegacyArchiveProject(record: ProjectSaveData): ProjectSaveData {
  let count = 0;
  const visit = (value: unknown, key = '', depth = 0): unknown => {
    if (++count > 1_000_000 || depth > 32) throw new Error('项目记录嵌套或数量超过上限');
    if (typeof value === 'string') {
      if (['relativePath', 'imageRelativePath', 'directorCaptureRelativePaths'].includes(key)) {
        if (value) safeExchangePath(value);
      } else if (/(?:paths?|directory|folder)$/i.test(key) && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value)) {
        throw new Error('旧项目包包含不安全的本机路径');
      }
      if (['url', 'imageUrl', 'videoUrl', 'audioUrl', 'output', 'directorCaptureUrls'].includes(key)
        && /^(?:file:|asset:|blob:|https?:\/\/(?:asset\.localhost|tauri\.localhost)|[a-z]:[\\/]|\\\\)/i.test(value)) return undefined;
      if (key === 'status' && ['loading', 'generating', 'running', 'pending', 'polling'].includes(value)) return 'idle';
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, key, depth + 1)).filter((item) => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).flatMap(([field, item]) => {
      const normalized = field.replace(/[_-]/g, '').toLowerCase();
      if (['proto', 'prototype', 'constructor'].includes(normalized)) throw new Error('项目记录包含无效对象字段');
      if (privateFields.has(normalized)) return [];
      const next = visit(item, field, depth + 1);
      return next === undefined ? [] : [[field, next]];
    }));
  };
  return visit(record) as ProjectSaveData;
}

/** 历史只携带可阅读文本和来源关联，工具参数、文件授权、模型配置不进入归档。 */
export function portableArchiveChat(payload: ProjectArchiveChatPayload): ProjectArchiveChatPayload {
  const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
  const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const identity = (value: unknown): string => {
    if (typeof value !== 'string' || !value || value.length > 256) throw new Error('项目包历史记录身份无效');
    return value;
  };
  const origin = (value: { archiveOriginId?: string }) => value.archiveOriginId && /^[a-f0-9]{64}$/.test(value.archiveOriginId)
    ? { archiveOriginId: value.archiveOriginId } : {};
  const seen = (rows: Array<{ id: string }>) => {
    if (rows.length > 100_000 || new Set(rows.map((row) => identity(row?.id))).size !== rows.length) throw new Error('项目包历史记录重复或超限');
  };
  seen(payload.conversations); seen(payload.messages); seen(payload.memories);
  const counts = new Map<string, number>();
  for (const message of payload.messages) counts.set(message.conversationId, (counts.get(message.conversationId) ?? 0) + 1);
  return {
    conversations: payload.conversations.map((row) => ({ id: row.id, ...origin(row), projectId: text(row.projectId),
      title: text(row.title), titleSource: row.titleSource === 'user' ? 'user' : 'auto', pinned: false,
      archived: row.archived === true, agentMode: 'plan', messageCount: counts.get(row.id) ?? 0,
      createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })),
    messages: payload.messages.map((row) => ({ id: row.id, ...origin(row), projectId: text(row.projectId),
      conversationId: identity(row.conversationId), sequence: Number.isSafeInteger(row.sequence) && row.sequence >= 0 ? row.sequence : 0,
      role: row.role === 'user' ? 'user' : 'assistant', content: text(row.content), status: 'done',
      createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })),
    memories: payload.memories.map((row) => ({ id: row.id, ...origin(row), projectId: text(row.projectId),
      kind: ['fact', 'decision', 'preference', 'constraint'].includes(row.kind) ? row.kind : 'fact', content: text(row.content),
      enabled: row.enabled === true, source: { conversationId: text(row.source?.conversationId),
        messageId: typeof row.source?.messageId === 'string' ? row.source.messageId : undefined, unavailable: row.source?.unavailable === true },
      createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) })),
  };
}

/** 仅导出当前快照仍存在的文件；恢复点、已删除素材及失败导入残留不得随包传出。 */
export function selectArchiveAssets(snapshot: ProjectExchangeSnapshot, state: ProjectExchangeState,
  assets: readonly ArchiveAssetDigest[]): ArchiveAssetDigest[] {
  const paths = new Map(state.identities.filter((item) => item.kind === 'file').map((item) => [item.id, item.localId]));
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  return snapshot.entities.filter((entity) => entity.kind === 'file').map((entity) => {
    const path = paths.get(entity.id), asset = path ? byPath.get(path) : undefined;
    const descriptor = snapshot.media.find((item) => item.id === entity.data.mediaId);
    if (!asset || !descriptor || asset.bytes !== descriptor.bytes || asset.sha256 !== descriptor.sha256) throw new Error('当前项目素材清单已变化，请重新导出');
    return asset;
  });
}
