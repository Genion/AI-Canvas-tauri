/** 归档隐私与旧包输入边界；使用真实可移植适配器。 */
import { describe, expect, it } from 'vitest';
import { portableArchiveChat, sanitizeLegacyArchiveProject, selectArchiveAssets } from '../../src/services/projectArchiveValidation';
import { captureExchangeSnapshot } from '../../src/services/projectExchangeDomain';
import type { ProjectSaveData } from '../../src/services/storageService';
import type { ProjectArchiveChatPayload } from '../../src/services/projectTransferService';
import type { ProjectExchangeState } from '../../src/types/projectExchange';

const project = (data: Record<string, unknown> = {}): ProjectSaveData => ({ id: 'root', name: '项目',
  nodes: [{ id: 'node', type: 'source-image', position: { x: 0, y: 0 }, data }], edges: [], groups: [], createdAt: 1, updatedAt: 1 });

describe('项目归档输入与导出边界', () => {
  it.each(['../private.png', '/private.png', 'C:/private.png', 'a/../../private.png', 'a/NUL.png'])('旧包拒绝越界素材引用 %s', (relativePath) => {
    expect(() => sanitizeLegacyArchiveProject(project({ nested: { relativePath } }))).toThrow();
  });
  it('旧包保留正常相对路径，移除本机文件、任务与凭据投影', () => {
    const source = project({ relativePath: '图像/人物.png', filePath: 'C:/private.png', imageUrl: 'asset://localhost/private.png',
      api_key: 'secret', taskId: 'running', status: 'loading', prompt: '人物' });
    const result = sanitizeLegacyArchiveProject(source);
    expect((result.nodes as unknown[])[0]).toMatchObject({ data: { relativePath: '图像/人物.png', status: 'idle', prompt: '人物' } });
    expect(JSON.stringify(result)).not.toMatch(/secret|private\.png|running/);
    expect(() => sanitizeLegacyArchiveProject(project(JSON.parse('{"__proto__":{"polluted":true}}')))).toThrow();
  });
  it('聊天只保留文本和来源，不导出运行工具、文件授权和模型配置', () => {
    const raw = { conversations: [{ id: 'c', title: '讨论', agentMode: 'c', systemPrompt: 'private', modelConfig: { apiKey: 'secret' } }],
      messages: [{ id: 'm', conversationId: 'c', sequence: 1, content: '正文', role: 'assistant', status: 'streaming',
        toolCalls: [{ arguments: { grantId: 'grant', filePath: 'C:/private' } }], agentTaskId: 'task' }],
      memories: [{ id: 'memory', content: '保留事实', kind: 'fact', enabled: true, source: { conversationId: 'c', messageId: 'm', taskId: 'task' } }],
    } as unknown as ProjectArchiveChatPayload;
    const result = portableArchiveChat(raw);
    expect(result.messages[0]).toMatchObject({ content: '正文', status: 'done' });
    expect(result.conversations[0]).toMatchObject({ agentMode: 'plan', messageCount: 1 });
    expect(result.memories[0].source).toMatchObject({ conversationId: 'c', messageId: 'm' });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|grant|toolCalls|taskId|agentTaskId/);
    expect(() => portableArchiveChat({ ...raw, messages: [raw.messages[0], raw.messages[0]] })).toThrow();
  });
  it('恢复点和删除文件留在本机，当前快照的独立同内容文件均可导出', () => {
    const a = { path: '图片/a.png', bytes: 1, sha256: 'a'.repeat(64) }, b = { ...a, path: '图片/b.png' };
    const captured = captureExchangeSnapshot([project({ relativePath: a.path })], [a, b], null);
    const state: ProjectExchangeState = { ownerId: 'root', rootProjectId: 'root', lineageId: captured.snapshot.lineageId,
      headRevisionId: 'b'.repeat(64), stateVersion: 1, identities: captured.identities };
    const recovery = { ...a, path: 'imports/recovery/旧稿.png' }, removed = { ...a, path: 'imports/failed/未提交.png' };
    expect(selectArchiveAssets(captured.snapshot, state, [a, b, recovery, removed]).sort((left, right) => left.path.localeCompare(right.path))).toEqual([a, b]);
    expect(() => selectArchiveAssets(captured.snapshot, state, [a])).toThrow();
    expect(() => selectArchiveAssets(captured.snapshot, state, [{ ...a, sha256: 'c'.repeat(64) }, b])).toThrow();
  });
});
