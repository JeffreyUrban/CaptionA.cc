import path from 'path'

import mdx from '@mdx-js/rollup'
import { reactRouter } from '@react-router/dev/vite'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'
import { imagetools } from 'vite-imagetools'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig(({ mode }) => ({
  envDir: path.resolve(__dirname, '../..'), // Load .env from monorepo root
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './app'),
    },
  },
  ssr: {
    // Externalize canvas module for SSR - it's a native Node.js module
    external: ['canvas'],
  },
  build: {
    rollupOptions: {
      // Only externalize canvas for SSR builds, not client builds
      external: id => {
        if (id === 'canvas') {
          return true
        }
        return false
      },
    },
  },
  plugins: [
    imagetools(), // Must come first to process image imports
    mdx({
      remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
    }),
    reactRouter(),
    tsconfigPaths(),
    // Bundle analyzer - only in production builds when ANALYZE=true
    mode === 'production' &&
      process.env['ANALYZE'] === 'true' &&
      visualizer({
        filename: './build/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),
}))
