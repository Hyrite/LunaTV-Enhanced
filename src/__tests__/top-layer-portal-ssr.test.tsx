/** @jest-environment node */
import { renderToString } from 'react-dom/server';

import TopLayerPortal from '@/components/TopLayerPortal';

test('服务端渲染的 HTML 里内容仍然在原位（首屏马上可见，不依赖 document）', () => {
  const html = renderToString(
    <TopLayerPortal>
      <button>点我</button>
    </TopLayerPortal>
  );
  expect(html).toContain('点我');
});
