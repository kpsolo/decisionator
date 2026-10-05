import { verifyEd25519, verifyRequestSignature } from "@decisionator/core";
import { type Context, Hono } from "hono";
import { RelayDatabase } from "./database.js";
import {
  AcceptInviteSchema,
  ChangeBatchSchema,
  CreateInviteSchema,
  PostInviteKeySchema,
  type SignedAcl,
  SignedAclSchema,
} from "./protocol.js";

export interface RelayLimits {
  maxBatchSizeBytes: number; // default 1 MB
  maxDocStorageBytes: number; // default 50 MB
  maxMembersPerDoc: number; // default 50
  maxTunnelBodyBytes: number; // default 1 MB
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxBatchSizeBytes: 1 * 1024 * 1024,
  maxDocStorageBytes: 50 * 1024 * 1024,
  maxMembersPerDoc: 50,
  maxTunnelBodyBytes: 1 * 1024 * 1024,
};

export interface RelayServerOptions {
  db?: RelayDatabase;
  dbPath?: string;
  limits?: Partial<RelayLimits>;
}

export function createRelayApp(options: RelayServerOptions = {}) {
  const db = options.db ?? new RelayDatabase(options.dbPath ?? ":memory:");
  const limits: RelayLimits = {
    ...DEFAULT_RELAY_LIMITS,
    ...options.limits,
  };

  const app = new Hono();

  // Active WebSocket tunnels: tunnelId -> ws handler/send callback
  const tunnels = new Map<
    string,
    {
      send: (msg: string) => void;
      pendingRequests: Map<
        string,
        (res: { status: number; headers: Record<string, string>; body: string }) => void
      >;
    }
  >();

  // Active live subscriptions for docs: docId -> Set<callback>
  const liveSubscribers = new Map<string, Set<(seq: number) => void>>();

  function notifyLive(docId: string, seq: number) {
    const subs = liveSubscribers.get(docId);
    if (subs) {
      for (const sub of subs) {
        sub(seq);
      }
    }
  }

  // Request authentication helper
  async function authenticateRequest(c: Context): Promise<
    | {
        authenticated: true;
        signerKey: string;
        rawBody: Uint8Array;
        jsonBody?: Record<string, unknown>;
      }
    | { authenticated: false; response: Response }
  > {
    const method = c.req.method;
    const path = c.req.path;
    const keyHeader = c.req.header("X-Dcg-Key");
    const tsHeader = c.req.header("X-Dcg-Timestamp");
    const sigHeader = c.req.header("X-Dcg-Signature");

    const rawBuffer = await c.req.raw.arrayBuffer();
    const rawBody = new Uint8Array(rawBuffer);

    const verification = verifyRequestSignature(
      method,
      path,
      tsHeader,
      sigHeader,
      keyHeader,
      rawBody
    );
    if (!verification.valid || !keyHeader) {
      return {
        authenticated: false,
        response: c.json({ error: verification.error || "Authentication failed" }, 401),
      };
    }

    let jsonBody: Record<string, unknown> | undefined = undefined;
    if (rawBody.length > 0) {
      try {
        jsonBody = JSON.parse(new TextDecoder().decode(rawBody));
      } catch {
        return {
          authenticated: false,
          response: c.json({ error: "Invalid JSON body" }, 400),
        };
      }
    }

    return {
      authenticated: true,
      signerKey: keyHeader,
      rawBody,
      jsonBody,
    };
  }

  function verifyAclSignature(acl: SignedAcl): boolean {
    const payloadObject = {
      docId: acl.docId,
      version: acl.version,
      keyEpoch: acl.keyEpoch,
      members: acl.members,
    };
    const canonical = JSON.stringify(payloadObject);
    const owner = acl.members.find((m) => m.role === "owner");
    if (!owner) return false;
    return verifyEd25519(acl.ownerSignature, new TextEncoder().encode(canonical), owner.key);
  }

  // PUT /v1/docs/:docId - Create doc
  app.put("/v1/docs/:docId", async (c) => {
    const docId = c.req.param("docId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const parsed = SignedAclSchema.safeParse(auth.jsonBody?.acl);
    if (!parsed.success) {
      return c.json({ error: "Invalid acl payload", details: parsed.error.issues }, 400);
    }
    const acl = parsed.data;
    if (acl.docId !== docId) {
      return c.json({ error: "docId mismatch" }, 400);
    }
    if (acl.members.length > limits.maxMembersPerDoc) {
      return c.json({ error: `Member limit exceeded (max ${limits.maxMembersPerDoc})` }, 400);
    }

    const ownerMember = acl.members.find((m) => m.role === "owner");
    if (!ownerMember || ownerMember.key !== auth.signerKey) {
      return c.json({ error: "Signer must be designated owner in ACL" }, 403);
    }
    if (!verifyAclSignature(acl)) {
      return c.json({ error: "Invalid owner signature on ACL" }, 403);
    }

    const existing = db.getDoc(docId);
    if (existing) {
      return c.json({ error: "Document already exists" }, 409);
    }

    db.saveDoc(docId, acl);
    return c.json({ ok: true, docId, version: acl.version });
  });

  // PUT /v1/docs/:docId/acl - Replace ACL
  app.put("/v1/docs/:docId/acl", async (c) => {
    const docId = c.req.param("docId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const existing = db.getDoc(docId);
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    const parsed = SignedAclSchema.safeParse(auth.jsonBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid acl payload", details: parsed.error.issues }, 400);
    }
    const acl = parsed.data;
    if (acl.docId !== docId) {
      return c.json({ error: "docId mismatch" }, 400);
    }
    if (acl.version <= existing.version) {
      return c.json({ error: "ACL version must be strictly greater than current version" }, 409);
    }
    if (acl.members.length > limits.maxMembersPerDoc) {
      return c.json({ error: `Member limit exceeded (max ${limits.maxMembersPerDoc})` }, 400);
    }

    const currentAcl: SignedAcl = JSON.parse(existing.aclJson);
    const currentOwner = currentAcl.members.find((m) => m.role === "owner");
    if (!currentOwner || currentOwner.key !== auth.signerKey) {
      return c.json({ error: "Only current owner can update ACL" }, 403);
    }

    if (!verifyAclSignature(acl)) {
      return c.json({ error: "Invalid owner signature on ACL" }, 403);
    }

    db.saveDoc(docId, acl);
    return c.json({ ok: true, docId, version: acl.version });
  });

  // POST /v1/docs/:docId/changes - Append ChangeBatch
  app.post("/v1/docs/:docId/changes", async (c) => {
    const docId = c.req.param("docId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const existing = db.getDoc(docId);
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    const parsed = ChangeBatchSchema.safeParse(auth.jsonBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid ChangeBatch payload", details: parsed.error.issues }, 400);
    }
    const batch = parsed.data;

    // Check limits
    const batchSize = auth.rawBody.length;
    if (batchSize > limits.maxBatchSizeBytes) {
      return c.json({ error: `Batch size exceeds limit (${limits.maxBatchSizeBytes} bytes)` }, 413);
    }

    const currentBytes = db.getDocTotalBytes(docId);
    if (currentBytes + batchSize > limits.maxDocStorageBytes) {
      return c.json(
        { error: `Document storage limit exceeded (${limits.maxDocStorageBytes} bytes)` },
        507
      );
    }

    // Role check
    const currentAcl: SignedAcl = JSON.parse(existing.aclJson);
    const member = currentAcl.members.find((m) => m.key === auth.signerKey);
    if (!member || (member.role !== "owner" && member.role !== "contribute")) {
      return c.json({ error: "Signer does not have write permissions in ACL" }, 403);
    }

    // Verify batch signature over (docId || keyEpoch || nonce || ciphertext)
    const signPayload = `${docId}\n${batch.keyEpoch}\n${batch.nonce}\n${batch.ciphertext}`;
    const validBatchSig = verifyEd25519(
      batch.signature,
      new TextEncoder().encode(signPayload),
      batch.signerKey
    );
    if (!validBatchSig || batch.signerKey !== auth.signerKey) {
      return c.json({ error: "Invalid signature on ChangeBatch" }, 403);
    }

    const stored = db.appendChange(
      docId,
      batch.keyEpoch,
      batch.nonce,
      batch.ciphertext,
      batch.signerKey,
      batch.signature
    );
    notifyLive(docId, stored.seq);

    return c.json({ ok: true, seq: stored.seq, receivedAt: stored.receivedAt }, 201);
  });

  // GET /v1/docs/:docId/changes - Pull batches
  app.get("/v1/docs/:docId/changes", async (c) => {
    const docId = c.req.param("docId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const existing = db.getDoc(docId);
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    const currentAcl: SignedAcl = JSON.parse(existing.aclJson);
    const member = currentAcl.members.find((m) => m.key === auth.signerKey);
    if (!member) {
      return c.json({ error: "Signer is not an ACL member" }, 403);
    }

    const afterSeq = Number.parseInt(c.req.query("after") || "0", 10);
    const limit = Math.min(Number.parseInt(c.req.query("limit") || "100", 10), 500);

    const changes = db.getChanges(docId, afterSeq, limit);
    return c.json({
      docId,
      changes,
      acl: currentAcl,
      hasMore: changes.length === limit,
    });
  });

  // POST /v1/docs/:docId/snapshots - Store compacted snapshot
  app.post("/v1/docs/:docId/snapshots", async (c) => {
    const docId = c.req.param("docId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const existing = db.getDoc(docId);
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    const currentAcl: SignedAcl = JSON.parse(existing.aclJson);
    const member = currentAcl.members.find((m) => m.key === auth.signerKey);
    if (!member || (member.role !== "owner" && member.role !== "contribute")) {
      return c.json({ error: "Signer does not have write permissions" }, 403);
    }

    const body = auth.jsonBody;
    if (!body || typeof body.seq !== "number" || typeof body.ciphertext !== "string") {
      return c.json({ error: "Invalid snapshot payload" }, 400);
    }

    db.saveSnapshot(docId, body.seq, body.keyEpoch, body.nonce, body.ciphertext, auth.signerKey);
    return c.json({ ok: true, docId, seq: body.seq });
  });

  // DELETE /v1/docs/:docId - Delete doc
  app.delete("/v1/docs/:docId", async (c) => {
    const docId = c.req.param("docId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const existing = db.getDoc(docId);
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    const currentAcl: SignedAcl = JSON.parse(existing.aclJson);
    const owner = currentAcl.members.find((m) => m.role === "owner");
    if (!owner || owner.key !== auth.signerKey) {
      return c.json({ error: "Only owner can delete document" }, 403);
    }

    db.deleteDoc(docId);
    return c.json({ ok: true, docId });
  });

  // POST /v1/docs/:docId/invites - Step 1: Owner creates invite
  app.post("/v1/docs/:docId/invites", async (c) => {
    const docId = c.req.param("docId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const existing = db.getDoc(docId);
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    const currentAcl: SignedAcl = JSON.parse(existing.aclJson);
    const owner = currentAcl.members.find((m) => m.role === "owner");
    if (!owner || owner.key !== auth.signerKey) {
      return c.json({ error: "Only owner can create invites" }, 403);
    }

    const parsed = CreateInviteSchema.safeParse(auth.jsonBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid invite payload", details: parsed.error.issues }, 400);
    }

    const inviteId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const invite = db.createInvite(inviteId, docId, parsed.data.role, parsed.data.expiresAt);
    return c.json(invite, 201);
  });

  // POST /v1/invites/:inviteId/accept - Step 2: Invitee presents public keys
  app.post("/v1/invites/:inviteId/accept", async (c) => {
    const inviteId = c.req.param("inviteId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const invite = db.getInvite(inviteId);
    if (!invite) {
      return c.json({ error: "Invite not found" }, 404);
    }
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      return c.json({ error: "Invite has expired" }, 410);
    }

    const parsed = AcceptInviteSchema.safeParse(auth.jsonBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid accept payload", details: parsed.error.issues }, 400);
    }

    db.acceptInvite(inviteId, parsed.data.key, parsed.data.encKey);
    return c.json({ ok: true, inviteId, status: "accepted" });
  });

  // POST /v1/invites/:inviteId/key - Step 3: Owner posts sealed key
  app.post("/v1/invites/:inviteId/key", async (c) => {
    const inviteId = c.req.param("inviteId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const invite = db.getInvite(inviteId);
    if (!invite) {
      return c.json({ error: "Invite not found" }, 404);
    }

    const existing = db.getDoc(invite.docId);
    if (!existing) {
      return c.json({ error: "Document not found" }, 404);
    }

    const currentAcl: SignedAcl = JSON.parse(existing.aclJson);
    const owner = currentAcl.members.find((m) => m.role === "owner");
    if (!owner || owner.key !== auth.signerKey) {
      return c.json({ error: "Only owner can fulfill invite keys" }, 403);
    }

    const parsed = PostInviteKeySchema.safeParse(auth.jsonBody);
    if (!parsed.success) {
      return c.json({ error: "Invalid sealed key payload" }, 400);
    }

    db.setInviteKey(inviteId, parsed.data.sealedKey);
    return c.json({ ok: true, inviteId, status: "fulfilled" });
  });

  // GET /v1/invites/:inviteId/key - Step 4: Invitee fetches sealed key
  app.get("/v1/invites/:inviteId/key", async (c) => {
    const inviteId = c.req.param("inviteId");
    const auth = await authenticateRequest(c);
    if (!auth.authenticated) return auth.response;

    const invite = db.getInvite(inviteId);
    if (!invite) {
      return c.json({ error: "Invite not found" }, 404);
    }
    if (invite.inviteeKey !== auth.signerKey) {
      return c.json({ error: "Only the invitee can fetch the key" }, 403);
    }
    if (!invite.sealedKey) {
      return c.json({ error: "Key not yet posted by owner", status: invite.status }, 202);
    }

    return c.json({
      inviteId,
      docId: invite.docId,
      role: invite.role,
      sealedKey: invite.sealedKey,
    });
  });

  // Agent Tunnel HTTP endpoints: forward to connected node WebSocket
  app.all("/t/:tunnelId/*", async (c) => {
    const tunnelId = c.req.param("tunnelId");
    const tunnel = tunnels.get(tunnelId);
    if (!tunnel) {
      return c.text("503 NODE_OFFLINE: Target node is not connected to relay", 503);
    }

    const rawBuffer = await c.req.raw.arrayBuffer();
    if (rawBuffer.byteLength > limits.maxTunnelBodyBytes) {
      return c.json(
        { error: `Tunnel request body limit exceeded (${limits.maxTunnelBodyBytes} bytes)` },
        413
      );
    }

    const reqId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.header())) {
      if (typeof v === "string") headers[k] = v;
    }

    const framedMessage = JSON.stringify({
      type: "tunnel_request",
      requestId: reqId,
      method: c.req.method,
      path: c.req.path.replace(`/t/${tunnelId}`, ""),
      headers,
      body: Buffer.from(rawBuffer).toString("base64"),
    });

    return new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        tunnel.pendingRequests.delete(reqId);
        resolve(c.text("504 GATEWAY_TIMEOUT: Node did not reply in time", 504));
      }, 10_000);

      tunnel.pendingRequests.set(reqId, (res) => {
        clearTimeout(timer);
        resolve(
          new Response(Buffer.from(res.body, "base64"), {
            status: res.status,
            headers: res.headers,
          })
        );
      });

      tunnel.send(framedMessage);
    });
  });

  return {
    app,
    db,
    tunnels,
    liveSubscribers,
    limits,
  };
}
