import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

// Get all flat routes - this automatically discovers all route files
const routes = await flatRoutes();

// Export the routes
export default routes satisfies RouteConfig;
