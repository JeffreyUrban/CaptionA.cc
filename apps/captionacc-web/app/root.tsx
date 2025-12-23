import '~/styles/tailwind.css';
import type { LinksFunction } from "react-router";
import {
    isRouteErrorResponse,
    Meta,
    Links,
    Scripts,
    ScrollRestoration,
    Outlet,
    useRouteError,
} from "react-router";

import { Providers } from '~/providers';
import { NotFound, NotFoundProps } from '~/components/NotFound';


export const links: LinksFunction = () => [];

export default function App() {
    return (
        <html lang="en" className="h-full bg-white dark:bg-gray-950 antialiased" suppressHydrationWarning>
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <Meta />
                <Links />
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <title>CaptionA.cc - Caption Annotation Platform</title>
                <script src="/set-theme.js"></script>
            </head>
            <body className="h-full">
                <Providers>
                    <Outlet /> {/* This renders the current route */}
                </Providers>
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();

    // Initialize props with isRouteError to satisfy NotFoundProps
    let props: NotFoundProps = {
        isRouteError: false, // Default value
        statusText: '',
        message: '',
        data: '',
        stack: ''
    };

    if (isRouteErrorResponse(error)) {
        // Update props for route error
        props = {
            ...props,
            isRouteError: true,
            statusText: `${error.status} ${error.statusText}`,
            data: error.data,
        };
    } else if (error instanceof Error) {
        // Update props for instance of Error
        props = {
            ...props,
            message: error.message,
            stack: error.stack,
        };
    } else {
        // Handle unknown errors
        props = {
            ...props,
            message: "An unknown error occurred.",
        };
    }

    return (
        <html lang="en" className="h-full bg-white dark:bg-gray-950">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <Meta />
                <Links />
                <title>Error - CaptionA.cc</title>
            </head>
            <body className="h-full">
                <Providers>
                    <NotFound {...props} />
                </Providers>
                <Scripts />
            </body>
        </html>
    );
}

