/**
 * Centralized image registry with type-safe imports
 * All vite-imagetools imports are handled here to avoid TypeScript issues
 *
 * Important:
 * - SVGs are imported as-is (they're already vector graphics, no optimization needed)
 * - Raster images (PNG, JPG) use vite-imagetools for responsive image optimization
 *
 * Add your own images here and import them in your components
 */

import type { ImageOutput } from './imagetools';

// SVG images - import directly without vite-imagetools
import placeholderSvg from '~/assets/images/placeholder.svg';

// Raster images - use vite-imagetools for responsive optimization
// @ts-expect-error - Vite imagetools query parameters not recognized by TypeScript module resolution
import placeholderImg from '~/assets/images/placeholder.jpg?w=400;800;1200&format=webp&as=picture';

// Export organized by category with proper types
export const examples = {
  placeholder: placeholderSvg, // SVG - used as string
  placeholderOptimized: placeholderImg as ImageOutput[], // Raster - optimized with vite-imagetools
};
