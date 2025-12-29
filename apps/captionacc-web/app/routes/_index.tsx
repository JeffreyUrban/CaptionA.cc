import { Link, useLoaderData } from 'react-router'

import { AppLayout } from '~/components/AppLayout'

// Loader function to expose default video ID from environment
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

export default function Home() {
  const { defaultVideoId } = useLoaderData<typeof loader>()
  return (
    <AppLayout>
      <div>
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            Caption Annotation Platform
          </h1>
          <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
            Professional tool for annotating and quality-controlling video captions
          </p>
        </div>

        {/* Quick Stats */}
        <div className="mb-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="overflow-hidden rounded-lg bg-white shadow dark:bg-gray-800">
            <div className="px-4 py-5 sm:p-6">
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Total Annotations
              </dt>
              <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
                0
              </dd>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg bg-white shadow dark:bg-gray-800">
            <div className="px-4 py-5 sm:p-6">
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Pending Review
              </dt>
              <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
                0
              </dd>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg bg-white shadow dark:bg-gray-800">
            <div className="px-4 py-5 sm:p-6">
              <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Completion Rate
              </dt>
              <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
                0%
              </dd>
            </div>
          </div>
        </div>

        {/* Main CTA Card */}
        <div className="overflow-hidden rounded-lg bg-gradient-to-r from-teal-500 to-cyan-600 shadow-xl">
          <div className="px-6 py-12 sm:px-12">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Start Annotating
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-teal-50">
                Review and annotate video captions with our professional annotation interface.
                Navigate frames, mark precise boundaries, and ensure caption quality.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-x-6">
                <Link
                  to={
                    defaultVideoId
                      ? `/annotate/boundaries?videoId=${encodeURIComponent(defaultVideoId)}`
                      : '/annotate/boundaries'
                  }
                  className="rounded-md bg-white px-6 py-3 text-sm font-semibold text-teal-600 shadow-sm hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Mark Caption Boundaries
                </Link>
                <Link
                  to={
                    defaultVideoId
                      ? `/annotate/text?videoId=${encodeURIComponent(defaultVideoId)}`
                      : '/annotate/text'
                  }
                  className="rounded-md bg-white px-6 py-3 text-sm font-semibold text-teal-600 shadow-sm hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Annotate Caption Text
                </Link>
                <a
                  href="#features"
                  className="text-sm font-semibold leading-6 text-white hover:text-teal-50"
                >
                  Learn more <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div id="features" className="mt-16">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            Features
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <div className="relative overflow-hidden rounded-lg bg-white p-6 shadow dark:bg-gray-800">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                Frame-by-Frame Annotation
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Navigate video frames with precision controls. Mark exact start and end points for
                each caption.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="relative overflow-hidden rounded-lg bg-white p-6 shadow dark:bg-gray-800">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                Quality Control
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Mark caption status, add notes, and ensure high-quality annotations with structured
                review workflow.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="relative overflow-hidden rounded-lg bg-white p-6 shadow dark:bg-gray-800">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                Keyboard Shortcuts
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Work efficiently with comprehensive keyboard shortcuts for navigation, marking, and
                saving.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="relative overflow-hidden rounded-lg bg-white p-6 shadow dark:bg-gray-800">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                Multiple Modes
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Choose from random sequence, random time, or CSV-based annotation workflows.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="relative overflow-hidden rounded-lg bg-white p-6 shadow dark:bg-gray-800">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                Dark Mode
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Full dark mode support for comfortable annotation during extended sessions.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="relative overflow-hidden rounded-lg bg-white p-6 shadow dark:bg-gray-800">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                Database Integration
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                SQLite database integration for tracking annotations and managing workflow.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
