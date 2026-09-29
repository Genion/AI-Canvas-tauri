import { beforeEach, it, expect, vi } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';
import { inspectVideoNode, videoInputFingerprint } from '../../src/services/videoBatchPlanning';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ currentProjectId: 'p', showToast: vi.fn(), nodes: [{ id: 'v', type: 'ai-video', position: { x: 0, y: 0 },
    data: { type: 'ai-video', label: 'SH001', model: 'general/test', provider: 'general', prompt: '@{img:参考图} 动作', seedanceDuration: 6, videoUrl: 'old.mp4' } },
    { id: 'img', type: 'source-image', position: { x: 0, y: 0 }, data: { type: 'source-image', label: '参考图', imageUrl: 'ref.png' } }] });
});
it('detects broken reference inputs and invalid duration', () => {
  const state = useAppStore.getState();
  expect(inspectVideoNode(state.nodes[0], state).issues).toEqual([]);
  useAppStore.getState().updateNodeDataTransient('img', { imageUrl: '' });
  useAppStore.getState().updateNodeDataTransient('v', { seedanceDuration: -1 });
  const next = useAppStore.getState();
  expect(inspectVideoNode(next.nodes[0], next).issues).toEqual(expect.arrayContaining(['视频时长无效', '参考缺少内容：参考图']));
});
it('detects reference/prompt changes but not canvas movement as stale results', () => {
  const s = useAppStore.getState();
  const fingerprint = videoInputFingerprint(s.nodes[0], s);
  useAppStore.getState().updateNodeDataTransient('v', { videoBatchFingerprint: fingerprint });
  let next = useAppStore.getState();
  expect(inspectVideoNode(next.nodes[0], next).stale).toBe(false);
  const moved = { ...next.nodes[0], position: { x: 500, y: 600 } };
  expect(videoInputFingerprint(moved, next)).toBe(fingerprint);
  useAppStore.getState().updateNodeDataTransient('img', { imageUrl: 'new.png' });
  next = useAppStore.getState();
  expect(inspectVideoNode(next.nodes[0], next).stale).toBe(true);
});
it('inherits project video workflow defaults using the same model contract as generation', () => {
  useAppStore.setState({ projects: [{ id: 'p', name: '集', createdAt: 1, updatedAt: 1, settings: { defaultModels: { video: 'comfyui/my-workflow' } } }] });
  useAppStore.getState().updateNodeDataTransient('v', { model: undefined, provider: undefined, seedanceDuration: undefined });
  const s = useAppStore.getState();
  const result = inspectVideoNode(s.nodes[0], s);
  expect(result.issues).toContain('工作流已删除或未载入');
  expect(result.issues).not.toContain('未选择视频模型');
  expect(result.duration).toBe(5);
});
