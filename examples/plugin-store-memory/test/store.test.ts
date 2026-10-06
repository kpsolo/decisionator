import { describe, expect, it } from "vitest";
import { MemoryProjectStore } from "../src/index.js";

describe("MemoryProjectStore Compliance", () => {
  it("creates, retrieves, and appends to projects", async () => {
    const store = new MemoryProjectStore("alice@example.com");
    const ref = await store.createProject({
      title: "Test Memory Project",
      options: [
        {
          id: "opt_1",
          order: 1,
          title: "Option One",
          status: "active",
          tags: [],
          pros: [],
          cons: [],
          links: [],
          at: new Date().toISOString(),
          by: "alice@example.com",
        },
      ],
    });

    let snap = await store.openProject(ref);
    expect(snap.project.title).toBe("Test Memory Project");
    expect(snap.options.length).toBe(1);

    await store.append(ref, [
      {
        kind: "grade",
        optionId: "opt_1",
        value: 5,
      },
    ]);

    snap = await store.openProject(ref);
    expect(snap.grades.length).toBe(1);
    expect(snap.grades[0]?.value).toBe(5);
  });

  it("handles password protected projects", async () => {
    const store = new MemoryProjectStore("alice@example.com");
    const ref = await store.createProject(
      { title: "Secret", options: [] },
      { password: "password123456" }
    );

    await expect(store.openProject(ref)).rejects.toThrow("Invalid password");
    const snap = await store.openProject(ref, { password: "password123456" });
    expect(snap.project.title).toBe("Secret");
  });
});
