// Helper function to extract image source from vite-imagetools output
export function getImageSrc(image: string | string[] | {src: string}[] | unknown): string {
    // Handle direct string (e.g., SVG)
    if (typeof image === 'string') {
        return image
    }

    // Handle array of sources (vite-imagetools output)
    if (Array.isArray(image)) {
        // If it's an array of objects with src property, return the first one
        if (image.length > 0 && typeof image[0] === 'object' && image[0] !== null && 'src' in image[0]) {
            return (image[0] as {src: string}).src
        }
        // If it's an array of strings, return the first one
        if (image.length > 0 && typeof image[0] === 'string') {
            return image[0]
        }
    }

    // Handle object with src property
    if (typeof image === 'object' && image !== null && 'src' in image) {
        return (image as {src: string}).src
    }

    // Fallback to empty string
    return ''
}
