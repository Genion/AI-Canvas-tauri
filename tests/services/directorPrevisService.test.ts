import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';
import { generateText } from '../../src/services/ai/generateText';
import { readVerifiedProjectFile, writeImmutableProjectFile } from '../../src/services/fs/projectFiles';
import { saveDataUrlToProjectData } from '../../src/services/fileService';
import { createDefaultPrevisScene } from '../../src/services/directorPrevisSchema';
import { buildPrevisGenerationPrompt, cancelDirectorPrevisGeneration, generateDirectorPrevis, loadDirectorPrevisScene, normalizePrevisReference, saveDirectorPrevisOutput, saveDirectorPrevisScene, openDirectorPrevis, subscribeDirectorPrevisOpen } from '../../src/services/directorPrevisService';

vi.mock('../../src/services/ai/generateText', () => ({ generateText: vi.fn() }));
vi.mock('../../src/services/fs/projectFiles', async (original) => ({
  ...await original<typeof import('../../src/services/fs/projectFiles')>(),
  readVerifiedProjectFile: vi.fn(), writeImmutableProjectFile: vi.fn(),
}));
vi.mock('../../src/services/fileService', async (original) => ({
  ...await original<typeof import('../../src/services/fileService')>(), saveDataUrlToProjectData: vi.fn(),
}));

const nodeId = 'director-previs-1';
const request = { nodeId, description: '走廊跟拍八秒', model: 'general/text', provider: 'general' };
const getData = () => useAppStore.getState().nodes.find((node) => node.id === nodeId)!.data;

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ currentProjectId: 'project-a', nodes: [{ id: nodeId, type: 'ai-director', position: { x: 0, y: 0 },
    data: { type: 'ai-director', label: '导演台', directorRuntimeKind: 'ai-threejs', directorInstanceId: 'instance-a' } }] });
  vi.mocked(generateText).mockResolvedValue(JSON.stringify(createDefaultPrevisScene()));
  vi.mocked(writeImmutableProjectFile).mockImplementation(async ({ reference }) => ({ ...reference, created: true }));
  vi.mocked(readVerifiedProjectFile).mockImplementation(async ({ reference }) => {
    const write = vi.mocked(writeImmutableProjectFile).mock.calls.find(([entry]) => entry.reference.sha256 === reference.sha256)?.[0];
    if (!write) throw new Error('missing file');
    return write.data;
  });
  vi.mocked(saveDataUrlToProjectData).mockResolvedValue({ assetUrl: 'asset://previs.png', filePath: '/project/previs.png' });
});

