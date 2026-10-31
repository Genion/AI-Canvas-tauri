/** 真实业务适配的跨设备往返；不依赖归档编排的 mock。 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureExchangeSnapshot, materializeExchangeSnapshot, validateExchangeDomain } from '../../src/services/projectExchangeDomain';
import type { ProjectSaveData } from '../../src/services/storageService';
import type { ProjectExchangeIdentity, ProjectExchangeState } from '../../src/types/projectExchange';
beforeEach(() => vi.stubGlobal('crypto', webcrypto)); afterEach(() => vi.unstubAllGlobals());
describe('项目规范快照往返', () => {
  it('拒绝合并后失去父对象的子实体，以及循环子对象列表', () => {
    const source: ProjectSaveData = { id: 'root', name: '项目', nodes: [], edges: [], createdAt: 1, updatedAt: 1 };
    const captured = captureExchangeSnapshot([source], [], null);
    const orphan = { kind: 'action' as const, scopeId: 'root', id: 'orphan', data: {}, references: [] };
    expect(() => validateExchangeDomain({ ...captured.snapshot, entities: [...captured.snapshot.entities, orphan] })).toThrow('所属对象');
    const cyclic = { ...orphan, data: { actionsIds: ['orphan'] } };
    expect(() => validateExchangeDomain({ ...captured.snapshot, entities: [...captured.snapshot.entities, cyclic] })).toThrow('循环');
  });
  it('旧项目无资产库时，规范化空库后保持相同业务快照', () => {
    const source: ProjectSaveData = { id: 'root', name: '空库', nodes: [], edges: [], createdAt: 1, updatedAt: 2 };
    const captured = captureExchangeSnapshot([source], [], null);
    const records = materializeExchangeSnapshot(captured.snapshot, [...captured.identities], [source], '文件夹', captured.files, false);
    const state: ProjectExchangeState = { ownerId: 'root', lineageId: captured.snapshot.lineageId, rootProjectId: 'root',
      headRevisionId: 'a'.repeat(64), stateVersion: 1, identities: captured.identities };
    expect(captureExchangeSnapshot(records, [], state, captured.snapshot).snapshot).toEqual(captured.snapshot);
  });
  it('不同项目 ID、目录和中文媒体名称下，第二次导出仍保持逻辑身份', () => {
    const source: ProjectSaveData = { id: 'root', name: '剧集', nodes: [], edges: [], createdAt: 1, updatedAt: 2 };
    const episode = { ...source, id: 'episode', parentId: 'root', nodes: [{ id: 'n', type: 'source-image', position: { x: 0, y: 0 }, data: { relativePath: '图片/人物.png' } }] };
    const assets = [{ path: '图片/人物.png', bytes: 10, sha256: 'a'.repeat(64) }];
    const captured = captureExchangeSnapshot([source, episode], assets, null);
    const identities: ProjectExchangeIdentity[] = [{ kind: 'project', scopeId: 'root', id: 'root', localId: 'recipient' }];
    const paths = new Map([...captured.files].map(([id]) => [id, `imports/op/${id}/人物.png`]));
    const imported = materializeExchangeSnapshot(captured.snapshot, identities, [], '接收方目录', paths);
    for (const [id, path] of paths) identities.push({ kind: 'file', scopeId: 'root', id, localId: path });
    const state: ProjectExchangeState = { ownerId: 'recipient', lineageId: captured.snapshot.lineageId, rootProjectId: 'root', headRevisionId: 'b'.repeat(64), stateVersion: 1, identities };
    const receivedAssets = [...paths.values()].map((path) => ({ ...assets[0], path }));
    expect(captureExchangeSnapshot(imported, receivedAssets, state, captured.snapshot).snapshot).toEqual(captured.snapshot);
  });
});
