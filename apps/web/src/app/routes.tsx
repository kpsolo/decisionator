import type { RouteObject } from "react-router-dom";
import PickerSpike from "../spikes/PickerSpike.js";
import {
  HomePage,
  NewProjectPage,
  ProjectOverviewPage,
  ProjectResultsPage,
  ProjectSharePage,
  ProjectStatsPage,
  ProjectVotePage,
  SettingsPage,
} from "./pages.js";

export const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  { path: "/new", element: <NewProjectPage /> },
  { path: "/p/:fileId", element: <ProjectOverviewPage /> },
  { path: "/p/:fileId/stats", element: <ProjectStatsPage /> },
  { path: "/p/:fileId/vote", element: <ProjectVotePage /> },
  { path: "/p/:fileId/results", element: <ProjectResultsPage /> },
  { path: "/p/:fileId/share", element: <ProjectSharePage /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/spike/picker", element: <PickerSpike /> },
];
