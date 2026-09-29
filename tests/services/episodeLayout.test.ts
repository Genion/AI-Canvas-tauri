import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import type { BaseNodeData } from '../../src/types';
import { episodeShotGroups, layoutEpisodeShots, shotVideoNodes } from '../../src/utils/episodeLayout';

function shot(n: number): Node<BaseNodeData>[] {
  const group = `g${n}`;
  return [{ id: group, type: 'group', position: { x: 1000, y: 500 }, data: { type: 'comment', label: `SH${n} 镜头`, groupId: group } },
    ...(['source-image', 'ai-video', 'ai-markdown'] as const).map((type, i) => ({
      id: `${group}-${i}`, parentId: group, type, position: { x: 10, y: 10 },
      data: { type, label: type, output: '原文', seedanceDuration: 6 },
    }))];
}

describe('episode layout', () => {
  it('uses numeric shot order and a full width note without changing data or membership', () => {
    const original = [shot(10), shot(2), shot(1), shot(3)].flat();
    const result = layoutEpisodeShots(original);
    expect(result.groupIds).toEqual(['g1', 'g2', 'g3', 'g10']);
    expect(result.nodes.find((n) => n.id === 'g1-0')?.position).toEqual({ x: 36, y: 72 });
    expect(result.nodes.find((n) => n.id === 'g1-1')?.position).toEqual({ x: 356, y: 72 });
    expect(result.nodes.find((n) => n.id === 'g1-2')).toMatchObject({ position: { x: 36, y: 547 }, width: 560 });
    for (const n of result.nodes) {
      const old = original.find((v) => v.id === n.id)!;
      expect(n.parentId).toBe(old.parentId);
      expect(n.data.output).toBe(old.data.output);
      expect(n.data.seedanceDuration).toBe(old.data.seedanceDuration);
    }
    expect(original[1].position.x).toBe(10);
    const again = layoutEpisodeShots(result.nodes);
    expect(again.nodes).toEqual(result.nodes);
  });
  it('expands rows for long text and clears unrelated obstacles without moving them', () => {
    const nodes = [...shot(1), ...shot(2), ...shot(3), ...shot(4)];
    nodes.find((n) => n.id === 'g1-2')!.data.output = '很长的台词\n'.repeat(45);
    const unrelated: Node<BaseNodeData> = { id: 'assets', position: { x: 1500, y: 500 }, data: { type: 'comment', label: '资料' }, style: { width: 600, height: 800 } };
    const result = layoutEpisodeShots([...nodes, unrelated]);
    expect(result.nodes.find((n) => n.id === 'assets')).toBe(unrelated);
    const first = result.nodes.find((n) => n.id === 'g1')!;
    const next = result.nodes.find((n) => n.id === 'g4')!;
    expect(first.position.x).toBeGreaterThan(2100);
    expect(next.position.y).toBeGreaterThanOrEqual(first.position.y + first.height! + 48);
  });
  it('only arranges selected expanded groups, leaving shared and folded nodes intact', () => {
    const nodes = [...shot(1), ...shot(2)];
    const result = layoutEpisodeShots(nodes, ['g1-1']);
    expect(result.groupIds).toEqual(['g1']);
    expect(result.nodes.find((n) => n.id === 'g2')).toBe(nodes[4]);
    nodes[0].data.groupCollapsed = true;
    expect(layoutEpisodeShots(nodes, ['g1']).groupIds).toEqual([]);
  });
  it('batch selection contains only videos from shot groups, never shared assets or tests', () => {
    const nodes = [...shot(2), ...shot(1), { ...shot(9)[1], id: 'independent', parentId: undefined, type: 'ai-video', data: { type: 'ai-video' as const, label: '独立测试' } }];
    expect(episodeShotGroups(nodes)).toHaveLength(2);
    expect(shotVideoNodes(nodes).map((n) => n.id)).toEqual(['g1-1', 'g2-1']);
    expect(shotVideoNodes(nodes, ['g2']).map((n) => n.id)).toEqual(['g2-1']);
    expect(shotVideoNodes(nodes, ['independent']).map((n) => n.id)).toEqual(['independent']);
    expect(shotVideoNodes(nodes, [])).toEqual([]);
  });
});
