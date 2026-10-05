import type { ParticipantRole } from "@decisionator/plugin-sdk";
import type { GoogleApiClient } from "./google-api.js";

export interface ResolveRoleParams {
  client: GoogleApiClient;
  fileId: string;
  participantEmail: string;
}

export async function resolveProjectRole({
  client,
  fileId,
  participantEmail,
}: ResolveRoleParams): Promise<ParticipantRole> {
  const perms = await client.listPermissions(fileId);

  // Check if owner
  const isOwner = perms.permissions.some(
    (p) => p.role === "owner" && p.emailAddress === participantEmail
  );
  if (isOwner) return "owner";

  // Check writer (email or anyone)
  const isWriter = perms.permissions.some(
    (p) => p.role === "writer" && (p.emailAddress === participantEmail || p.type === "anyone")
  );
  if (isWriter) return "contribute";

  // Default to view
  return "view";
}
