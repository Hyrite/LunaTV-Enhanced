import { render, within } from '@testing-library/react';

import TopLayerPortal from '@/components/TopLayerPortal';

describe('TopLayerPortal', () => {
  beforeEach(() => {
    document.body.className = 'font-inter text-gray-900 dark:text-gray-200 min-h-screen bg-white dark:bg-black';
  });

  test('挂载后把内容移到 <html> 下的容器里（不在 <body> 里），并带上字体和文字颜色 class', () => {
    const { container, unmount } = render(
      <TopLayerPortal>
        <button>点我</button>
      </TopLayerPortal>
    );
    // screen 只在 <body> 里找；内容在 <html> 下的容器里，所以从 <html> 开始找
    const button = within(document.documentElement).getByText('点我');
    const layer = button.parentElement as HTMLElement;
    expect(layer.hasAttribute('data-top-layer')).toBe(true);
    expect(layer.parentElement).toBe(document.documentElement);
    expect(document.body.contains(button)).toBe(false);
    expect(container.contains(button)).toBe(false);
    // 只复制字体和文字颜色，不复制背景和高度
    expect(layer.className).toBe('font-inter text-gray-900 dark:text-gray-200');
    unmount();
    expect(document.querySelector('[data-top-layer]')).toBeNull();
  });
});