describe('previs generation and project lifecycle', () => {
  it('writes immutable validated data and stores only a verified file reference, with one history entry', async () => {
    const result = await generateDirectorPrevis(request);
    expect(result.title).toBe('走廊跟拍预演');
    expect(writeImmutableProjectFile).toHaveBeenCalledOnce();
    const write = vi.mocked(writeImmutableProjectFile).mock.calls[0][0];
    expect(write.projectId).toBe('project-a');
    expect(write.reference.relativePath).toBe(`director/previs/${write.reference.sha256}.json`);
    expect(getData().directorPrevisScene).toEqual({ kind: 'project-file', ...write.reference });
    expect(getData()).not.toHaveProperty('objects');
    expect(useAppStore.getState().history).toHaveLength(1);
    expect(getData().directorPrevisModel).toBe(request.model);
  });

  it('loads the saved contract using hash and byte verification', async () => {
    await saveDirectorPrevisScene(nodeId, createDefaultPrevisScene());
    const write = vi.mocked(writeImmutableProjectFile).mock.calls[0][0];
    vi.mocked(readVerifiedProjectFile).mockResolvedValue(write.data);
    expect(await loadDirectorPrevisScene('project-a', getData().directorPrevisScene)).toEqual(createDefaultPrevisScene());
    expect(readVerifiedProjectFile).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-a', reference: write.reference }));
  });

  it('supports undo and redo of the scene reference without reverting generated media', async () => {
    await saveDirectorPrevisScene(nodeId, createDefaultPrevisScene());
    const reference = getData().directorPrevisScene;
    expect(await useAppStore.getState().undo()).toBe(true);
    expect(getData().directorPrevisScene).toBeUndefined();
    expect(await useAppStore.getState().redo()).toBe(true);
    expect(getData().directorPrevisScene).toEqual(reference);
  });

  it.each(['project', 'revision', 'runtime', 'instance', 'removed', 'reference', 'prompt', 'model', 'provider'])(
    'rejects stale model results after %s changes', async (change) => {
      vi.mocked(generateText).mockImplementation(async () => {
        const state = useAppStore.getState();
        if (change === 'project') useAppStore.setState({ currentProjectId: 'project-b' });
        if (change === 'revision') state.incrementRevision();
        if (change === 'runtime') state.updateNodeDataTransient(nodeId, { directorRuntimeKind: 'blender' });
        if (change === 'instance') state.updateNodeDataTransient(nodeId, { directorInstanceId: 'instance-b' });
        if (change === 'removed') useAppStore.setState({ nodes: [] });
        if (change === 'reference') state.updateNodeDataTransient(nodeId, { directorPrevisScene: { kind: 'project-file', relativePath: `director/previs/${'a'.repeat(64)}.json`, sha256: 'a'.repeat(64), bytes: 1 } });
        if (change === 'prompt') state.updateNodeDataTransient(nodeId, { prompt: '新描述' });
        if (change === 'model') state.updateNodeDataTransient(nodeId, { model: 'other-model' });
        if (change === 'provider') state.updateNodeDataTransient(nodeId, { provider: 'other-provider' });
        return JSON.stringify(createDefaultPrevisScene());
      });
      await expect(generateDirectorPrevis(request)).rejects.toMatchObject({ name: 'AbortError' });
      expect(writeImmutableProjectFile).not.toHaveBeenCalled();
    },
  );

  it('rechecks after disk writes and never publishes a stale reference', async () => {
    vi.mocked(writeImmutableProjectFile).mockImplementation(async ({ reference }) => {
      useAppStore.getState().incrementRevision(); return { ...reference, created: true };
    });
    await expect(generateDirectorPrevis(request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getData().directorPrevisScene).toBeUndefined();
  });

  it('forwards cancellation to the model and discards any returned output', async () => {
    const controller = new AbortController();
    vi.mocked(generateText).mockImplementation(async ({ signal }) => {
      controller.abort(); expect(signal?.aborted).toBe(true); return JSON.stringify(createDefaultPrevisScene());
    });
    await expect(generateDirectorPrevis({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(writeImmutableProjectFile).not.toHaveBeenCalled();
  });

  it('shares node cancellation between entry points and rejects duplicate model requests', async () => {
    let finish!: (reply: string) => void;
    let modelSignal: AbortSignal | undefined;
    vi.mocked(generateText).mockImplementation(({ signal }) => {
      modelSignal = signal;
      return new Promise((resolve) => { finish = resolve; });
    });
    const pending = generateDirectorPrevis(request);
    expect(getData().status).toBe('loading');
    await expect(generateDirectorPrevis(request)).rejects.toThrow('正在生成');
    cancelDirectorPrevisGeneration(nodeId);
    expect(modelSignal?.aborted).toBe(true);
    finish(JSON.stringify(createDefaultPrevisScene()));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getData().status).toBe('idle');
    expect(generateText).toHaveBeenCalledOnce();
    expect(writeImmutableProjectFile).not.toHaveBeenCalled();
    vi.mocked(generateText).mockResolvedValue(JSON.stringify(createDefaultPrevisScene()));
    await expect(generateDirectorPrevis(request)).resolves.toHaveProperty('title');
  });

  it.each(['image', 'sheet', 'bound-image', 'missing-image'])(
    'rejects late results after a referenced %s changes', async (kind) => {
      useAppStore.setState((state) => ({ nodes: [...state.nodes,
        { id: 'image', type: 'source-image', position: { x: 0, y: 0 }, data: { type: 'source-image', label: '空间图', imageUrl: 'before.png' } },
        { id: 'sheet', type: 'ai-shotlist', position: { x: 0, y: 0 }, data: { type: 'ai-shotlist', label: '整表', shotlistRows: [
          { id: 'r1', shotNo: '1', content: '进入走廊', frame: { nodeId: 'bound-image', kind: 'image', url: 'snapshot.png' } },
        ] } },
        { id: 'bound-image', type: 'source-image', position: { x: 0, y: 0 }, data: { type: 'source-image', label: '画面', imageUrl: 'before.png' } },
      ] }));
      vi.mocked(generateText).mockImplementation(async () => {
        if (kind === 'missing-image') useAppStore.setState((state) => ({ nodes: [...state.nodes,
          { id: 'missing-image', type: 'source-image', position: { x: 0, y: 0 }, data: { type: 'source-image', label: '图', imageUrl: 'new.png' } },
        ] }));
        else useAppStore.getState().updateNodeDataTransient(kind, kind === 'sheet' ? { shotlistRows: [] } : { imageUrl: 'changed.png' });
        return JSON.stringify(createDefaultPrevisScene());
      });
      await expect(generateDirectorPrevis({ ...request, description: '@{image:空间图} @{sheet:整表} @{missing-image:缺失图} 跟拍' })).rejects.toMatchObject({ name: 'AbortError' });
      expect(writeImmutableProjectFile).not.toHaveBeenCalled();
    },
  );

  it('loads the verified saved scene for refinement and fails closed when it is unreadable', async () => {
    const previous = { ...createDefaultPrevisScene(), title: '保留已调整空间' };
    await saveDirectorPrevisScene(nodeId, previous);
    await generateDirectorPrevis(request);
    expect(generateText).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: expect.stringContaining('保留已调整空间') }));
    vi.mocked(generateText).mockClear();
    vi.mocked(readVerifiedProjectFile).mockRejectedValue(new Error('hash mismatch'));
    await expect(generateDirectorPrevis(request)).rejects.toThrow('hash mismatch');
    expect(generateText).not.toHaveBeenCalled();
    expect(getData().status).toBe('error');
    expect(getData().directorPrevisScene).toBeDefined();
  });

  it.each([
    { changed: false, viaSheet: false }, { changed: true, viaSheet: false },
    { changed: false, viaSheet: true }, { changed: true, viaSheet: true },
  ])('guards its captured frame: changed=$changed, viaSheet=$viaSheet', async ({ changed, viaSheet }) => {
    useAppStore.getState().updateNodeDataTransient(nodeId, { imageUrl: 'own-frame.png' });
    if (viaSheet) useAppStore.setState((state) => ({ nodes: [...state.nodes,
      { id: 'sheet', type: 'ai-shotlist', position: { x: 0, y: 0 }, data: { type: 'ai-shotlist', label: '整表', shotlistRows: [
        { id: 'r1', shotNo: '1', content: '环绕', frame: { nodeId, kind: 'image', url: 'own-frame.png' } },
      ] } },
    ] }));
    vi.mocked(generateText).mockImplementation(async () => {
      if (changed) useAppStore.getState().updateNodeDataTransient(nodeId, { imageUrl: 'new-frame.png' });
      return JSON.stringify(createDefaultPrevisScene());
    });
    const pending = generateDirectorPrevis({ ...request, description: `参考 @{${viaSheet ? 'sheet:整表' : `${nodeId}:当前截图`}} 改为环绕` });
    if (changed) {
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(writeImmutableProjectFile).not.toHaveBeenCalled();
    } else {
      await expect(pending).resolves.toHaveProperty('title');
      expect(writeImmutableProjectFile).toHaveBeenCalledOnce();
    }
  });

  it('rejects malformed output and write failure while preserving the previous scene', async () => {
    await saveDirectorPrevisScene(nodeId, createDefaultPrevisScene());
    const previous = getData().directorPrevisScene;
    vi.mocked(generateText).mockResolvedValue('not JSON');
    await expect(generateDirectorPrevis(request)).rejects.toThrow('JSON');
    vi.mocked(generateText).mockResolvedValue(JSON.stringify(createDefaultPrevisScene()));
    vi.mocked(writeImmutableProjectFile).mockRejectedValue(new Error('write failed'));
    await expect(generateDirectorPrevis(request)).rejects.toThrow('write failed');
    expect(getData().directorPrevisScene).toEqual(previous);
  });

  it('rejects paths or identity mismatches before reading any file', () => {
    for (const relativePath of ['../../secret', 'director/previs/other.json']) {
      expect(() => normalizePrevisReference({ kind: 'project-file', relativePath, sha256: 'a'.repeat(64), bytes: 100 })).toThrow();
    }
    expect(readVerifiedProjectFile).not.toHaveBeenCalled();
  });

  it('saves a camera frame or video into the original node and retains both outputs', async () => {
    await saveDirectorPrevisScene(nodeId, createDefaultPrevisScene());
    await saveDirectorPrevisOutput(nodeId, 'image', async () => 'data:image/png;base64,AA==');
    await saveDirectorPrevisOutput(nodeId, 'video', async () => 'data:video/mp4;base64,AA==');
    expect(getData().directorCaptureUrls).toEqual(['asset://previs.png']);
    expect(getData().imageUrl).toBe('asset://previs.png');
    expect(getData().videoUrl).toBe('asset://previs.png');
  });

  it('does not save late renders or publish after stale media writes', async () => {
    await saveDirectorPrevisScene(nodeId, createDefaultPrevisScene());
    await expect(saveDirectorPrevisOutput(nodeId, 'image', async () => {
      useAppStore.getState().incrementRevision(); return 'data:image/png;base64,AA==';
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(saveDataUrlToProjectData).not.toHaveBeenCalled();
    vi.mocked(saveDataUrlToProjectData).mockImplementation(async () => {
      useAppStore.setState({ currentProjectId: 'project-b' });
      return { assetUrl: 'asset://late.png', filePath: '/project/late.png' };
    });
    await expect(saveDirectorPrevisOutput(nodeId, 'image', async () => 'data:image/png;base64,AA==')).rejects.toMatchObject({ name: 'AbortError' });
    expect(getData().imageUrl).toBeUndefined();
  });

  it('requires a saved scene and rejects arbitrary render URLs', async () => {
    await expect(saveDirectorPrevisOutput(nodeId, 'image', async () => 'data:image/png;base64,AA==')).rejects.toThrow('先保存');
    await saveDirectorPrevisScene(nodeId, createDefaultPrevisScene());
    await expect(saveDirectorPrevisOutput(nodeId, 'image', async () => 'https://example.com/frame')).rejects.toThrow('格式无效');
  });

  it('routes dialog opens through an in-memory host lease and removes it on disposal', () => {
    const open = vi.fn(); const unsubscribe = subscribeDirectorPrevisOpen('instance-test', open);
    openDirectorPrevis('instance-test'); expect(open).toHaveBeenCalledOnce();
    unsubscribe(); expect(() => openDirectorPrevis('instance-test')).toThrow('主窗口');
  });

  it('bounds user instructions and includes current blocking when refining a scene', () => {
    expect(() => buildPrevisGenerationPrompt('')).toThrow();
    expect(() => buildPrevisGenerationPrompt('a'.repeat(12001))).toThrow();
    expect(buildPrevisGenerationPrompt('只改焦距', createDefaultPrevisScene())).toContain('用户当前预演');
    const scene = { ...createDefaultPrevisScene(), title: '@{image:不应再次引用}' };
    expect(buildPrevisGenerationPrompt('只改焦距', scene)).not.toContain('@{image:');
  });
});
