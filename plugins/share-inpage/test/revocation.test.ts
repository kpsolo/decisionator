import { describe, expect, it } from "vitest";
import { LiveShareGuest } from "../src/guest.js";
import { LiveShareHost } from "../src/host.js";
import { type Link, createLink, createPipePair } from "../src/link.js";
import { FakeProject, until } from "./fixtures.js";

function connectPair(accept: (link: Link) => void): Link {
  const [hostPipe, guestPipe] = createPipePair();
  accept(createLink(hostPipe));
  return createLink(guestPipe);
}

async function startHost(project = new FakeProject()) {
  const host = new LiveShareHost({ project });
  await host.start();
  return { host, project };
}

function makeGuest(host: LiveShareHost, displayName = "Alice") {
  const guest = new LiveShareGuest({
    sessionId: "test-session",
    deviceSecret: "0123456789abcdef0123456789abcdef",
    displayName,
    dial: async () => connectPair((link) => host.accept(link)),
  });
  return guest;
}

describe("session revocation", () => {
  it("host sends closing frame with code: 'session_revoked' and closes links", async () => {
    const { host } = await startHost();
    const guest = makeGuest(host, "Alice");
    guest.start();
    await until(() => guest.getState().status === "live");

    expect(guest.getState().status).toBe("live");

    // Host revokes session
    host.revoke("This session link has been revoked by the owner.");

    // Guest should transition to 'revoked'
    await until(() => guest.getState().status === "revoked");
    expect(guest.getState().status).toBe("revoked");
    expect(guest.getState().message).toBe("This session link has been revoked by the owner.");
    expect(host.getState().status).toBe("closed");
  });

  it("revoked guest stops dialing and does not reconnect", async () => {
    const { host } = await startHost();
    const guest = makeGuest(host, "Alice");
    guest.start();
    await until(() => guest.getState().status === "live");

    host.revoke();
    await until(() => guest.getState().status === "revoked");

    // Wait a brief period and ensure guest stays in 'revoked' status
    await new Promise((r) => setTimeout(r, 100));
    expect(guest.getState().status).toBe("revoked");
  });

  it("multiple connected guests are all ejected with session_revoked", async () => {
    const { host } = await startHost();
    const alice = makeGuest(host, "Alice");
    const bob = makeGuest(host, "Bob");
    alice.start();
    bob.start();
    await until(() => alice.getState().status === "live" && bob.getState().status === "live");

    host.revoke();

    await until(() => alice.getState().status === "revoked" && bob.getState().status === "revoked");
    expect(alice.getState().status).toBe("revoked");
    expect(bob.getState().status).toBe("revoked");
  });

  it("emits notice when host resets guest votes", async () => {
    const { host, project } = await startHost();
    let noticed = "";
    const guest = new LiveShareGuest({
      sessionId: "test-session",
      deviceSecret: "0123456789abcdef0123456789abcdef",
      displayName: "Alice",
      dial: async () => connectPair((link) => host.accept(link)),
      onNotice: (msg) => {
        noticed = msg;
      },
    });

    guest.start();
    await until(() => guest.getState().status === "live");

    // Alice grades an option
    await guest.submit([{ kind: "grade", optionId: "a", value: 5 }]);
    await until(() => (guest.getState().snapshot?.grades.length ?? 0) > 0);

    const participantId = guest.getState().participantId!;
    expect(participantId).toBeTruthy();

    // Owner drops Alice's votes by appending reset
    await project.ownerAppend([
      { kind: "reset", scope: "participant", participantId, targets: ["grades"] },
      { kind: "reset", scope: "participant", participantId, targets: ["ballots"], round: 1 },
    ]);

    await until(() => noticed === "The host reset your votes.");
    expect(noticed).toBe("The host reset your votes.");
    expect(guest.getState().notice).toBe("The host reset your votes.");
  });
});

