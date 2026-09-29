import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), persist: vi.fn() }));
vi.mock('../../src/services/aiService', () => ({ generateVideo: mocks.generate }));
vi.mock('../../src/services/fileService', async (original) => ({
  ...await original<typeof import('../../src/services/fileService')>(), persistMediaUrlToProjectData: mocks.persist,
}));
import { useAppStore } from '../../src/store/useAppStore';
import { executeGeneration } from '../../src/services/generationService';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ currentProjectId: 'p', showToast: vi.fn(), recordOutputHistory: vi.fn(async () => {}),
    nodes: [{ id: 'v', type: 'ai-video', position: { x: 0, y: 0 }, data: {
      type: 'ai-video', label: 'SH001', prompt: '动作', model: 'general/test', provider: 'general', seedanceDuration: 9,
    } }] });
  mocks.generate.mockReset().mockResolvedValue({ url: 'new.mp4' });
  mocks.persist.mockReset().mockResolvedValue({ mediaUrl: 'saved.mp4', sourceUrl: 'saved.mp4' });
});
it('uses each node duration and waits for output history before completing', async () => {
  let finish!: () => void;
  const history = vi.fn(async () => { await new Promise<void>((r) => { finish = r; }); });
  useAppStore.setState({ recordOutputHistory: history });
  let done = false;
  const task = executeGeneration('v').then((r) => { done = true; return r; });
  await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(1));
  expect(done).toBe(false);
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ seedanceDuration: 9 }));
  finish(); expect((await task).success).toBe(true);
  expect(useAppStore.getState().nodes[0].data.videoBatchFingerprint).toBeTruthy();
});
it('does not overwrite another project if it switches during persistence', async () => {
  mocks.persist.mockImplementation(async () => {
    useAppStore.setState({ currentProjectId: 'other', nodes: [{ id: 'v', position: { x: 0, y: 0 }, data: { type: 'ai-video', label: '他集', videoUrl: 'keep.mp4' } }] });
    return { mediaUrl: 'wrong.mp4', sourceUrl: 'wrong.mp4' };
  });
  expect((await executeGeneration('v')).success).toBe(false);
  expect(useAppStore.getState().nodes[0].data.videoUrl).toBe('keep.mp4');
});
it('preserves imported old video before generation and stops if its history cannot persist', async () => {
  useAppStore.getState().updateNodeDataTransient('v', { videoUrl: 'old.mp4' });
  const history = vi.fn(async (): Promise<void> => { throw new Error('history storage failed'); });
  // Error reporting is the second, optional history call.
  history.mockRejectedValueOnce(new Error('history storage failed')).mockResolvedValue(undefined);
  useAppStore.setState({ recordOutputHistory: history });
  expect((await executeGeneration('v')).success).toBe(false);
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(useAppStore.getState().nodes[0].data.videoUrl).toBe('old.mp4');
  expect(history.mock.calls[0]).toEqual(['v', expect.objectContaining({ mediaUrl: 'old.mp4' }), true]);
});
