/** 项目协作的纯协议边界；输入必须已经过领域适配，不接受原始 Store/本机媒体对象。 */
import type {
  ProjectExchangeBaseResult, ProjectExchangeBundle, ProjectExchangeEntity, ProjectExchangeEntityKind,
  ProjectExchangeMedia, ProjectExchangeObject, ProjectExchangeReference, ProjectExchangeRevision,
  ProjectExchangeRevisionHeader, ProjectExchangeSnapshot, ProjectExchangeValue,
} from '../types/projectExchange';
import { sha256BytesHex } from './mediaDataUrl';

export const PROJECT_EXCHANGE_ARCHIVE_VERSION = 3;
export const PROJECT_EXCHANGE_LIMITS = {
  snapshotBytes: 64 * 1024 * 1024, bundleBytes: 512 * 1024 * 1024, stringBytes: 8 * 1024 * 1024,
  entities: 200_000, media: 200_000, values: 1_000_000, references: 1_000_000,
  mediaBytes: 20 * 1024 * 1024 * 1024, revisions: 256, depth: 32,
} as const;
const encoder = new TextEncoder();
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const KINDS: readonly ProjectExchangeEntityKind[] = ['project', 'node', 'edge', 'group', 'character', 'scene', 'prop',
  'referenceImage', 'voiceClip', 'action', 'actionMedia', 'shot', 'file', 'imageMetadata'];
const forbiddenKeys = new Set(['proto', 'constructor', 'prototype', 'apikey', 'apikeyref', 'accesskeyid',
  'secretaccesskey', 'sessiontoken', 'accesstoken', 'refreshtoken', 'password', 'clientsecret',
  'token', 'mcptoken', 'bearertoken', 'authorization', 'filepath', 'rootpath', 'datafolder', 'outputpath',
  'abortcontroller', 'taskid', 'agenttaskid']);
