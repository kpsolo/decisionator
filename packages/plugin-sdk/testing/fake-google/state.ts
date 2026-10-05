export interface FakeGoogleUser {
  participantId: string;
  displayName: string;
  email: string;
}

export interface DrivePermission {
  id: string;
  type: "user" | "anyone";
  role: "owner" | "writer" | "reader";
  emailAddress?: string;
  allowFileDiscovery?: boolean;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  trashed: boolean;
  version: number;
  appProperties: Record<string, string>;
  permissions: DrivePermission[];
  ownerEmail: string;
}

export interface SheetGrid {
  // tab title -> 2D array of string values (rows x cols)
  tabs: Map<string, string[][]>;
}

export class FakeGoogleState {
  users = new Map<string, FakeGoogleUser>();
  files = new Map<string, DriveFile>();
  sheets = new Map<string, SheetGrid>();

  currentUserId = "alice@example.com";
  rateLimitNext = false;
  rateLimitCode: 429 | 403 = 429;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.users.clear();
    this.files.clear();
    this.sheets.clear();
    this.rateLimitNext = false;
    this.rateLimitCode = 429;

    // Default identities
    this.addUser({
      participantId: "alice@example.com",
      displayName: "Alice Owner",
      email: "alice@example.com",
    });
    this.addUser({
      participantId: "bob@example.com",
      displayName: "Bob Contributor",
      email: "bob@example.com",
    });
    this.addUser({
      participantId: "charlie@example.com",
      displayName: "Charlie Reader",
      email: "charlie@example.com",
    });

    this.currentUserId = "alice@example.com";
  }

  addUser(user: FakeGoogleUser): void {
    this.users.set(user.email, user);
  }

  setCurrentUser(email: string): void {
    if (!this.users.has(email)) {
      this.addUser({
        participantId: email,
        displayName: email.split("@")[0] || email,
        email,
      });
    }
    this.currentUserId = email;
  }

  getCurrentUser(): FakeGoogleUser {
    const user = this.users.get(this.currentUserId);
    if (!user) {
      throw new Error(`Current user ${this.currentUserId} not found in fake state`);
    }
    return user;
  }

  injectRateLimit(code: 429 | 403 = 429): void {
    this.rateLimitNext = true;
    this.rateLimitCode = code;
  }

  clearRateLimit(): void {
    this.rateLimitNext = false;
  }
}

export const fakeGoogleState = new FakeGoogleState();
