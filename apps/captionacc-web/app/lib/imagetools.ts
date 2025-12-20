/**
 * Utility functions for working with vite-imagetools
 */

export interface ImageOutput {
  src: string;
  w: number;
  h?: number;
}

/**
 * Generate srcSet string from imagetools output
 */
export function generateSrcSet(images: ImageOutput[] | string): string | undefined {
  if (typeof images === 'string') {
    return undefined;
  }

  if (!Array.isArray(images) || images.length === 0) {
    return undefined;
  }

  // Check if array contains objects or strings
  const firstItem = images[0];

  // If it's an array of objects with src and w properties
  if (typeof firstItem === 'object' && firstItem !== null && 'src' in firstItem && 'w' in firstItem) {
    return images
      .map((img) => `${img.src} ${img.w}w`)
      .join(', ');
  }

  // If it's an array of URL strings, we can't generate srcSet without width info
  // Just return undefined and let the browser use the single src
  return undefined;
}

/**
 * Get the main image src from imagetools output
 * Returns undefined if no valid image is found (prevents empty src attributes)
 */
export function getImageSrc(images: ImageOutput[] | string | undefined): string | undefined {
  if (!images) {
    return undefined;
  }

  if (typeof images === 'string') {
    return images;
  }

  if (!Array.isArray(images) || images.length === 0) {
    return undefined;
  }

  // Handle both formats: array of objects or array of strings
  const lastImage = images[images.length - 1];

  // If it's an object with src property, return src
  if (typeof lastImage === 'object' && lastImage !== null && 'src' in lastImage) {
    return lastImage.src || undefined;
  }

  // If it's a string (direct URL), return it
  if (typeof lastImage === 'string') {
    return lastImage;
  }

  return undefined;
}

/**
 * Generate a default sizes attribute for responsive images
 * Useful for gallery/grid layouts
 */
export function getDefaultSizes(): string {
  return '(min-width: 1024px) 20vw, (min-width: 768px) 33vw, 50vw';
}

/**
 * Convert imagetools output to Photo format
 */
export function imagetoolsToPhoto(
  images: ImageOutput[] | string,
  link?: string
): {
  image: string | undefined;
  srcSet?: string;
  sizes?: string;
  link?: string;
} {
  const image = getImageSrc(images);
  const srcSet = generateSrcSet(images);

  const result: {
    image: string | undefined;
    srcSet?: string;
    sizes?: string;
    link?: string;
  } = { image };

  if (srcSet) {
    result.srcSet = srcSet;
    result.sizes = getDefaultSizes();
  }

  if (link) {
    result.link = link;
  }

  return result;
}
