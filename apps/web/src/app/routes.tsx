import type { RouteObject } from "react-router-dom";
import { JoinLivePage } from "../features/live/GuestSession.js";
import { NewProjectWizard } from "../features/paste-format/NewProjectWizard.js";
import { PluginsPage } from "../features/plugins/PluginsPage.js";
import PickerSpike from "../spikes/PickerSpike.js";
import { HomePage } from "./HomePage.js";
import { ProjectViewPage } from "./ProjectViewPage.js";
import {
  ProjectResultsPage,
  ProjectSharePage,
  ProjectStatsPage,
  ProjectVotePage,
  SettingsPage,
} from "./pages.js";

export const routes: RouteObject[] = [
  { path: "/", element: <HomePage /> },
  { path: "/new", element: <NewProjectWizard /> },
  { path: "/join/:sessionId/:secret", element: <JoinLivePage /> },
  // Pre-v2 links carried no secret; the page explains they no longer work.
  { path: "/join/:sessionId", element: <JoinLivePage /> },
  // Universal multi-store routes
  { path: "/p/:storeId/:id", element: <ProjectViewPage /> },
  { path: "/p/:storeId/:id/stats", element: <ProjectStatsPage /> },
  { path: "/p/:storeId/:id/vote", element: <ProjectVotePage /> },
  { path: "/p/:storeId/:id/results", element: <ProjectResultsPage /> },
  { path: "/p/:storeId/:id/share", element: <ProjectSharePage /> },
  // Legacy single fileId routes (backward-compatible)
  { path: "/p/:fileId", element: <ProjectViewPage /> },
  { path: "/p/:fileId/stats", element: <ProjectStatsPage /> },
  { path: "/p/:fileId/vote", element: <ProjectVotePage /> },
  { path: "/p/:fileId/results", element: <ProjectResultsPage /> },
  { path: "/p/:fileId/share", element: <ProjectSharePage /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/plugins", element: <PluginsPage /> },
  { path: "/spike/picker", element: <PickerSpike /> },
];
