import { act, fireEvent, render } from '@testing-library/react';

import QueuedImage, { __resetImageQueue } from '@/components/QueuedImage';

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let observers: Array<{ cb: IOCallback; disconnected: boolean }> = [];

beforeEach(() => {
  __resetImageQueue();
  observers = [];
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    entry: { cb: IOCallback; disconnected: boolean };
    constructor(cb: IOCallback) {
      this.entry = { cb, disconnected: false };
      observers.push(this.entry);
    }
    observe() {}
    disconnect() {
      this.entry.disconnected = true;
    }
  };
});

const showAll = () => act(() => observers.filter((o) => !o.disconnected).forEach((o) => o.cb([{ isIntersecting: true }])));
const withSrc = (container: HTMLElement) => [...container.querySelectorAll('img')].filter((i) => i.getAttribute('src'));

describe('QueuedImage', () => {
  test('同一时间最多 4 张图片在下载，其余排队，一张完成后下一张开始', () => {
    const { container } = render(
      <div>
        {Array.from({ length: 8 }, (_, i) => (
          <QueuedImage key={i} src={`https://cms.test/${i}.jpg`} alt={`p${i}`} />
        ))}
      </div>
    );
    expect(withSrc(container)).toHaveLength(0); // 还没进入视口，不下载
    showAll();
    expect(withSrc(container)).toHaveLength(4);
    fireEvent.load(withSrc(container)[0]);
    expect(withSrc(container)).toHaveLength(5);
    // 失败也会释放名额
    fireEvent.error(withSrc(container)[1]);
    expect(withSrc(container)).toHaveLength(6);
  });

  test('卸载时取消正在下载的图片并让排队的继续', () => {
    const first = render(
      <div>
        {Array.from({ length: 4 }, (_, i) => (
          <QueuedImage key={i} src={`https://cms.test/a${i}.jpg`} alt='a' />
        ))}
      </div>
    );
    const second = render(<QueuedImage src='https://cms.test/b.jpg' alt='b' />);
    showAll();
    expect(withSrc(first.container)).toHaveLength(4);
    expect(withSrc(second.container)).toHaveLength(0); // 排队中
    const loading = withSrc(first.container)[0];
    first.unmount();
    expect(loading.getAttribute('src')).toBeNull(); // 下载被取消
    expect(withSrc(second.container)).toHaveLength(1); // 排队的图片拿到名额
  });

  test('下载超时后取消并释放名额', () => {
    jest.useFakeTimers();
    try {
      const { container } = render(
        <div>
          {Array.from({ length: 5 }, (_, i) => (
            <QueuedImage key={i} src={`https://slow.test/${i}.jpg`} alt='s' />
          ))}
        </div>
      );
      showAll();
      expect(withSrc(container)).toHaveLength(4);
      act(() => {
        jest.advanceTimersByTime(12000);
      });
      // 前 4 张超时被取消，第 5 张拿到名额开始下载
      expect(withSrc(container)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
