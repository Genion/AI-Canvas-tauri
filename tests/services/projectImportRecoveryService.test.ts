/** 恢复编排的文件完整性与接收端目录定位边界。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSaveData } from '../../src/services/storageService';
import { captureExchangeSnapshot } from '../../src/services/projectExchangeDomain';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn(), recoveries: vi.fn(), commit: vi.fn(), notify: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, convertFileSrc: (value: string) => value }));
vi.mock('../../src/services/fileService', () => ({ ensureProjectDataDir: async () => '/projects/renamed', notifyProjectDiskChanged: mocks.notify }));
vi.mock('../../src/services/projectTransferService', () => ({}));
vi.mock('../../src/services/indexedDb/projectExchangeRepository', () => ({ loadProjectExchangeState: async () => null }));
vi.mock('../../src/services/indexedDb/projectImportRepository', () => ({
  readProjectImportScope: mocks.read, listProjectImportRecoveries: mocks.recoveries, commitProjectImport: mocks.commit,
}));
vi.mock('../../src/services/projectMergeWorkerClient', () => ({ captureProjectSnapshot: (...args: Parameters<typeof captureExchangeSnapshot>) => captureExchangeSnapshot(...args) }));
import { restoreProjectImportRecovery } from '../../src/services/projectImportService';

const owner: ProjectSaveData = { id: 'root', name: '已改名', dataFolder: 'renamed', nodes: [], edges: [], groups: [], createdAt: 1, updatedAt: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue([owner]);
  mocks.invoke.mockResolvedValue([]);
  mocks.commit.mockResolvedValue(undefined);
});
describe('导入恢复点编排', () => {
  it('项目改名后恢复内容仍保留当前目录，分集与 owner 使用同一素材根', async () => {
    mocks.recoveries.mockResolvedValue([{ id: 'recovery', records: [
      { ...owner, name: '旧名称', dataFolder: 'old-folder' },
      { ...owner, id: 'episode', parentId: 'root', dataFolder: 'old-folder' },
    ], assets: [], state: null }]);
    await restoreProjectImportRecovery('root', 'recovery');
    const input = mocks.commit.mock.calls[0][0];
    expect(input.records).toMatchObject([{ id: 'root', name: '旧名称', dataFolder: 'renamed' }, { id: 'episode', dataFolder: 'renamed' }]);
    expect(mocks.notify).toHaveBeenCalledOnce();
  });
  it.each([{ assets: [] }, { assets: [{ path: 'imports/recovery/a.png', bytes: 10, sha256: 'b'.repeat(64) }] }])('恢复点文件缺失或被替换时不发布文件、不提交数据库', async ({ assets }) => {
    mocks.recoveries.mockResolvedValue([{ id: 'recovery', records: [owner], state: null,
      assets: [{ path: 'imports/recovery/a.png', bytes: 10, sha256: 'a'.repeat(64) }] }]);
    mocks.invoke.mockResolvedValue(assets);
    await expect(restoreProjectImportRecovery('root', 'recovery')).rejects.toThrow('恢复点素材缺失或已被修改');
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(['inspect_project_archive_assets']);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
