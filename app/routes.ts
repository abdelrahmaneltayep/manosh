import { flatRoutes } from "@remix-run/fs-routes";

// Colocated tests live next to the routes/services they cover; keep them out of
// the route table (they're not routes) and out of the client build.
export default flatRoutes({
  ignoredRouteFiles: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
});
