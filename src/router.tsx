import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell, RouteNotFound } from "./shell";
import { HomePage, CollectionPage } from "./pages";
import { DocumentPage } from "./reader";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: RouteNotFound,
});
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});
const allRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: () => <CollectionPage kind="all" />,
});
const recentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recent",
  component: () => <CollectionPage kind="recent" />,
});
const starredRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/starred",
  component: () => <CollectionPage kind="starred" />,
});
export const spaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spaces/$spaceId",
  component: () => <CollectionPage kind="space" />,
});
export const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId",
  component: DocumentPage,
});
const routeTree = rootRoute.addChildren([
  homeRoute,
  allRoute,
  recentRoute,
  starredRoute,
  spaceRoute,
  documentRoute,
]);
export const router = createRouter({ routeTree, defaultPreload: "intent" });

router.subscribe("onBeforeNavigate", ({ pathChanged }) => {
  if (pathChanged) performance.mark("kmflow:navigation-start");
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
