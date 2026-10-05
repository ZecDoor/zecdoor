import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/**
 * Static export served by the Worker at /docs on the same domain as the landing and the app.
 * basePath keeps every asset under /docs/_next, so it never collides with the landing's /_next.
 * @type {import('next').NextConfig}
 */
const config = {
  output: 'export',
  basePath: '/docs',
  trailingSlash: false,
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default withMDX(config);
