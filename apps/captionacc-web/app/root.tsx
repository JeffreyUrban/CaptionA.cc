// Self-hosted fonts (works in China, better performance)
// Import common Inter weights (300-700 covers most use cases)
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
// Import Instrument Serif for display text
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'

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
} from 'react-router'

import { NotFound, NotFoundProps } from '~/components/NotFound'
import { Providers } from '~/providers'

export const links: LinksFunction = () => []

/**
 * Root loader
 *
 * Note: Auth is client-side only (localStorage) so no user data provided here.
 * Use AuthProvider/useAuth hook to access authentication state in components.
 */
export async function loader() {
  // Set security headers via headers export below
  return {}
}

/**
 * Security headers - prevent XSS attacks
 */
export function headers() {
  // Content Security Policy
  // TODO: Restrict localhost to specific ports in production (currently allows all for dev)
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://banchelabs-gateway.fly.dev",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self' http://localhost:* https://*.supabase.co wss://*.supabase.co https://banchelabs-gateway.fly.dev",
  ].join('; ')

  return {
    'Content-Security-Policy': csp,
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
