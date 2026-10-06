import {
  encryptXChaCha20,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
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

    // Step 1: Owner creates invite
    const inviteReq = {
      role: "contribute",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
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

    // Step 2: Invitee accepts invite presenting keys
    const acceptReq = { key: inviteeKey.publicKeyBase64, encKey: inviteeEncKey.publicKeyBase64 };
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

      // Test live notifications WebSocket
      const liveWs = new WebSocket(`ws://127.0.0.1:${port}/v1/docs/live-doc/live`);
      const liveEvents: { type: string; docId: string; seq: number }[] = [];
      liveWs.on("message", (data) => {
        liveEvents.push(JSON.parse(data.toString()));
      });

      await new Promise((r) => liveWs.on("open", r));

      // Append change to trigger live event
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
      expect(liveEvents.length).toBe(1);
      const firstEvent = liveEvents[0];
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
      expect(tunnelId).toBeTruthy();

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
