import { describe, expect, it } from "vitest";
import {
  decodeCommentRow,
  decodeGradeRow,
  decodeOptionRow,
  decodeOutcomeRow,
  decodeRankingRow,
  encodeCommentRow,
  encodeGradeRow,
  encodeOptionRow,
} from "../src/rows.js";

describe("Google Sheets Row Codecs (T045)", () => {
  it("encodes and decodes option rows cleanly", async () => {
    const option = {
      id: "opt_123",
      order: 1,
      status: "active" as const,
      title: "Fast option",
      description: "A fast implementation",
      pros: ["fast"],
      cons: [],
      tags: [],
      links: [],
    };

    const row = await encodeOptionRow(option, "user@example.com");
    expect(row[0]).toBe("opt_123");
    expect(row[4]).toBe("user@example.com");

    const decoded = await decodeOptionRow(row, 2);
    expect(decoded.warning).toBeUndefined();
    expect(decoded.entity?.id).toBe("opt_123");
    expect(decoded.entity?.title).toBe("Fast option");
  });

  it("skips invalid rows and emits warning with row index", async () => {
    const invalidRow = ["opt_invalid", "0", "active", "", "user@example.com", "{ invalid json }"];
    const decoded = await decodeOptionRow(invalidRow, 5);
    expect(decoded.entity).toBeUndefined();
    expect(decoded.warning).toContain("options row 5: invalid JSON payload");
  });

  it("flags unknown participants in contributor tabs", async () => {
    const known = new Set(["known@example.com"]);
    const gradeRow = await encodeGradeRow({
      id: "grd_1",
      at: new Date().toISOString(),
      by: "unknown@example.com",
      optionId: "opt_123",
      value: 4,
    });

    const decoded = await decodeGradeRow(gradeRow, 2, known);
    expect(decoded.entity?.value).toBe(4);
    expect(decoded.unknownParticipant).toBe(true);
  });

  it("supports payload hook for enc:v1 transformation", async () => {
    const hook = (payload: string) => `enc:v1:fake:${Buffer.from(payload).toString("base64")}`;
    const unhook = (enc: string) => {
      const b64 = enc.split(":")[3] ?? "";
      return Buffer.from(b64, "base64").toString("utf-8");
    };

    const comment = {
      id: "c_1",
      at: "2026-10-05T00:00:00.000Z",
      by: "me@example.com",
      optionId: "opt_1",
      body: "Secret comment",
    };

    const encoded = await encodeCommentRow(comment, hook);
    expect(encoded[4]?.startsWith("enc:v1:")).toBe(true);

    const decoded = await decodeCommentRow(encoded, 2, undefined, unhook);
    expect(decoded.entity?.body).toBe("Secret comment");
  });
});
