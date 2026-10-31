// 进入播放页时立即显示的骨架屏（播放器区域 + 标题信息），避免点击后长时间没有反应
export default function Loading() {
  return (
    <div
      data-route-loading
      role='status'
      aria-label='加载中'
      className='animate-pulse py-4'
    >
      <div className='mb-4 h-6 w-1/2 rounded-lg bg-gray-200 dark:bg-gray-800' />
      <div className='aspect-video w-full rounded-xl bg-gray-200 dark:bg-gray-800' />
      <div className='mt-4 h-4 w-1/3 rounded bg-gray-200 dark:bg-gray-800' />
      <div className='mt-2 h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-800' />
    </div>
  );
}
