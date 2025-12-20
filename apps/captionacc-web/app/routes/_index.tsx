import {Container} from '~/components/Container'
import {Link} from 'react-router'
import {examples} from '~/lib/images'
import {getImageSrc} from '~/lib/imagetools'

export default function Home() {
    const placeholderSrc = getImageSrc(examples.placeholderOptimized)

    return (
        <>
            <Container className="mt-9">
                <div className="max-w-2xl">
                    <h1 className="text-4xl font-bold tracking-tight text-zinc-800 sm:text-5xl dark:text-zinc-100">
                        Welcome to Your New Site
                    </h1>
                    <p className="mt-6 text-base text-zinc-600 dark:text-zinc-400">
                        This is a minimal React Router template with Tailwind CSS, dark mode support,
                        and a beautiful responsive layout. Start by editing this page to create your own content.
                    </p>

                    {/* Image Optimization Demo - Active Use */}
                    <div className="mt-12">
                        <h2 className="text-2xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                            Image Optimization
                        </h2>
                        <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">
                            Images are automatically optimized with <code className="rounded bg-zinc-100 px-2 py-1 text-sm dark:bg-zinc-800">vite-imagetools</code>.
                            This example image is generated in multiple sizes and formats:
                        </p>
                        <div className="mt-6 overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                            <img
                                src={placeholderSrc}
                                alt="Placeholder demonstrating optimization"
                                className="w-full"
                            />
                        </div>
                        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                            Imported with: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                            ?w=400;800;1200&format=webp
                        </code>
                        </p>
                    </div>

                    {/* Typography Demo - Active Use with prose classes */}
                    <div className="mt-12">
                        <h2 className="text-2xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                            Typography Plugin
                        </h2>
                        <div className="mt-4 prose dark:prose-invert prose-zinc max-w-none">
                            <p>
                                The <code>@tailwindcss/typography</code> plugin provides beautiful default styles
                                for prose content. This section uses the <code>prose</code> classes to automatically
                                style all content within.
                            </p>
                            <h3>Perfect for Content</h3>
                            <p>
                                Whether you&apos;re building a blog, documentation site, or any content-rich application,
                                the typography plugin handles all the styling details:
                            </p>
                            <ul>
                                <li>Headings with proper hierarchy and spacing</li>
                                <li>Paragraphs with optimal line height and measure</li>
                                <li>Lists with appropriate indentation</li>
                                <li>Code blocks and inline code</li>
                                <li>Blockquotes and emphasis</li>
                            </ul>
                            <blockquote>
                                <p>
                                    The typography plugin makes it easy to create beautiful, readable content
                                    without writing custom CSS for every element.
                                </p>
                            </blockquote>
                        </div>
                    </div>

                    {/* MDX Demo - Active Link */}
                    <div className="mt-12">
                        <h2 className="text-2xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                            MDX Support
                        </h2>
                        <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">
                            Write content in <code className="rounded bg-zinc-100 px-2 py-1 text-sm dark:bg-zinc-800">
                            .mdx
                        </code> files to combine Markdown with React components.
                        </p>
                        <div className="mt-6 rounded-2xl border border-zinc-100 p-6 dark:border-zinc-700/40">
                            <p className="text-base text-zinc-600 dark:text-zinc-400">
                                <strong className="text-zinc-900 dark:text-zinc-100">See it in action:</strong>
                                {' '}Check out the{' '}
                                <Link
                                    to="/example"
                                    className="font-medium text-teal-500 hover:text-teal-600 dark:text-teal-400 dark:hover:text-teal-300"
                                >
                                    MDX example page
                                </Link>
                                {' '}to see live MDX content with prose styling.
                            </p>
                        </div>
                    </div>

                    {/* Feature List */}
                    <div className="mt-12">
                        <h2 className="text-2xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                            What&apos;s Included
                        </h2>
                        <ul className="mt-4 list-disc list-inside text-base text-zinc-600 dark:text-zinc-400 space-y-2">
                            <li>React Router 7 with file-based routing and automatic route discovery</li>
                            <li>Tailwind CSS 4 with custom typography</li>
                            <li>TypeScript for full type safety</li>
                            <li>Dark mode with built-in theme support</li>
                            <li>Image optimization with vite-imagetools</li>
                            <li>MDX support for content</li>
                            <li>Testing setup with Vitest and React Testing Library</li>
                            <li>ESLint, Prettier, and pre-commit hooks</li>
                            <li>Responsive design that works on all devices</li>
                            <li>Deployment ready with Dockerfile and Fly.io configuration</li>
                            <li>Automated dependency updates with Renovate</li>
                            <li>MIT licensed - free to use for any project</li>
                            <li>Comprehensive customization instructions</li>
                        </ul>
                    </div>

                    {/* Getting Started */}
                    <div className="mt-8 rounded-2xl border border-zinc-100 p-6 dark:border-zinc-700/40">
                        <h2 className="text-xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                            Ready to Start Building?
                        </h2>
                        <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
                            Check the README for detailed instructions on customization, optional packages,
                            and deployment. All the features above are actively working—no setup required!
                        </p>
                    </div>
                </div>
            </Container>
        </>
    )
}
