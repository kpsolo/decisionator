import { describe, expect, it, vi } from "vitest";
import { getGoogleConfig } from "./google.js";

describe("getGoogleConfig", () => {
  it("throws descriptive error when VITE_GOOGLE_CLIENT_ID is missing", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "test-key");

    expect(() => getGoogleConfig()).toThrow(
      /Missing required environment variable: VITE_GOOGLE_CLIENT_ID/
    );
  });

  it("throws descriptive error when VITE_GOOGLE_API_KEY is missing", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "");

    expect(() => getGoogleConfig()).toThrow(
      /Missing required environment variable: VITE_GOOGLE_API_KEY/
    );
  });

  it("returns parsed config when environment variables are provided", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "my-client-id");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "my-api-key");
    vi.stubEnv("VITE_BASE_URL", "https://example.com/app/");

    const config = getGoogleConfig();
    expect(config.clientId).toBe("my-client-id");
    expect(config.apiKey).toBe("my-api-key");
    expect(config.baseUrl).toBe("https://example.com/app/");
  });
});
