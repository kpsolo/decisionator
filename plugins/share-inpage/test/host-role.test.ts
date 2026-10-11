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

async function startHost(
  project = new FakeProject(),
  initialRole: "contribute" | "view" = "contribute"
) {
  const host = new LiveShareHost({ project, role: initialRole });
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

describe("dynamic host role toggle", () => {
  it("allows contributions initially, then rejects submissions when set to view", async () => {
    const { host, project } = await startHost();
    const guest = makeGuest(host, "Alice");
    guest.start();
    await until(() => guest.getState().status === "live");

    expect(host.getRole()).toBe("contribute");
    expect(guest.getState().role).toBe("contribute");

    // Alice can submit in contribute mode
    await guest.submit([{ kind: "grade", optionId: "a", value: 4 }]);
    expect(project.appendCalls).toHaveLength(1);

    // Host toggles to read-only ("view")
    host.setRole("view");
    expect(host.getRole()).toBe("view");

    // Guest receives snapshot with updated role
    await until(() => guest.getState().role === "view");
    expect(guest.getState().role).toBe("view");

    // Submissions are rejected with read_only error
    await expect(guest.submit([{ kind: "grade", optionId: "b", value: 5 }])).rejects.toMatchObject({
      code: "read_only",
      message: "The host made this session view-only.",
    });

    // Toggle back to contribute
    host.setRole("contribute");
    expect(host.getRole()).toBe("contribute");

    await until(() => guest.getState().role === "contribute");
    expect(guest.getState().role).toBe("contribute");

    // Alice can submit again
    await guest.submit([{ kind: "grade", optionId: "b", value: 5 }]);
    expect(project.appendCalls).toHaveLength(2);
  });

  it("broadcasts role to all connected guests when setRole is called", async () => {
    const { host } = await startHost();
    const alice = makeGuest(host, "Alice");
    const bob = makeGuest(host, "Bob");
    alice.start();
    bob.start();
    await until(() => alice.getState().status === "live" && bob.getState().status === "live");

    expect(alice.getState().role).toBe("contribute");
    expect(bob.getState().role).toBe("contribute");

    host.setRole("view");

    await until(() => alice.getState().role === "view" && bob.getState().role === "view");
    expect(alice.getState().role).toBe("view");
    expect(bob.getState().role).toBe("view");
  });
});
