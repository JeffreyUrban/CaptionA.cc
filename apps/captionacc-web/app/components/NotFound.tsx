import React from 'react';
import { Button } from './Button';
import { Container } from './Container';

export type NotFoundProps = {
    isRouteError: boolean;
    statusText?: string | undefined;
    message?: string | undefined;
    data?: React.ReactNode | undefined;
    stack?: string | undefined;
};

export function NotFound({ isRouteError, statusText, message, data, stack }: NotFoundProps) {
    return (
        <Container className="flex h-full items-center justify-center pt-16 sm:pt-32">
            <div className="flex flex-col items-center">
                {isRouteError ? (
                    <>
                        <h1 className="text-4xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                            {statusText}
                        </h1>
                        <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">{data}</p>
                    </>
                ) : (
                    <>
                        <h1 className="text-4xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">
                            Error
                        </h1>
                        <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">{message}</p>
                        {stack && (
                            <>
                                <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">The stack trace is:</p>
                                <pre className="p-4 bg-zinc-200 dark:bg-zinc-700">{stack}</pre>
                            </>
                        )}
                    </>
                )}
                <Button to="/" variant="secondary" className="mt-4">
                    Go back home
                </Button>
            </div>
        </Container>
    );
}
