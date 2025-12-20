import { ReactNode } from 'react';
import { Meta, Links, Scripts, ScrollRestoration } from 'react-router';
import { Providers } from '~/providers';
import { Layout } from '~/components/Layout';

type CommonLayoutProps = {
    children: ReactNode;
};

export function CommonLayout({ children }: CommonLayoutProps) {
    return (
        <html lang="en" className="h-full antialiased" suppressHydrationWarning>
        <head>
            <meta charSet="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <Meta />
            <Links />
            <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
            <title>My Site</title>
            <script src="/set-theme.js"></script>
        </head>
        <body className="flex h-full bg-zinc-50 dark:bg-black">
        <Providers>
            <div className="flex w-full">
                <Layout>{children}</Layout>
            </div>
        </Providers>
        <ScrollRestoration />
        <Scripts />
        </body>
        </html>
    );
}
