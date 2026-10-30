/**
 * modelPreferenceService — 覆盖新建模型优先级、类型回退与损坏偏好的安全降级。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getModelPreferenceType,
  getPreferredNodeModel,
  saveModelPreference,
} from '../../src/services/modelPreferenceService';

const KEY = 'canvas-model-prefs';

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); });

describe('新建节点的模型默认值', () => {
  it.each(['ai-text', 'ai-audio'] as const)('%s 保留完整偏好身份，不挑选第一个通用模型', (type) => {
    localStorage.setItem(KEY, JSON.stringify({ [type]: 'general/second/model' }));
    expect(getPreferredNodeModel(type)).toEqual({ model: 'general/second/model', provider: 'general' });
  });

  it('当前项目默认优先，其他项目的配置不影响本次新建，也不覆盖全局偏好', () => {
    const preference = JSON.stringify({ 'ai-text': 'general/preference' });
    localStorage.setItem(KEY, preference);
    const context = {
      currentProjectId: 'current',
      projects: [
        { id: 'other', settings: { defaultModels: { text: 'general/other' } } },
        { id: 'current', settings: { defaultModels: { text: 'general/project' } } },
      ],
    };
    expect(getPreferredNodeModel('ai-text', context)).toEqual({ model: 'general/project', provider: 'general' });
    expect(getPreferredNodeModel('ai-text', { ...context, currentProjectId: 'missing' }))
      .toEqual({ model: 'general/preference', provider: 'general' });
    expect(localStorage.getItem(KEY)).toBe(preference);
  });

  it('项目默认工作流保留真实 workflowId，动画也采用项目图片默认', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'ai-animation': 'general/remembered-animation' }));
    const context = { currentProjectId: 'project', projects: [
      { id: 'project', settings: { defaultModels: { image: 'comfyui/workflow-1' } } },
    ] };
    expect(getPreferredNodeModel('ai-animation', context)).toEqual({
      model: 'comfyui/workflow', provider: 'comfyui', workflowId: 'workflow-1',
    });
  });

  it.each([
    ['ai-panorama', 'ai-image'], ['ai-animation', 'ai-image'], ['ai-shotlist', 'ai-text'],
    ['source-text', 'ai-text'], ['ai-markdown', 'ai-text'], ['source-audio', 'ai-audio'],
  ] as const)('%s 复用 %s 的目录与兜底偏好', (type, fallback) => {
    localStorage.setItem(KEY, JSON.stringify({ [fallback]: 'general/fallback' }));
    expect(getModelPreferenceType(type)).toBe(fallback);
    expect(getPreferredNodeModel(type)).toEqual({ model: 'general/fallback', provider: 'general' });
  });

  it('独立动画偏好优先于图片兜底；损坏的独立条目不阻断有效兜底', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'ai-animation': 'general/animation', 'ai-image': 'general/image' }));
    expect(getPreferredNodeModel('ai-animation')?.model).toBe('general/animation');
    localStorage.setItem(KEY, JSON.stringify({ 'ai-animation': { model: 'invalid' }, 'ai-image': 'general/image' }));
    expect(getPreferredNodeModel('ai-animation')?.model).toBe('general/image');
  });

  it.each(['null', '[]', 'false', '"general/text"', 'broken-json',
    '{"ai-text":0}', '{"ai-text":"/missing-provider"}', '{"ai-text":"general/"}',
  ])('损坏偏好 %s 不阻断节点创建，也不改写存储', (raw) => {
    localStorage.setItem(KEY, raw);
    expect(getPreferredNodeModel('ai-text')).toBeNull();
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it('偏好读取不可用时仍可使用项目默认；没有项目默认时保持未选', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(getPreferredNodeModel('ai-text')).toBeNull();
    expect(getPreferredNodeModel('ai-text', { currentProjectId: 'p', projects: [
      { id: 'p', settings: { defaultModels: { text: 'general/project' } } },
    ] })).toEqual({ model: 'general/project', provider: 'general' });
  });
});

describe('显式模型偏好的保存', () => {
  it('源类型保存到生成类型，选图片时同步全景而保留独立动画选择', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'ai-animation': 'general/animation', 'ai-audio': 'general/audio' }));
    saveModelPreference('source-image', 'general/image');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      'ai-animation': 'general/animation', 'ai-audio': 'general/audio',
      'ai-image': 'general/image', 'ai-panorama': 'general/image',
    });
  });

  it('损坏旧记录可以重新保存；空选择不清除或重新选择历史偏好', () => {
    localStorage.setItem(KEY, 'null');
    saveModelPreference('ai-text', 'general/text');
    saveModelPreference('ai-text', '');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ 'ai-text': 'general/text' });
  });

  it('偏好写入失败不向模型选择调用方抛错', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(() => saveModelPreference('ai-text', 'general/text')).not.toThrow();
  });
});
