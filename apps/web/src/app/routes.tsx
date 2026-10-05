import type { RouteObject } from "react-router-dom";
import { NewProjectWizard } from "../features/paste-format/NewProjectWizard.js";
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
  { path: "/p/:fileId", element: <ProjectViewPage /> },
  { path: "/p/:fileId/stats", element: <ProjectStatsPage /> },
  { path: "/p/:fileId/vote", element: <ProjectVotePage /> },
  { path: "/p/:fileId/results", element: <ProjectResultsPage /> },
  { path: "/p/:fileId/share", element: <ProjectSharePage /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/spike/picker", element: <PickerSpike /> },
];
