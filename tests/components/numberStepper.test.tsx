import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useRef: <T,>(value: T) => ({ current: value }),
  useEffect: (callback: () => void | (() => void)) => hooks.effects.push(callback),
  useState: <T,>(initial: T) => {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (next: T | ((value: T) => T)) => {
        hooks.states[index] = typeof next === 'function' ? (next as (value: T) => T)(hooks.states[index] as T) : next;
      },
    ];
  },
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import NumberStepper from '../../src/components/shared/NumberStepper';

interface ElementLike {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function elements(node: unknown): ElementLike[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as ElementLike;
  return [element, ...elements(element.props.children)];
}

describe('NumberStepper component', () => {
  beforeEach(() => {
    hooks.states = [];
    hooks.cursor = 0;
    hooks.effects = [];
  });

  it('renders static HTML markup with value, unit, and stepper buttons', () => {
    const html = renderToStaticMarkup(
      <NumberStepper value={40} onChange={vi.fn()} unit="px" />
    );

    expect(html).toContain('ui-stepper');
    expect(html).toContain('value="40"');
    expect(html).toContain('ui-stepper__unit');
    expect(html).toContain('px');
    expect(html).toContain('ui-stepper__btn--up');
    expect(html).toContain('ui-stepper__btn--down');
  });

  it('renders small and large size variants', () => {
    const smHtml = renderToStaticMarkup(
      <NumberStepper value={24} onChange={vi.fn()} size="sm" />
    );
    expect(smHtml).toContain('ui-stepper--sm');

    hooks.states = [];
    hooks.cursor = 0;
    const lgHtml = renderToStaticMarkup(
      <NumberStepper value={100} onChange={vi.fn()} size="lg" />
    );
    expect(lgHtml).toContain('ui-stepper--lg');
  });

  it('handles disabled state in markup', () => {
    const html = renderToStaticMarkup(
      <NumberStepper value={40} onChange={vi.fn()} disabled />
    );
    expect(html).toContain('is-disabled');
    expect(html).toContain('disabled=""');
  });

  it('invokes buttons and keyboard handlers on JSX element tree', () => {
    const onChange = vi.fn();
    const tree = NumberStepper({
      value: 40,
      onChange,
      min: 0,
      max: 100,
      step: 1,
      shiftMultiplier: 10,
      unit: 'px',
    });

    const all = elements(tree);
    const upBtn = all.find((el) => typeof el.props.className === 'string' && el.props.className.includes('ui-stepper__btn--up'));
    expect(upBtn).toBeDefined();

    // Trigger pointerDown on up button
    if (upBtn?.props.onPointerDown) {
      (upBtn.props.onPointerDown as (e: unknown) => void)({ shiftKey: false });
      expect(onChange).toHaveBeenCalledWith(41);

      (upBtn.props.onPointerDown as (e: unknown) => void)({ shiftKey: true });
      expect(onChange).toHaveBeenCalledWith(50);
    }

    // Trigger keyboard down arrow
    const input = all.find((el) => el.type === 'input');
    expect(input).toBeDefined();
    if (input?.props.onKeyDown) {
      (input.props.onKeyDown as (e: unknown) => void)({
        key: 'ArrowDown',
        shiftKey: false,
        preventDefault: vi.fn(),
      });
      expect(onChange).toHaveBeenCalledWith(39);
    }
  });
});
