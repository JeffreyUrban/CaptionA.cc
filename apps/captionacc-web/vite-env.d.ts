/// <reference types="vite/client" />

// Image output type from vite-imagetools
interface ImageToolsOutput {
  src: string;
  w: number;
  h?: number;
}

// All image imports return ImageToolsOutput arrays (for vite-imagetools)
// Plain imports
declare module '*.jpg' {
  const outputs: ImageToolsOutput[];
  export default outputs;
}

declare module '*.jpeg' {
  const outputs: ImageToolsOutput[];
  export default outputs;
}

declare module '*.png' {
  const outputs: ImageToolsOutput[];
  export default outputs;
}

declare module '*.webp' {
  const outputs: ImageToolsOutput[];
  export default outputs;
}

declare module '*.gif' {
  const outputs: ImageToolsOutput[];
  export default outputs;
}

// Imports with imagetools query parameters
declare module '*?w=*&format=webp' {
  const outputs: ImageToolsOutput[];
  export default outputs;
}

declare module '*?w=*' {
  const outputs: ImageToolsOutput[];
  export default outputs;
}

// SVGs are imported as strings
declare module '*.svg' {
  const src: string;
  export default src;
}
