// 路由切换时立即显示的骨架屏：导航栏在 layout 里保持不动，只替换内容区。
// 有了这个 loading 边界，Next.js 预取时会把它缓存下来，点击后不必等服务端就能先给出反馈。
export default function Loading() {
  return (
    <div
      data-route-loading
      role='status'
      aria-label='加载中'
      className='animate-pulse py-4'
    >
      <div className='mb-6 h-7 w-40 rounded-lg bg-gray-200 dark:bg-gray-800' />
      <div className='grid grid-cols-3 gap-x-2 gap-y-6 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-10'>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i}>
            <div className='aspect-[2/3] rounded-lg bg-gray-200 dark:bg-gray-800' />
            <div className='mx-auto mt-2 h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-800' />
          </div>
        ))}
      </div>
    </div>
  );
}
