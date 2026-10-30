/**
 * modelPreferenceService — 统一 UI 新建节点的模型默认值与选择偏好读写。
 * 不读取 Store；项目上下文只由明确的 UI 新建入口传入，不回填已有节点。
 */
import type { CanvasProject, NodeType } from '../types';
import { getGenerationNodeType } from '../utils/nodeGeneration';
import { getProjectModelKind, parseProjectModelRef } from './projectSettingsService';

const MODEL_PREF_KEY = 'canvas-model-prefs';
const MODEL_TYPE_FALLBACK: Partial<Record<NodeType, NodeType>> = {
  'ai-panorama': 'ai-image',
  'ai-animation': 'ai-image',
  'ai-shotlist': 'ai-text',
};

function parseModelPreference(value: unknown): { model: string; provider: string } | null {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) return null;
  return { model: value, provider: value.slice(0, separator) };
}

function readModelPreferences(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(MODEL_PREF_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => (
      parseModelPreference(entry[1]) !== null
    )));
  } catch {
    return {};
  }
}

/** 节点可选模型的能力类别；独立偏好仍优先使用节点自己的类型。 */
export function getModelPreferenceType(nodeType: NodeType): NodeType {
  const generationType = getGenerationNodeType(nodeType);
  return MODEL_TYPE_FALLBACK[generationType] ?? generationType;
}

/** 读取本机偏好，不解析项目配置，也不修改任何节点或持久化记录。 */
export function readNodeModelPreference(nodeType: NodeType): { model: string; provider: string } | null {
  const generationType = getGenerationNodeType(nodeType);
  const preferences = readModelPreferences();
  for (const type of [generationType, nodeType, getModelPreferenceType(nodeType)]) {
    const preferred = parseModelPreference(preferences[type]);
    if (preferred) return preferred;
  }
  return null;
}

/** 仅供 UI 新建入口使用：当前项目默认优先，再使用有效历史偏好。 */
export function getPreferredNodeModel(
  nodeType: NodeType,
  projectContext?: {
    currentProjectId: string | null;
    projects: readonly Pick<CanvasProject, 'id' | 'settings'>[];
  },
): { model: string; provider: string; workflowId?: string } | null {
  const generationType = getGenerationNodeType(nodeType);
  const kind = getProjectModelKind(generationType);
  const settings = projectContext?.projects?.find((project) => project.id === projectContext.currentProjectId)?.settings;
  const projectModel = kind ? parseProjectModelRef(settings?.defaultModels?.[kind]) : null;
  return projectModel ?? readNodeModelPreference(nodeType);
}

/** 只记录用户真实选择；临时模型选择器由调用方决定是否保存。 */
export function saveModelPreference(nodeType: NodeType, model: string): void {
  if (!parseModelPreference(model)) return;
  try {
    const generationType = getGenerationNodeType(nodeType);
    const preferences = readModelPreferences();
    preferences[generationType] = model;
    if (generationType === 'ai-image') preferences['ai-panorama'] = model;
    localStorage.setItem(MODEL_PREF_KEY, JSON.stringify(preferences));
  } catch {
    // 偏好存储不可用时，本次显式模型选择仍由调用方正常提交。
  }
}
