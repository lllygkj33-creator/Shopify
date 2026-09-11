/**
 * 占位品牌标记（placeholder brand mark）。
 *
 * 仓库是通用版，所以这里放一个中性的几何字形，**不含任何真实品牌资产**。
 * 部署时换成自己的 logo：把下面的 `<path d="...">` 换成你的 SVG 路径即可，
 * 或者改 `src/config/site.ts` 的 `site.brandLogo` 指向自己的组件。
 *
 * 约定：用 `currentColor` 而非固定色 —— 侧边栏的标识块本身有主题色背景，
 * 固定色在深色主题下会出现「深字压深底」看不清的情况。
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path
        d='M12 2.5 21 7.5v9L12 21.5 3 16.5v-9L12 2.5Z'
        stroke='currentColor'
        strokeWidth='1.6'
        strokeLinejoin='round'
      />
      <path
        d='M7.5 9.5 12 12l4.5-2.5M12 12v5'
        stroke='currentColor'
        strokeWidth='1.6'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
