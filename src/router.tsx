import { lazy } from "react";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const DefaultErrorComponent = lazy(() => import("./components/default-error"));

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
