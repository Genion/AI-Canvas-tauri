import type { Node } from '@xyflow/react';
import type { BaseNodeData } from '../types';

type CanvasNode = Node<BaseNodeData>;
const shotNumber = (label: string) => /(?:^|[^a-z])SH0*(\d+)/i.exec(label)?.[1];
const imageTypes = new Set(['source-image', 'ai-image', 'ai-storyboard']);
const textTypes = new Set(['ai-markdown', 'source-text', 'ai-text']);

/** Shot groups must be explicit: do not mistake shared assets or tests for shots. */
export function episodeShotGroups(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter((group) => group.type === 'group' && !group.parentId
    && (shotNumber(group.data.label || '') !== undefined
      || nodes.some((n) => n.parentId === group.id && n.data.shotlistProductionSource?.kind === 'video')))
    .sort((a, b) => Number(shotNumber(a.data.label || '') ?? Infinity)
      - Number(shotNumber(b.data.label || '') ?? Infinity)
      || a.position.y - b.position.y || a.position.x - b.position.x);
}

export function shotVideoNodes(nodes: CanvasNode[], selected?: string[]): CanvasNode[] {
  const groups = episodeShotGroups(nodes);
  const ids = selected ? new Set(selected) : null;
  const groupIds = new Set(groups.filter((g) => !ids || ids.has(g.id)
    || nodes.some((n) => n.parentId === g.id && ids.has(n.id))).map((g) => g.id));
  return nodes.filter((n) => n.data.type === 'ai-video'
    && ((n.parentId && groupIds.has(n.parentId)) || ids?.has(n.id)))
    .sort((a, b) => {
      const ag = groups.find((g) => g.id === a.parentId);
      const bg = groups.find((g) => g.id === b.parentId);
      return Number(shotNumber(ag?.data.label || a.data.label) ?? Infinity)
        - Number(shotNumber(bg?.data.label || b.data.label) ?? Infinity)
        || (a.data.displayId ?? Infinity) - (b.data.displayId ?? Infinity);
    });
}

function size(node: CanvasNode) {
  return { width: Number(node.style?.width) || node.data.nodeWidth || node.measured?.width || 280,
    height: Number(node.style?.height) || node.data.nodeHeight || node.measured?.height || 180 };
}

function resize(node: CanvasNode, x: number, y: number, width: number, height: number): CanvasNode {
  return { ...node, position: { x, y }, width, height, measured: undefined,
    style: { ...node.style, width, height },
    data: { ...node.data, nodeWidth: width, nodeHeight: height,
      ...(shotNumber(node.data.label || '') !== undefined && node.type !== 'group' ? { displayLabel: node.data.label } : {}) } };
}

/** Pure layout; group identities, content, file references and membership are unchanged. */
export function layoutEpisodeShots(nodes: CanvasNode[], selected?: string[], columns = 3) {
  const selectedIds = selected && new Set(selected);
  const candidates = episodeShotGroups(nodes).filter((g) => !selectedIds || selectedIds.has(g.id)
    || nodes.some((n) => n.parentId === g.id && selectedIds.has(n.id)));
  const groups = candidates.filter((g) => !g.data.groupCollapsed
    && !nodes.some((n) => n.parentId === g.id && n.type === 'group'));
  if (!groups.length) return { nodes, groupIds: [], skipped: candidates.length };
  const groupIds = new Set(groups.map((g) => g.id));
  const updates = new Map<string, CanvasNode>();
  const heights = new Map<string, number>();
  for (const group of groups) {
    const children = nodes.filter((n) => n.parentId === group.id);
    const images = children.filter((n) => imageTypes.has(n.data.type));
    const videos = children.filter((n) => n.data.type === 'ai-video' || n.data.type === 'source-video');
    const texts = children.filter((n) => textTypes.has(n.data.type));
    const placed = new Set([...images, ...videos, ...texts].map((n) => n.id));
    let y = 72;
    for (let row = 0; row < Math.max(images.length, videos.length); row++) {
      if (images[row]) updates.set(images[row].id, resize(images[row], 36, y, 240, 427));
      if (videos[row]) updates.set(videos[row].id, resize(videos[row], 356, y, 240, 427));
      y += 475;
    }
    for (const text of texts) {
      const content = text.data.output || text.data.prompt || '';
      const lines = content.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 38)), 0);
      const height = Math.min(900, Math.max(268, 65 + lines * 21));
      updates.set(text.id, resize(text, 36, y, 560, height));
      y += height + 24;
    }
    for (const other of children.filter((n) => !placed.has(n.id))) {
      const { width, height } = size(other);
      updates.set(other.id, resize(other, 36, y, Math.min(560, width), height));
      y += height + 24;
    }
    heights.set(group.id, Math.max(200, y + 12));
  }
  const cols = Math.max(1, Math.min(4, Math.floor(columns) || 3));
  let originX = Math.min(...groups.map((g) => g.position.x));
  const originY = Math.min(...groups.map((g) => g.position.y));
  let totalHeight = 0;
  for (let i = 0; i < groups.length; i += cols) totalHeight += Math.max(...groups.slice(i, i + cols).map((g) => heights.get(g.id)!)) + 48;
  const gridWidth = Math.min(cols, groups.length) * 680 - 48;
  // Move the whole block past obstacles, never move unrelated notes/assets/groups.
  const obstacles = nodes.filter((n) => !n.parentId && !groupIds.has(n.id) && !n.hidden);
  for (let attempt = 0; attempt <= obstacles.length; attempt++) {
    const hits = obstacles.filter((n) => {
      const s = size(n);
      return originX < n.position.x + s.width && originX + gridWidth > n.position.x
        && originY < n.position.y + s.height && originY + totalHeight > n.position.y;
    });
    if (!hits.length) break;
    originX = Math.max(...hits.map((n) => n.position.x + size(n).width)) + 80;
  }
  let rowY = originY;
  for (let i = 0; i < groups.length; i += cols) {
    const row = groups.slice(i, i + cols);
    row.forEach((g, col) => updates.set(g.id, resize(g, originX + col * 680, rowY, 632, heights.get(g.id)!)));
    rowY += Math.max(...row.map((g) => heights.get(g.id)!)) + 48;
  }
  return { nodes: nodes.map((n) => updates.get(n.id) ?? n), groupIds: [...groupIds], skipped: candidates.length - groups.length };
}
