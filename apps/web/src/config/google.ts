export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  baseUrl: string;
}

/**
 * Loads Google OAuth & API configuration from Vite environment variables.
 * Fails fast with clear descriptive error if required keys are missing (Research R28).
 */
export function getGoogleConfig(): GoogleConfig {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
  const baseUrl = import.meta.env.VITE_BASE_URL || "/decisionator/";

  if (!clientId || clientId.trim() === "") {
    throw new Error(
      "Missing required environment variable: VITE_GOOGLE_CLIENT_ID. Please configure it in your .env or build environment."
    );
  }

  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "Missing required environment variable: VITE_GOOGLE_API_KEY. Please configure it in your .env or build environment."
    );
  }

  return {
    clientId: clientId.trim(),
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim(),
  };
}
