import '~/styles/tailwind.css'
import {
  isRouteErrorResponse,
  Meta,
  Links,
  Scripts,
  ScrollRestoration,
  Outlet,
  useRouteError,
  type LinksFunction,
  type LoaderFunctionArgs,
} from 'react-router'

import { NotFound, NotFoundProps } from '~/components/NotFound'
import { Providers } from '~/providers'

export const links: LinksFunction = () => []

/**
 * Root loader - provides auth status to all routes
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const responseHeaders = new Headers()

  // Use SSR-aware Supabase client
  const { createSupabaseServerClient } = await import('~/services/supabase-server')
  const { isPlatformAdmin } = await import('~/services/platform-admin')

  const supabase = createSupabaseServerClient(request, responseHeaders)

  // Get user from session cookie
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Check admin status if user is authenticated
  let isAdmin = false
  if (user) {
    isAdmin = await isPlatformAdmin(user.id)
  }

  return {
    user: user
      ? {
          id: user.id,
          email: user.email,
        }
      : null,
    isPlatformAdmin: isAdmin,
  }
}

export default function App() {
  return (
    <html
      lang="en"
      className="h-full bg-olive-100 dark:bg-olive-950 antialiased"
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@100..900&display=swap"
          rel="stylesheet"
        />
        <title>CaptionA.cc - Caption Annotation Platform</title>
        <script src="/set-theme.js"></script>
        {/* Umami Analytics */}
        {import.meta.env['VITE_UMAMI_WEBSITE_ID'] && import.meta.env['VITE_UMAMI_SRC'] && (
          <script
            defer
            src={import.meta.env['VITE_UMAMI_SRC']}
            data-website-id={import.meta.env['VITE_UMAMI_WEBSITE_ID']}
          />
        )}
      </head>
      <body className="h-full bg-olive-100 dark:bg-olive-950">
        <Providers>
          <Outlet /> {/* This renders the current route */}
        </Providers>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()

  // Initialize props with isRouteError to satisfy NotFoundProps
  let props: NotFoundProps = {
    isRouteError: false, // Default value
    statusText: '',
    message: '',
    data: '',
    stack: '',
  }

  if (isRouteErrorResponse(error)) {
    // Update props for route error
    props = {
      ...props,
      isRouteError: true,
      statusText: `${error.status} ${error.statusText}`,
      data: error.data,
    }
  } else if (error instanceof Error) {
    // Update props for instance of Error
    props = {
      ...props,
      message: error.message,
      stack: error.stack,
    }
  } else {
    // Handle unknown errors
    props = {
      ...props,
      message: 'An unknown error occurred.',
    }
  }

  return (
    <html lang="en" className="h-full bg-olive-100 dark:bg-olive-950">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <title>Error - CaptionA.cc</title>
      </head>
      <body className="h-full bg-olive-100 dark:bg-olive-950">
        <Providers>
          <NotFound {...props} />
        </Providers>
        <Scripts />
      </body>
    </html>
  )
}
