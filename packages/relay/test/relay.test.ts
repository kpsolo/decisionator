import {
  encryptXChaCha20,
  generateEncryptionKeyPair,
  generateInviteSecret,
  generateSigningKeyPair,
  hashInviteSecret,
  sealBox,
  signEd25519,
  signRequest,
  unsealBox,
} from "@decisionator/core";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRelayApp } from "../src/app.js";
import type { ChangeBatch, SignedAcl } from "../src/protocol.js";
import { startRelayServer } from "../src/server.js";

type SigningKeys = ReturnType<typeof generateSigningKeyPair>;

/**
 * Opens `WS /v1/docs/{docId}/live`, sends `message` (default: a valid signed subscribe from
 * `signer`) and resolves once the relay answers or closes the socket.
 */
async function openLive(
  port: number,
  docId: string,
  signer?: SigningKeys,
  message?: unknown
): Promise<{
  ws: WebSocket;
  events: Record<string, unknown>[];
  closed: Promise<{ code: number; reason: string }>;
}> {
  const path = `/v1/docs/${docId}/live`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  const events: Record<string, unknown>[] = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }))
  );
  const firstReply = new Promise<void>((resolve) => {
    ws.on("message", (data) => {
      events.push(JSON.parse(data.toString()));
      resolve();
    });
    ws.on("close", () => resolve());
  });
  await new Promise((r) => ws.on("open", r));
  if (message !== undefined) {
    ws.send(typeof message === "string" ? message : JSON.stringify(message));
  } else if (signer) {
    const sig = signRequest(
      "WS",
      path,
      Date.now(),
      new TextEncoder().encode(JSON.stringify({ type: "subscribe", docId })),
      signer
    );
    ws.send(
      JSON.stringify({
        type: "subscribe",
        key: sig["X-Dcg-Key"],
        timestamp: sig["X-Dcg-Timestamp"],
        nonce: sig["X-Dcg-Nonce"],
        signature: sig["X-Dcg-Signature"],
      })
    );
  }
  if (message !== undefined || signer) await firstReply;
  return { ws, events, closed };
}

