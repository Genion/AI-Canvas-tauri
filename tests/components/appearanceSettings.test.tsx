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
});
