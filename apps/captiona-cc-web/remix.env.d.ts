/// <reference types="@react-router/node" />
/// <reference types="vite/client" />

declare module '*.mdx' {
  let MDXComponent: (props: Record<string, unknown>) => JSX.Element
  export const frontmatter: Record<string, unknown>
  export default MDXComponent
}
