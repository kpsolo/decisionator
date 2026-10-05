import type { Identity } from "@decisionator/plugin-sdk";

export interface GoogleAuthConfig {
  clientId: string;
  scope?: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse | { error: string }) => void;
          }): {
            requestAccessToken(opts?: { prompt?: string }): void;
          };
        };
      };
    };
  }
}

export class GoogleAuthService {
  private currentToken: string | null = null;
  private tokenExpiresAt = 0;
  private currentIdentity: Identity | null = null;

  constructor(private config: GoogleAuthConfig) {}

  /**
   * Returns valid access token from memory, silently refreshing if possible
   */
  async getValidToken(opts?: { interactive?: boolean }): Promise<string> {
    const now = Date.now();
    // Buffer of 60 seconds
    if (this.currentToken && this.tokenExpiresAt > now + 60_000) {
      return this.currentToken;
    }

    return this.requestToken(opts?.interactive ?? false);
  }

  /**
   * Requests an access token via Google Identity Services token client
   */
  async requestToken(interactive = true): Promise<string> {
    if (typeof window === "undefined" || !window.google?.accounts?.oauth2) {
      // In testing or environments without GIS script loaded, allow mock/fallback
      if (this.currentToken) return this.currentToken;
      throw new Error("Google Identity Services script (google.accounts.oauth2) is not loaded");
    }

    const scope = this.config.scope || "https://www.googleapis.com/auth/drive.file";

    return new Promise((resolve, reject) => {
      try {
        const client = window.google?.accounts?.oauth2?.initTokenClient({
          client_id: this.config.clientId,
          scope,
          callback: (resp: TokenResponse | { error: string }) => {
            if ("error" in resp && resp.error) {
              reject(new Error(`Google OAuth error: ${resp.error}`));
              return;
            }
            const tokenResp = resp as TokenResponse;
            this.currentToken = tokenResp.access_token;
            this.tokenExpiresAt = Date.now() + tokenResp.expires_in * 1000;
            resolve(tokenResp.access_token);
          },
        });

        if (!client) {
          reject(new Error("Failed to initialize Google token client"));
          return;
        }

        // Silent re-request on expiry, prompt if interactive
        client.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Sets token directly (useful for tests or injected credentials)
   */
  setTokenInMemory(token: string, expiresInSeconds = 3600): void {
    this.currentToken = token;
    this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  }

  /**
   * Fetches user identity from Drive about.get
   */
  async getIdentity(): Promise<Identity> {
    if (this.currentIdentity && this.currentToken) {
      return this.currentIdentity;
    }

    const token = await this.getValidToken({ interactive: false }).catch(() => {
      return this.currentToken;
    });

    if (!token) {
      throw new Error("Not signed in to Google");
    }

    const res = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch Google profile: ${res.statusText}`);
    }

    const data = (await res.json()) as {
      user: { displayName: string; emailAddress: string };
    };

    this.currentIdentity = {
      participantId: data.user.emailAddress,
      displayName: data.user.displayName,
      email: data.user.emailAddress,
    };

    return this.currentIdentity;
  }

  clear(): void {
    this.currentToken = null;
    this.tokenExpiresAt = 0;
    this.currentIdentity = null;
  }
}