describe("Relay Protocol & Server Compliance (T113, FR-071)", () => {
  it("enforces signed requests and ACL creation", async () => {
    const relay = createRelayApp();
    const ownerKey = generateSigningKeyPair();
    const ownerEncKey = generateEncryptionKeyPair();

    const docId = "doc_test_01";
    const aclPayload = {
      docId,
      version: 1,
      keyEpoch: 1,
      members: [
        {
          key: ownerKey.publicKeyBase64,
          encKey: ownerEncKey.publicKeyBase64,
          role: "owner" as const,
        },
      ],
    };
    const ownerSig = signEd25519(
      new TextEncoder().encode(JSON.stringify(aclPayload)),
      ownerKey.privateKey
    );
    const signedAcl: SignedAcl = {
      ...aclPayload,
      ownerSignature: ownerSig,
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify({ acl: signedAcl }));
    const now = Date.now();
    const headers = signRequest("PUT", `/v1/docs/${docId}`, now, bodyBytes, ownerKey);

    // Call PUT /v1/docs/:docId
    const res = await relay.app.request(`/v1/docs/${docId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: bodyBytes,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.docId).toBe(docId);
  });

  it("appends and pulls change batches only for authorized roles", async () => {
    const relay = createRelayApp();
    const ownerKey = generateSigningKeyPair();
    const ownerEncKey = generateEncryptionKeyPair();
    const contributorKey = generateSigningKeyPair();
    const contributorEncKey = generateEncryptionKeyPair();
    const viewerKey = generateSigningKeyPair();
    const viewerEncKey = generateEncryptionKeyPair();
    const outsiderKey = generateSigningKeyPair();

    const docId = "doc_test_perms";
    const aclPayload = {
      docId,
      version: 1,
      keyEpoch: 1,
      members: [
        {
          key: ownerKey.publicKeyBase64,
          encKey: ownerEncKey.publicKeyBase64,
          role: "owner" as const,
        },
        {
          key: contributorKey.publicKeyBase64,
          encKey: contributorEncKey.publicKeyBase64,
          role: "contribute" as const,
        },
        {
          key: viewerKey.publicKeyBase64,
          encKey: viewerEncKey.publicKeyBase64,
          role: "view" as const,
        },
      ],
    };
    const ownerSig = signEd25519(
      new TextEncoder().encode(JSON.stringify(aclPayload)),
      ownerKey.privateKey
    );
    const signedAcl: SignedAcl = { ...aclPayload, ownerSignature: ownerSig };

    // Create doc
    const putBody = new TextEncoder().encode(JSON.stringify({ acl: signedAcl }));
    await relay.app.request(`/v1/docs/${docId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...signRequest("PUT", `/v1/docs/${docId}`, Date.now(), putBody, ownerKey),
      },
      body: putBody,
    });

    // 1. Contributor appends a change batch
    const changeBytes = new TextEncoder().encode("automerge change");
    const projKey = new Uint8Array(32);
    const { nonceBase64, ciphertextBase64 } = encryptXChaCha20(changeBytes, projKey);
    const sigPayload = `${docId}\n1\n${nonceBase64}\n${ciphertextBase64}`;
    const batchSig = signEd25519(new TextEncoder().encode(sigPayload), contributorKey.privateKey);

    const batch: ChangeBatch = {
      keyEpoch: 1,
      nonce: nonceBase64,
      ciphertext: ciphertextBase64,
      signerKey: contributorKey.publicKeyBase64,
      signature: batchSig,
    };
    const batchBody = new TextEncoder().encode(JSON.stringify(batch));
    const appendRes = await relay.app.request(`/v1/docs/${docId}/changes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signRequest("POST", `/v1/docs/${docId}/changes`, Date.now(), batchBody, contributorKey),
      },
      body: batchBody,
    });
    expect(appendRes.status).toBe(201);
    const appendJson = await appendRes.json();
    expect(appendJson.seq).toBe(1);

    // 2. Viewer attempts to append a change batch -> rejected (403)
    const viewerBatchSig = signEd25519(new TextEncoder().encode(sigPayload), viewerKey.privateKey);
    const viewerBatch: ChangeBatch = {
      keyEpoch: 1,
      nonce: nonceBase64,
      ciphertext: ciphertextBase64,
      signerKey: viewerKey.publicKeyBase64,
      signature: viewerBatchSig,
    };
    const viewerBatchBody = new TextEncoder().encode(JSON.stringify(viewerBatch));
    const viewerRes = await relay.app.request(`/v1/docs/${docId}/changes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signRequest("POST", `/v1/docs/${docId}/changes`, Date.now(), viewerBatchBody, viewerKey),
      },
      body: viewerBatchBody,
    });
    expect(viewerRes.status).toBe(403);

    // 3. Outsider attempts to read changes -> rejected (403)
    const readHeaders = signRequest(
      "GET",
      `/v1/docs/${docId}/changes`,
      Date.now(),
      new Uint8Array(),
      outsiderKey
    );
    const outsiderRead = await relay.app.request(`/v1/docs/${docId}/changes`, {
      method: "GET",
      headers: readHeaders,
    });
    expect(outsiderRead.status).toBe(403);

    // 4. Viewer pulls changes -> succeeds (200)
    const viewerReadHeaders = signRequest(
      "GET",
      `/v1/docs/${docId}/changes`,
      Date.now(),
      new Uint8Array(),
      viewerKey
    );
    const viewerRead = await relay.app.request(`/v1/docs/${docId}/changes`, {
      method: "GET",
      headers: viewerReadHeaders,
    });
    expect(viewerRead.status).toBe(200);
    const viewerData = await viewerRead.json();
    expect(viewerData.changes.length).toBe(1);
    expect(viewerData.changes[0].ciphertext).toBe(ciphertextBase64);
  });

  it("handles two-step invites and sealed key exchange", async () => {
    const relay = createRelayApp();
    const ownerKey = generateSigningKeyPair();
    const ownerEncKey = generateEncryptionKeyPair();
    const inviteeKey = generateSigningKeyPair();
    const inviteeEncKey = generateEncryptionKeyPair();

    const docId = "doc_test_invites";
    const signedAcl: SignedAcl = {
      docId,
      version: 1,
      keyEpoch: 1,
      members: [
        { key: ownerKey.publicKeyBase64, encKey: ownerEncKey.publicKeyBase64, role: "owner" },
      ],
      ownerSignature: signEd25519(
        new TextEncoder().encode(
          JSON.stringify({
            docId,
            version: 1,
            keyEpoch: 1,
            members: [
              { key: ownerKey.publicKeyBase64, encKey: ownerEncKey.publicKeyBase64, role: "owner" },
            ],
          })
        ),
        ownerKey.privateKey
      ),
    };

    const docBody = new TextEncoder().encode(JSON.stringify({ acl: signedAcl }));
    await relay.app.request(`/v1/docs/${docId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...signRequest("PUT", `/v1/docs/${docId}`, Date.now(), docBody, ownerKey),
      },
      body: docBody,
    });

    // Step 1: Owner creates invite, bound to an out-of-band secret (link fragment)
    const inviteSecret = generateInviteSecret();
    const inviteReq = {
      role: "contribute",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      secretHash: hashInviteSecret(inviteSecret),
    };
    const inviteBody = new TextEncoder().encode(JSON.stringify(inviteReq));
    const invRes = await relay.app.request(`/v1/docs/${docId}/invites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signRequest("POST", `/v1/docs/${docId}/invites`, Date.now(), inviteBody, ownerKey),
      },
      body: inviteBody,
    });
    expect(invRes.status).toBe(201);
    const { inviteId } = await invRes.json();
    expect(inviteId).toMatch(/^inv_[0-9a-f]{32}$/);

    // Step 2: Invitee accepts invite presenting keys and the invite secret
    const acceptReq = {
      key: inviteeKey.publicKeyBase64,
      encKey: inviteeEncKey.publicKeyBase64,
      secret: inviteSecret,
    };
    const acceptBody = new TextEncoder().encode(JSON.stringify(acceptReq));
    const acceptRes = await relay.app.request(`/v1/invites/${inviteId}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signRequest(
          "POST",
          `/v1/invites/${inviteId}/accept`,
          Date.now(),
          acceptBody,
          inviteeKey
        ),
      },
      body: acceptBody,
    });
    expect(acceptRes.status).toBe(200);

    // Step 3: Owner fulfills sealed key
    const secretProjectKey = new Uint8Array(32);
    globalThis.crypto.getRandomValues(secretProjectKey);
    const sealedKey = sealBox(secretProjectKey, inviteeEncKey.publicKey);

    const postKeyBody = new TextEncoder().encode(JSON.stringify({ sealedKey }));
    const postKeyRes = await relay.app.request(`/v1/invites/${inviteId}/key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signRequest("POST", `/v1/invites/${inviteId}/key`, Date.now(), postKeyBody, ownerKey),
      },
      body: postKeyBody,
    });
    expect(postKeyRes.status).toBe(200);

    // Step 4: Invitee fetches sealed key and decrypts it
    const fetchKeyHeaders = signRequest(
      "GET",
      `/v1/invites/${inviteId}/key`,
      Date.now(),
      new Uint8Array(),
      inviteeKey
    );
    const fetchKeyRes = await relay.app.request(`/v1/invites/${inviteId}/key`, {
      method: "GET",
      headers: fetchKeyHeaders,
    });
    expect(fetchKeyRes.status).toBe(200);
    const keyJson = await fetchKeyRes.json();
    expect(keyJson.sealedKey).toBe(sealedKey);

    const unsealed = unsealBox(keyJson.sealedKey, inviteeEncKey.privateKey);
    expect(unsealed).toEqual(secretProjectKey);
  });

  it("handles live WebSocket notifications and agent tunnel proxying", async () => {
    const service = await startRelayServer();
    try {
      const port = service.port;
      const ownerKey = generateSigningKeyPair();
      const nodeKey = generateSigningKeyPair();

      // Create the doc, then subscribe to live notifications as a member
      const docPayload = {
        docId: "live-doc",
        version: 1,
        keyEpoch: 1,
        members: [
          {
            key: ownerKey.publicKeyBase64,
            encKey: ownerKey.publicKeyBase64,
            role: "owner" as const,
          },
        ],
      };
      const signedAcl: SignedAcl = {
        ...docPayload,
        ownerSignature: signEd25519(
          new TextEncoder().encode(JSON.stringify(docPayload)),
          ownerKey.privateKey
        ),
      };
      const docBody = new TextEncoder().encode(JSON.stringify({ acl: signedAcl }));
      await fetch(`http://127.0.0.1:${port}/v1/docs/live-doc`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...signRequest("PUT", "/v1/docs/live-doc", Date.now(), docBody, ownerKey),
        },
        body: docBody,
      });

      const live = await openLive(port, "live-doc", ownerKey);
      expect(live.events[0]).toEqual({ type: "subscribed", docId: "live-doc" });
      const liveWs = live.ws;
      const liveEvents = live.events;

      // Append change to trigger live event
      const batchPayload = {
        keyEpoch: 1,
        nonce: "bm9uY2U=",
        ciphertext: "Y2lwaGVydGV4dA==",
        signerKey: ownerKey.publicKeyBase64,
        signature: signEd25519(
          new TextEncoder().encode("live-doc\n1\nbm9uY2U=\nY2lwaGVydGV4dA=="),
          ownerKey.privateKey
        ),
      };
      const batchBody = new TextEncoder().encode(JSON.stringify(batchPayload));
      await fetch(`http://127.0.0.1:${port}/v1/docs/live-doc/changes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...signRequest("POST", "/v1/docs/live-doc/changes", Date.now(), batchBody, ownerKey),
        },
        body: batchBody,
      });

      // Wait for live WS notification
      await new Promise((r) => setTimeout(r, 200));
      expect(liveEvents.length).toBe(2);
      const firstEvent = liveEvents[1] as { type: string; docId: string; seq: number } | undefined;
      expect(firstEvent?.docId).toBe("live-doc");
      expect(firstEvent?.seq).toBe(1);

      liveWs.close();

      // Test Agent Tunnel WebSocket
      const tunnelWs = new WebSocket(`ws://127.0.0.1:${port}/v1/tunnels`);
      let tunnelId = "";
      await new Promise((r) => tunnelWs.on("open", r));

      const helloMsg = { type: "hello" };
      const helloSig = signRequest(
        "WS",
        "/v1/tunnels",
        Date.now(),
        new TextEncoder().encode(JSON.stringify(helloMsg)),
        nodeKey
      );
      tunnelWs.send(
        JSON.stringify({
          type: "hello",
          key: helloSig["X-Dcg-Key"],
          timestamp: helloSig["X-Dcg-Timestamp"],
          nonce: helloSig["X-Dcg-Nonce"],
          signature: helloSig["X-Dcg-Signature"],
        })
      );

      tunnelWs.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ready") {
          tunnelId = msg.tunnelId;
        } else if (msg.type === "tunnel_request") {
          // Respond to forwarded request
          tunnelWs.send(
            JSON.stringify({
              type: "tunnel_response",
              requestId: msg.requestId,
              status: 200,
              headers: { "content-type": "application/json" },
              body: Buffer.from(JSON.stringify({ hello: "from node" })).toString("base64"),
            })
          );
        }
      });

      await new Promise((r) => setTimeout(r, 200));
      expect(tunnelId).toMatch(/^tun_[0-9a-f]{32}$/);

      // Send request to tunnel endpoint
      const tunnelHttpRes = await fetch(`http://127.0.0.1:${port}/t/${tunnelId}/api/v1/ping`);
      expect(tunnelHttpRes.status).toBe(200);
      const resData = await tunnelHttpRes.json();
      expect(resData.hello).toBe("from node");

      tunnelWs.close();
    } finally {
      await service.close();
    }
  });
});