type RecordValue = Record<string, unknown>;
const invalid = (code = 'invalid_format'): never => {
  throw new Error('项目协作材料格式无效，已停止处理', { cause: { code } });
};
function object(value: unknown, allowed?: readonly string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const record = value as RecordValue;
  if (allowed && Object.keys(record).some((key) => !allowed.includes(key))) invalid();
  return record;
}
export function projectExchangeId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) return invalid('invalid_identity');
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return invalid('invalid_digest');
  return value;
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) return invalid('limit_exceeded');
  return value;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function jsonValue(value: unknown, budget: { count: number; bytes: number }, visiting: WeakSet<object>, depth = 0): ProjectExchangeValue {
  if (++budget.count > PROJECT_EXCHANGE_LIMITS.values || depth > PROJECT_EXCHANGE_LIMITS.depth) return invalid('limit_exceeded');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) return invalid(); return value; }
  if (typeof value === 'string') {
    if (value.length > PROJECT_EXCHANGE_LIMITS.stringBytes || value.includes('\0')) return invalid('limit_exceeded');
    budget.bytes += encoder.encode(value).byteLength;
    if (budget.bytes > PROJECT_EXCHANGE_LIMITS.snapshotBytes) return invalid('limit_exceeded');
    return value;
  }
  if (!value || typeof value !== 'object' || visiting.has(value)) return invalid();
  visiting.add(value);
  try {
    if (Array.isArray(value)) return list(value, PROJECT_EXCHANGE_LIMITS.values).map((entry) => jsonValue(entry, budget, visiting, depth + 1));
    const record = object(value);
    return Object.fromEntries(Object.keys(record).sort(compare).map((key) => {
      if (forbiddenKeys.has(key.replace(/[_-]/g, '').toLowerCase())) return invalid('non_portable_field');
      budget.bytes += encoder.encode(key).byteLength;
      if (budget.bytes > PROJECT_EXCHANGE_LIMITS.snapshotBytes) return invalid('limit_exceeded');
      return [key, jsonValue(record[key], budget, visiting, depth + 1)];
    }));
  } finally { visiting.delete(value); }
}
/** 保留 null、文本空白与用户数组顺序；只固定对象键顺序。 */
export function serializeProjectExchangeValue(value: unknown): string {
  return JSON.stringify(jsonValue(value, { count: 0, bytes: 0 }, new WeakSet()));
}
function parseInput(input: unknown, limit: number): unknown {
  if (typeof input !== 'string') return input;
  if (input.length > limit || encoder.encode(input).byteLength > limit) return invalid('limit_exceeded');
  try { return JSON.parse(input); } catch { return invalid(); }
}
function reference(input: unknown): ProjectExchangeReference {
  const value = object(input, ['kind', 'scopeId', 'id']);
  if (!KINDS.includes(value.kind as ProjectExchangeEntityKind)) return invalid('invalid_identity');
  return { kind: value.kind as ProjectExchangeEntityKind, scopeId: projectExchangeId(value.scopeId), id: projectExchangeId(value.id) };
}
export const parseProjectExchangeReference = reference;
export function projectExchangeEntityKey(value: ProjectExchangeReference): string {
  return JSON.stringify([value.kind, value.scopeId, value.id]);
}
export function parseProjectExchangeSnapshot(input: unknown): ProjectExchangeSnapshot {
  const value = object(parseInput(input, PROJECT_EXCHANGE_LIMITS.snapshotBytes),
    ['format', 'canonicalVersion', 'lineageId', 'rootProjectId', 'complete', 'entities', 'media']);
  if (value.format !== 'ai-canvas-project-snapshot' || value.canonicalVersion !== 1 || value.complete !== true) return invalid();
  const lineageId = projectExchangeId(value.lineageId), rootProjectId = projectExchangeId(value.rootProjectId);
  const budget = { count: 0, bytes: 0 };
  let referenceCount = 0;
  const entities = list(value.entities, PROJECT_EXCHANGE_LIMITS.entities).map((entry): ProjectExchangeEntity => {
    const entity = object(entry, ['kind', 'scopeId', 'id', 'data', 'references']);
    const identity = reference({ kind: entity.kind, scopeId: entity.scopeId, id: entity.id });
    const refs = list(entity.references, PROJECT_EXCHANGE_LIMITS.references);
    referenceCount += refs.length;
    if (referenceCount > PROJECT_EXCHANGE_LIMITS.references) return invalid('limit_exceeded');
    const references = refs.map(reference).sort((a, b) => compare(projectExchangeEntityKey(a), projectExchangeEntityKey(b)));
    if (new Set(references.map(projectExchangeEntityKey)).size !== references.length) return invalid('duplicate_identity');
    const data = jsonValue(object(entity.data), budget, new WeakSet()) as ProjectExchangeObject;
    return { ...identity, data, references };
  }).sort((a, b) => compare(projectExchangeEntityKey(a), projectExchangeEntityKey(b)));
  const byKey = new Map(entities.map((entity) => [projectExchangeEntityKey(entity), entity]));
  if (byKey.size !== entities.length) return invalid('duplicate_identity');
  const projects = new Set(entities.filter((entity) => entity.kind === 'project').map((entity) => {
    if (entity.scopeId !== entity.id) return invalid('invalid_identity');
    return entity.id;
  }));
  if (!projects.has(rootProjectId)) return invalid('missing_dependency');
  for (const entity of entities) {
    if (!projects.has(entity.scopeId) || entity.references.some((ref) => !byKey.has(projectExchangeEntityKey(ref)))) return invalid('missing_dependency');
  }
  let totalBytes = 0;
  const media = list(value.media, PROJECT_EXCHANGE_LIMITS.media).map((entry): ProjectExchangeMedia => {
    const item = object(entry, ['id', 'kind', 'extension', 'bytes', 'sha256']);
    if (!['image', 'video', 'audio', 'file'].includes(String(item.kind))
      || typeof item.extension !== 'string' || !/^[a-z0-9]{1,16}$/.test(item.extension)
      || !Number.isSafeInteger(item.bytes) || (item.bytes as number) < 0
      || (item.bytes === 0 && item.kind !== 'file')) return invalid();
    totalBytes += item.bytes as number;
    if (totalBytes > PROJECT_EXCHANGE_LIMITS.mediaBytes) return invalid('limit_exceeded');
    return { id: projectExchangeId(item.id), kind: item.kind as ProjectExchangeMedia['kind'], extension: item.extension,
      bytes: item.bytes as number, sha256: digest(item.sha256) };
  }).sort((a, b) => compare(a.id, b.id));
  const mediaIds = new Set(media.map((item) => item.id));
  if (mediaIds.size !== media.length) return invalid('duplicate_identity');
  const used = new Set<string>();
  for (const entity of entities) if (entity.kind === 'file') {
    const mediaId = projectExchangeId(entity.data.mediaId);
    if (!mediaIds.has(mediaId)) return invalid('missing_dependency');
    used.add(mediaId);
  }
  if (used.size !== media.length) return invalid('missing_dependency');
  const result: ProjectExchangeSnapshot = { format: 'ai-canvas-project-snapshot', canonicalVersion: 1,
    lineageId, rootProjectId, complete: true, entities, media };
  if (encoder.encode(serializeProjectExchangeValue(result)).byteLength > PROJECT_EXCHANGE_LIMITS.snapshotBytes) return invalid('limit_exceeded');
  return result;
}
function header(input: unknown): ProjectExchangeRevisionHeader {
  const value = object(input, ['lineageId', 'canonicalVersion', 'revisionId', 'parentRevisionIds', 'contentDigest']);
  if (value.canonicalVersion !== 1) return invalid();
  const revisionId = digest(value.revisionId);
  const parentRevisionIds = list(value.parentRevisionIds, 2).map(digest).sort(compare);
  if (parentRevisionIds.includes(revisionId) || new Set(parentRevisionIds).size !== parentRevisionIds.length) return invalid('invalid_ancestry');
  return { lineageId: projectExchangeId(value.lineageId), canonicalVersion: 1, revisionId,
    parentRevisionIds, contentDigest: digest(value.contentDigest) };
}
function headerInput(value: ProjectExchangeRevisionHeader): Omit<ProjectExchangeRevisionHeader, 'revisionId'> {
  return { lineageId: value.lineageId, canonicalVersion: value.canonicalVersion,
    parentRevisionIds: value.parentRevisionIds, contentDigest: value.contentDigest };
}
const hash = (value: unknown) => sha256BytesHex(encoder.encode(serializeProjectExchangeValue(value)));
export async function verifyProjectExchangeHeader(input: unknown): Promise<ProjectExchangeRevisionHeader> {
  const result = header(input);
  if (await hash(headerInput(result)) !== result.revisionId) return invalid('invalid_digest');
  return result;
}
export async function createProjectExchangeRevision(input: unknown, parents: readonly string[] = []): Promise<ProjectExchangeRevision> {
  const snapshot = parseProjectExchangeSnapshot(input);
  const parentRevisionIds = list([...parents], 2).map(digest).sort(compare);
  if (new Set(parentRevisionIds).size !== parentRevisionIds.length) return invalid('invalid_ancestry');
  const contentDigest = await hash(snapshot);
  const body = { lineageId: snapshot.lineageId, canonicalVersion: snapshot.canonicalVersion, parentRevisionIds, contentDigest };
  return { ...body, revisionId: await hash(body), snapshot };
}
export async function verifyProjectExchangeRevision(input: unknown): Promise<ProjectExchangeRevision> {
  const value = object(input, ['lineageId', 'canonicalVersion', 'revisionId', 'parentRevisionIds', 'contentDigest', 'snapshot']);
  const snapshot = parseProjectExchangeSnapshot(value.snapshot);
  const body = await verifyProjectExchangeHeader(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'snapshot')));
  if (snapshot.lineageId !== body.lineageId || await hash(snapshot) !== body.contentDigest) return invalid('invalid_digest');
  return { ...body, snapshot };
}
export function projectExchangeRevisionHeader(revision: ProjectExchangeRevision): ProjectExchangeRevisionHeader {
  return { lineageId: revision.lineageId, canonicalVersion: revision.canonicalVersion, revisionId: revision.revisionId,
    parentRevisionIds: [...revision.parentRevisionIds], contentDigest: revision.contentDigest };
}
function archivePath(input: unknown): string {
  if (typeof input !== 'string' || input.length > 1024 || !input.startsWith('assets/') || /[\\<>:"|?*]/.test(input)
    || [...input].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || input.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return invalid('invalid_path');
  return input;
}
export async function parseProjectExchangeBundle(input: unknown): Promise<ProjectExchangeBundle> {
  const value = object(parseInput(input, PROJECT_EXCHANGE_LIMITS.bundleBytes),
    ['format', 'version', 'packageId', 'lineageId', 'headRevisionId', 'revisions', 'ancestors', 'files']);
  if (value.format !== 'ai-canvas-project-exchange' || value.version !== 1) return invalid();
  const lineageId = projectExchangeId(value.lineageId), headRevisionId = digest(value.headRevisionId);
  const revisionInputs = list(value.revisions, PROJECT_EXCHANGE_LIMITS.revisions);
  const ancestorInputs = list(value.ancestors, PROJECT_EXCHANGE_LIMITS.revisions);
  if (!revisionInputs.length || revisionInputs.length + ancestorInputs.length > PROJECT_EXCHANGE_LIMITS.revisions) return invalid('limit_exceeded');
  const revisions: ProjectExchangeRevision[] = [];
  for (const entry of revisionInputs) revisions.push(await verifyProjectExchangeRevision(entry));
  const ancestors: ProjectExchangeRevisionHeader[] = [];
  for (const entry of ancestorInputs) ancestors.push(await verifyProjectExchangeHeader(entry));
  const all = [...revisions, ...ancestors];
  if (all.some((entry) => entry.lineageId !== lineageId) || new Set(all.map((entry) => entry.revisionId)).size !== all.length) return invalid('invalid_ancestry');
  const head = revisions.find((entry) => entry.revisionId === headRevisionId);
  if (!head || revisions.some((entry) => entry.snapshot.rootProjectId !== head.snapshot.rootProjectId)) return invalid('missing_dependency');
  // 基线查找也检查可达父链；允许正文之外的历史描述，不将缺失父链伪装成完整历史。
  await findProjectExchangeBase(headRevisionId, headRevisionId, revisions, ancestors);
  const ids = new Set<string>(), paths = new Set<string>();
  const files = list(value.files, PROJECT_EXCHANGE_LIMITS.media).map((entry) => {
    const item = object(entry, ['mediaId', 'archivePath']);
    const mediaId = projectExchangeId(item.mediaId), path = archivePath(item.archivePath);
    const key = path.normalize('NFC').toLowerCase();
    if (ids.has(mediaId) || paths.has(key)) return invalid('duplicate_identity');
    ids.add(mediaId); paths.add(key);
    return { mediaId, archivePath: path };
  });
  if (files.length !== head.snapshot.media.length || head.snapshot.media.some((entry) => !ids.has(entry.id))) return invalid('missing_dependency');
  const result: ProjectExchangeBundle = { format: 'ai-canvas-project-exchange', version: 1,
    packageId: projectExchangeId(value.packageId), lineageId, headRevisionId, revisions, ancestors, files };
  // 每份正文分别受 64 MiB 限制；整个包的文本材料仍有总上限。
  const serialized = JSON.stringify(result);
  if (serialized.length > PROJECT_EXCHANGE_LIMITS.bundleBytes || encoder.encode(serialized).byteLength > PROJECT_EXCHANGE_LIMITS.bundleBytes) return invalid('limit_exceeded');
  return result;
}

/** 找唯一最近公共祖先；时间戳不参与，缺材料或多基线时返回明确降级状态。 */
export async function findProjectExchangeBase(leftId: string, rightId: string,
  revisions: readonly ProjectExchangeRevision[], ancestors: readonly ProjectExchangeRevisionHeader[] = [],
): Promise<ProjectExchangeBaseResult> {
  digest(leftId); digest(rightId);
  if (revisions.length + ancestors.length > PROJECT_EXCHANGE_LIMITS.revisions) return invalid('limit_exceeded');
  const graph = new Map<string, ProjectExchangeRevisionHeader>(), bodies = new Map<string, ProjectExchangeRevision>();
  const rootByLineage = new Map<string, string>();
  const insert = (entry: ProjectExchangeRevisionHeader) => {
    const previous = graph.get(entry.revisionId);
    if (previous && serializeProjectExchangeValue(previous) !== serializeProjectExchangeValue(entry)) return invalid('invalid_ancestry');
    graph.set(entry.revisionId, entry);
  };
  for (const entry of ancestors) insert(await verifyProjectExchangeHeader(entry));
  for (const entry of revisions) {
    const revision = await verifyProjectExchangeRevision(entry);
    const root = rootByLineage.get(revision.lineageId);
    if (root !== undefined && root !== revision.snapshot.rootProjectId) return invalid('invalid_ancestry');
    rootByLineage.set(revision.lineageId, revision.snapshot.rootProjectId);
    insert(projectExchangeRevisionHeader(revision)); bodies.set(revision.revisionId, revision);
  }
  const left = graph.get(leftId), right = graph.get(rightId);
  if (!left || !right) return { status: 'incomplete' };
  if (left.lineageId !== right.lineageId) return { status: 'unrelated' };
  let incomplete = false;
  const colors = new Map<string, number>();
  const visit = (id: string): void => {
    if (colors.get(id) === 1) return invalid('invalid_ancestry');
    if (colors.get(id) === 2) return;
    const entry = graph.get(id);
    if (!entry) { incomplete = true; return; }
    if (entry.lineageId !== left.lineageId) return invalid('invalid_ancestry');
    colors.set(id, 1); entry.parentRevisionIds.forEach(visit); colors.set(id, 2);
  };
  visit(leftId); visit(rightId);
  if (incomplete) return { status: 'incomplete' };
  const reachable = (id: string): Set<string> => {
    const found = new Set<string>(), pending = [id];
    while (pending.length) {
      const current = pending.pop()!;
      if (found.has(current)) continue;
      found.add(current); pending.push(...graph.get(current)!.parentRevisionIds);
    }
    return found;
  };
  const a = reachable(leftId), b = reachable(rightId);
  const common = [...a].filter((id) => b.has(id));
  if (!common.length) return { status: 'unrelated' };
  const superseded = new Set<string>();
  for (const id of common) for (const parent of reachable(id)) if (parent !== id) superseded.add(parent);
  const nearest = common.filter((id) => !superseded.has(id));
  if (nearest.length !== 1) return { status: 'ambiguous' };
  const revision = bodies.get(nearest[0]);
  return revision ? { status: 'found', revision } : { status: 'missingSnapshot' };
}
