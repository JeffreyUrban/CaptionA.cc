/**
 * By default, React Router will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to.
 * For more information, see https://reactrouter.com/file-conventions/entry.client
 */

import { HydratedRouter } from "react-router/dom";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