describe("Relay hardening", () => {
  type Keys = ReturnType<typeof generateSigningKeyPair>;

  async function call(
    relay: ReturnType<typeof createRelayApp>,
    method: string,
    path: string,
    body: unknown,
    signer: Keys
  ) {
    const raw = new TextEncoder().encode(JSON.stringify(body));
    return relay.app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...signRequest(method, path, Date.now(), raw, signer),
      },
      body: raw,
    });
  }

  async function docWithOwner(relay: ReturnType<typeof createRelayApp>, docId: string) {
    const owner = generateSigningKeyPair();
    const ownerEnc = generateEncryptionKeyPair();
    const members = [
      { key: owner.publicKeyBase64, encKey: ownerEnc.publicKeyBase64, role: "owner" as const },
    ];
    const acl: SignedAcl = {
      docId,
      version: 1,
      keyEpoch: 1,
      members,
      ownerSignature: signEd25519(
        new TextEncoder().encode(JSON.stringify({ docId, version: 1, keyEpoch: 1, members })),
        owner.privateKey
      ),
    };
    const res = await call(relay, "PUT", `/v1/docs/${docId}`, { acl }, owner);
    expect(res.status).toBe(200);
    return owner;
  }

  async function createInvite(
    relay: ReturnType<typeof createRelayApp>,
    docId: string,
    owner: Keys
  ): Promise<{ inviteId: string; secret: string }> {
    const secret = generateInviteSecret();
    const res = await call(
      relay,
      "POST",
      `/v1/docs/${docId}/invites`,
      {
        role: "contribute",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        secretHash: hashInviteSecret(secret),
      },
      owner
    );
    expect(res.status).toBe(201);
    const { inviteId } = await res.json();
    return { inviteId, secret };
  }

  function accept(
    relay: ReturnType<typeof createRelayApp>,
    inviteId: string,
    signer: Keys,
    secret: string,
    key = signer.publicKeyBase64
  ) {
    return call(
      relay,
      "POST",
      `/v1/invites/${inviteId}/accept`,
      { key, encKey: generateEncryptionKeyPair().publicKeyBase64, secret },
      signer
    );
  }

  it("lets an invite be accepted only once", async () => {
    const relay = createRelayApp();
    const owner = await docWithOwner(relay, "doc_accept_once");
    const { inviteId, secret } = await createInvite(relay, "doc_accept_once", owner);

    const invitee = generateSigningKeyPair();
    expect((await accept(relay, inviteId, invitee, secret)).status).toBe(200);

    // Even a holder of the secret cannot rebind an accepted invite.
    const late = generateSigningKeyPair();
    expect((await accept(relay, inviteId, late, secret)).status).toBe(409);
    expect(relay.db.getInvite(inviteId)?.inviteeKey).toBe(invitee.publicKeyBase64);
  });

  it("issues 128-bit random invite ids", async () => {
    const relay = createRelayApp();
    const owner = await docWithOwner(relay, "doc_ids");
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { inviteId } = await createInvite(relay, "doc_ids", owner);
      expect(inviteId).toMatch(/^inv_[0-9a-f]{32}$/);
      ids.add(inviteId);
    }
    expect(ids.size).toBe(5);
  });

  it("requires a secret hash when creating an invite", async () => {
    const relay = createRelayApp();
    const owner = await docWithOwner(relay, "doc_no_hash");
    const res = await call(
      relay,
      "POST",
      "/v1/docs/doc_no_hash/invites",
      { role: "view", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      owner
    );
    expect(res.status).toBe(400);
  });

  it("does not let a non-invitee accept a pending invite", async () => {
    const relay = createRelayApp();
    const owner = await docWithOwner(relay, "doc_hijack");
    const { inviteId, secret } = await createInvite(relay, "doc_hijack", owner);
    const attacker = generateSigningKeyPair();

    // Knows the inviteId but not the out-of-band secret.
    expect((await accept(relay, inviteId, attacker, generateInviteSecret())).status).toBe(403);
    // Missing secret entirely.
    const noSecret = await call(
      relay,
      "POST",
      `/v1/invites/${inviteId}/accept`,
      { key: attacker.publicKeyBase64, encKey: generateEncryptionKeyPair().publicKeyBase64 },
      attacker
    );
    expect(noSecret.status).toBe(400);
    // Signs with its own key but tries to bind someone else's key.
    const victim = generateSigningKeyPair();
    expect((await accept(relay, inviteId, attacker, secret, victim.publicKeyBase64)).status).toBe(
      403
    );

    const invite = relay.db.getInvite(inviteId);
    expect(invite?.status).toBe("pending");
    expect(invite?.inviteeKey).toBeNull();

    // The real invitee still can.
    const invitee = generateSigningKeyPair();
    expect((await accept(relay, inviteId, invitee, secret)).status).toBe(200);
  });

  it("rejects a replayed signed request", async () => {
    const relay = createRelayApp();
    const owner = await docWithOwner(relay, "doc_replay");
    const path = "/v1/docs/doc_replay/changes";
    const headers = signRequest("GET", path, Date.now(), new Uint8Array(), owner);
    const first = await relay.app.request(path, { method: "GET", headers });
    expect(first.status).toBe(200);
    const replay = await relay.app.request(path, { method: "GET", headers });
    expect(replay.status).toBe(401);
    expect((await replay.json()).error).toContain("Replayed");
  });

  it("rejects requests without a nonce", async () => {
    const relay = createRelayApp();
    const owner = await docWithOwner(relay, "doc_no_nonce");
    const path = "/v1/docs/doc_no_nonce/changes";
    const { "X-Dcg-Nonce": _nonce, ...headers } = signRequest(
      "GET",
      path,
      Date.now(),
      new Uint8Array(),
      owner
    );
    const res = await relay.app.request(path, { method: "GET", headers });
    expect(res.status).toBe(401);
  });

  it("rejects query-string tampering", async () => {
    const relay = createRelayApp();
    const owner = await docWithOwner(relay, "doc_query");
    const signed = "/v1/docs/doc_query/changes?after=0&limit=10";
    const ok = await relay.app.request(signed, {
      method: "GET",
      headers: signRequest("GET", signed, Date.now(), new Uint8Array(), owner),
    });
    expect(ok.status).toBe(200);

    const tampered = await relay.app.request("/v1/docs/doc_query/changes?after=5&limit=10", {
      method: "GET",
      headers: signRequest("GET", signed, Date.now(), new Uint8Array(), owner),
    });
    expect(tampered.status).toBe(401);
  });

  it("rate-limits mutating requests per signer key", async () => {
    const relay = createRelayApp({
      rateLimits: { key: { capacity: 3, refillPerSecond: 0 } },
    });
    const owner = await docWithOwner(relay, "doc_rate_key"); // 1st token
    const path = "/v1/docs/doc_rate_key/snapshots";
    const snap = { seq: 1, keyEpoch: 1, nonce: "n", ciphertext: "c" };
    expect((await call(relay, "POST", path, snap, owner)).status).toBe(200);
    expect((await call(relay, "POST", path, snap, owner)).status).toBe(200);
    const limited = await call(relay, "POST", path, snap, owner);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();

    // Reads are not limited per key, and another key has its own bucket.
    const read = "/v1/docs/doc_rate_key/changes";
    const readRes = await relay.app.request(read, {
      method: "GET",
      headers: signRequest("GET", read, Date.now(), new Uint8Array(), owner),
    });
    expect(readRes.status).toBe(200);
  });

  it("rate-limits mutating requests per client IP before verifying signatures", async () => {
    const relay = createRelayApp({ rateLimits: { ip: { capacity: 2, refillPerSecond: 0 } } });
    const res = [];
    for (let i = 0; i < 3; i++) {
      res.push((await relay.app.request("/v1/docs/x", { method: "PUT", body: "{}" })).status);
    }
    expect(res).toEqual([401, 401, 429]);
  });

  it("rate-limits tunnel endpoints", async () => {
    const relay = createRelayApp({ rateLimits: { ip: { capacity: 2, refillPerSecond: 0 } } });
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await relay.app.request("/t/tun_unknown/api/v1/ping")).status);
    }
    expect(statuses).toEqual([503, 503, 429]);
  });

  it("rejects unauthenticated live WebSocket subscriptions", async () => {
    const service = await startRelayServer({ limits: { liveAuthTimeoutMs: 300 } });
    try {
      const owner = generateSigningKeyPair();
      const ownerEnc = generateEncryptionKeyPair();
      const members = [
        { key: owner.publicKeyBase64, encKey: ownerEnc.publicKeyBase64, role: "owner" as const },
      ];
      service.db.saveDoc("doc_ws", {
        docId: "doc_ws",
        version: 1,
        keyEpoch: 1,
        members,
        ownerSignature: signEd25519(
          new TextEncoder().encode(
            JSON.stringify({ docId: "doc_ws", version: 1, keyEpoch: 1, members })
          ),
          owner.privateKey
        ),
      });

      // No subscribe message at all -> closed after the auth timeout.
      const silent = await openLive(service.port, "doc_ws");
      expect((await silent.closed).code).toBe(1008);

      // Unsigned subscribe -> rejected.
      const unsigned = await openLive(service.port, "doc_ws", undefined, { type: "subscribe" });
      expect((await unsigned.closed).code).toBe(1008);

      // Validly signed by a non-member -> rejected.
      const outsider = await openLive(service.port, "doc_ws", generateSigningKeyPair());
      expect((await outsider.closed).code).toBe(1008);
      expect(outsider.events[0]?.error).toContain("not an ACL member");

      // Signed for a different doc (signature does not cover this doc) -> rejected.
      const sig = signRequest(
        "WS",
        "/v1/docs/other/live",
        Date.now(),
        new TextEncoder().encode(JSON.stringify({ type: "subscribe", docId: "other" })),
        owner
      );
      const wrongDoc = await openLive(service.port, "doc_ws", undefined, {
        type: "subscribe",
        key: sig["X-Dcg-Key"],
        timestamp: sig["X-Dcg-Timestamp"],
        nonce: sig["X-Dcg-Nonce"],
        signature: sig["X-Dcg-Signature"],
      });
      expect((await wrongDoc.closed).code).toBe(1008);

      // The member subscribes; a second subscribe on the same socket closes it.
      const member = await openLive(service.port, "doc_ws", owner);
      expect(member.events[0]).toEqual({ type: "subscribed", docId: "doc_ws" });
      member.ws.send(JSON.stringify({ type: "subscribe" }));
      expect((await member.closed).code).toBe(1008);
    } finally {
      await service.close();
    }
  });

  it("caps live subscribers per doc", async () => {
    const service = await startRelayServer({ limits: { maxLiveSubscribersPerDoc: 1 } });
    try {
      const owner = generateSigningKeyPair();
      const members = [
        {
          key: owner.publicKeyBase64,
          encKey: generateEncryptionKeyPair().publicKeyBase64,
          role: "owner" as const,
        },
      ];
      service.db.saveDoc("doc_cap", {
        docId: "doc_cap",
        version: 1,
        keyEpoch: 1,
        members,
        ownerSignature: "unused-by-live",
      });
      const first = await openLive(service.port, "doc_cap", owner);
      expect(first.events[0]?.type).toBe("subscribed");
      const second = await openLive(service.port, "doc_cap", owner);
      expect((await second.closed).code).toBe(1008);
      expect(second.events[0]?.error).toContain("Too many");
      first.ws.close();
    } finally {
      await service.close();
    }
  });

  it("applies the batch size and storage limits to snapshots", async () => {
    const relay = createRelayApp({ limits: { maxBatchSizeBytes: 1024, maxDocStorageBytes: 2048 } });
    const owner = await docWithOwner(relay, "doc_snap_limits");
    const snapshot = (size: number) => ({
      seq: 1,
      keyEpoch: 1,
      nonce: "n",
      ciphertext: "x".repeat(size),
    });
    const path = "/v1/docs/doc_snap_limits/snapshots";
    expect((await call(relay, "POST", path, snapshot(100), owner)).status).toBe(200);
    expect((await call(relay, "POST", path, snapshot(5000), owner)).status).toBe(413);
  });
});
