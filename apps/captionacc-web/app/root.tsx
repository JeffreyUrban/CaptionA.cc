import '~/styles/tailwind.css';
import type { LinksFunction } from "react-router";
import {
    isRouteErrorResponse,
    Outlet,
    useRouteError,
} from "react-router";

import { CommonLayout } from '~/components/CommonLayout';
import { NotFound, NotFoundProps } from '~/components/NotFound';


export const links: LinksFunction = () => [];

export default function App() {
    return (
        <CommonLayout>
            <Outlet /> {/* This renders the current route */}
        </CommonLayout>
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
        <CommonLayout>
            <NotFound {...props} />
        </CommonLayout>
    );
}

