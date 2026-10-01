import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppState } from '../../src/store/useAppStore';
import { createBuiltinAppearanceThemes } from '../../src/services/appearance/appearanceDefaults';

const driver = vi.hoisted(() => ({ state: {} as AppState }));
vi.mock('../../src/store/useAppStore', () => ({
  useAppStore: (selector: (state: AppState) => unknown) => selector(driver.state),
}));
vi.mock('../../src/i18n', () => ({ useT: () => (value: string) => value }));
vi.mock('../../src/services/fileService', () => ({ saveBinaryToLocalFile: vi.fn() }));
vi.mock('../../src/components/shared/ModalOverlay', () => ({ default: () => null }));

import AppearanceSettings from '../../src/components/settings/AppearanceSettings';

describe('appearance settings rendering', () => {
  it.each(createBuiltinAppearanceThemes())('opens the $name preset without a render error', (theme) => {
    driver.state = {
      config: { providers: {}, theme: theme.mode, appearance: theme },
      appearanceThemes: createBuiltinAppearanceThemes(),
    } as AppState;
    const markup = renderToStaticMarkup(<AppearanceSettings />);
    expect(markup).toContain('appearance-settings-view');
    expect(markup).toContain('connection-handles-settings');
  });

  it('renders single node preview with real canvas nodes when available', () => {
    driver.state = {
      config: { providers: {}, theme: 'dark' },
      appearanceThemes: createBuiltinAppearanceThemes(),
      nodes: [
        {
          id: 'test-node-1',
          type: 'ai-image',
          data: { label: '我的自定义图片节点', prompt: '赛博朋克城市夜景', displayId: 42 },
          position: { x: 0, y: 0 },
        },
      ],
    } as unknown as AppState;

    const markup = renderToStaticMarkup(<AppearanceSettings />);
    expect(markup).toContain('我的自定义图片节点');
    expect(markup).toContain('#42');
  });

  it('renders fallback blank node templates when canvas is empty', () => {
    driver.state = {
      config: { providers: {}, theme: 'dark' },
      appearanceThemes: createBuiltinAppearanceThemes(),
      nodes: [],
    } as unknown as AppState;

    const markup = renderToStaticMarkup(<AppearanceSettings />);
    expect(markup).toContain('生成图像');
  });

  it('renders solar-system preset with dark background and solar planet in the card background', () => {
    driver.state = {
      config: { providers: {}, theme: 'dark' },
      appearanceThemes: createBuiltinAppearanceThemes(),
      nodes: [
        {
          id: 'test-node-1',
          type: 'ai-image',
          data: { label: '我的画布图片节点', prompt: '花园美景', displayId: 17 },
          position: { x: 0, y: 0 },
        },
      ],
    } as unknown as AppState;

    const markup = renderToStaticMarkup(<AppearanceSettings />);
    // Must NOT contain the old blue radial gradient
    expect(markup).not.toContain('rgba(99, 102, 241, 0.28)');
    // Must render the starry background
    expect(markup).toContain('solar-stars');
    // Must render a solar planet image in the background with planet alt name (like 地球, 木星, 土星, etc.)
    expect(markup).toMatch(/alt="(地球|木星|土星|火星|水星|金星|天王星|海王星)"/);
    // Node itself should preserve canvas node's actual label/displayId
    expect(markup).toContain('我的画布图片节点');
    expect(markup).toContain('#17');
  });
});
