import type { Option, Project } from "@decisionator/core";
import { GoogleAuthService, GoogleSheetsProjectStore } from "@decisionator/store-google-sheets";
import { getGoogleConfig } from "../../config/google.js";

export interface CreateProjectParams {
  title: string;
  description?: string;
  options: Option[];
}

export async function createProjectFlow(params: CreateProjectParams): Promise<{ fileId: string }> {
  const config = getGoogleConfig();
  const auth = new GoogleAuthService({
    clientId: config.clientId,
  });

  // 1. Request interactive sign-in
  await auth.requestToken(true);

  // 2. Instantiate store and create project
  const store = new GoogleSheetsProjectStore(auth);
  const ref = await store.createProject({
    title: params.title,
    description: params.description,
    options: params.options,
    voting: {
      state: "open",
      round: 1,
      topN: 3,
      liveResults: true,
    },
  });

  return { fileId: ref.id };
}
