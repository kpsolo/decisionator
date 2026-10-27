import type {
  ParticipantRole,
  ProjectRef,
  ShareRequest,
  ShareState,
} from "@decisionator/plugin-sdk";
import type { GoogleApiClient } from "./google-api.js";

/** Used only when there is no running page to take the app's address from (e.g. Node tests). */
export const FALLBACK_APP_URL = "https://kpsolo.github.io/decisionator/";

/**
 * The app's base URL (origin and path, no query or hash) taken from the running page, so a
 * self-hosted or forked deployment hands out links to itself; `FALLBACK_APP_URL` outside a page.
 */
export function appBaseUrl(): string {
  const loc = (globalThis as { location?: { origin?: string; pathname?: string } }).location;
  const origin = loc?.origin;
  if (!origin || origin === "null" || !/^https?:\/\//.test(origin)) return FALLBACK_APP_URL;
  const path = loc?.pathname || "/";
  return `${origin}${path.replace(/index\.html?$/, "")}`;
}

/** The link that opens project `id` in the app (hash routing). */
export function projectLinkUrl(id: string): string {
  return `${appBaseUrl()}#/p/${encodeURIComponent(id)}`;
}

/**
 * Drive permissions and share operations according to contracts/sheet-store.md
 */
export async function getProjectShareState(
  client: GoogleApiClient,
  ref: ProjectRef
): Promise<ShareState> {
  const perms = await client.listPermissions(ref.id);
  const linkPerm = perms.permissions.find((p) => p.type === "anyone");
  const userPerms = perms.permissions.filter((p) => p.type === "user");

  return {
    linkSharing: {
      enabled: !!linkPerm,
      role: linkPerm?.role === "writer" ? "contribute" : "view",
      url: projectLinkUrl(ref.id),
    },
    collaborators: userPerms.map((p) => ({
      email: p.emailAddress || "",
      role: p.role === "owner" ? "owner" : p.role === "writer" ? "contribute" : "view",
    })),
  };
}

export async function updateProjectSharing(
  client: GoogleApiClient,
  ref: ProjectRef,
  req: ShareRequest
): Promise<ShareState> {
  if (req.linkSharing) {
    if (req.linkSharing.enabled) {
      await client.createPermission(ref.id, {
        type: "anyone",
        role: req.linkSharing.role === "contribute" ? "writer" : "reader",
        allowFileDiscovery: false,
      });
    } else {
      const perms = await client.listPermissions(ref.id);
      const linkPerm = perms.permissions.find((p) => p.type === "anyone");
      if (linkPerm?.id) {
        await client.deletePermission(ref.id, linkPerm.id);
      }
    }
  }

  if (req.inviteUsers) {
    for (const inv of req.inviteUsers) {
      await client.createPermission(ref.id, {
        type: "user",
        emailAddress: inv.email,
        role: inv.role === "contribute" ? "writer" : "reader",
      });
    }
  }

  return getProjectShareState(client, ref);
}

export async function removeProjectCollaborator(
  client: GoogleApiClient,
  ref: ProjectRef,
  email: string
): Promise<void> {
  const perms = await client.listPermissions(ref.id);
  const target = perms.permissions.find((p) => p.type === "user" && p.emailAddress === email);

  if (!target || !target.id) {
    throw new Error(
      `NOT_SUPPORTED: Collaborator "${email}" could not be individually removed or was not invited by email.`
    );
  }

  await client.deletePermission(ref.id, target.id);
}
