import { describe, expect, it } from "vitest";
import {
  CommentSchema,
  GradeSchema,
  OptionSchema,
  OutcomeRecordSchema,
  ProjectSchema,
  createRankingSchema,
} from "../src/index.js";

describe("Data Model Zod Schemas (T017)", () => {
  describe("ProjectSchema", () => {
    it("validates valid project", () => {
      const valid = {
        title: "Deci App Launch",
        description: "Launching the decision tool",
      };
      const result = ProjectSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.formatVersion).toBe(1);
        expect(result.data.voting.topN).toBe(3);
      }
    });

    it("rejects empty or over-length title", () => {
      expect(ProjectSchema.safeParse({ title: "" }).success).toBe(false);
      expect(ProjectSchema.safeParse({ title: "a".repeat(201) }).success).toBe(false);
      expect(ProjectSchema.safeParse({ title: "a".repeat(200) }).success).toBe(true);
    });

    it("rejects description over 20 000 chars", () => {
      expect(
        ProjectSchema.safeParse({
          title: "Test",
          description: "x".repeat(20001),
        }).success
      ).toBe(false);
      expect(
        ProjectSchema.safeParse({
          title: "Test",
          description: "x".repeat(20000),
        }).success
      ).toBe(true);
    });

    it("enforces voting boundaries", () => {
      expect(
        ProjectSchema.safeParse({
          title: "Test",
          voting: { state: "open", round: 0, topN: 3, liveResults: true },
        }).success
      ).toBe(false);

      expect(
        ProjectSchema.safeParse({
          title: "Test",
          voting: { state: "open", round: 1, topN: 11, liveResults: true },
        }).success
      ).toBe(false);

      expect(
        ProjectSchema.safeParse({
          title: "Test",
          voting: { state: "open", round: 1, topN: 10, liveResults: true },
        }).success
      ).toBe(true);
    });
  });

  describe("OptionSchema", () => {
    it("validates option boundaries", () => {
      expect(
        OptionSchema.safeParse({
          id: "01J00000000000000000000000",
          title: "Valid option",
          effort: "M",
          status: "active",
        }).success
      ).toBe(true);

      // Invalid effort
      expect(
        OptionSchema.safeParse({
          id: "01J00000000000000000000000",
          title: "Valid option",
          // @ts-expect-error invalid effort
          effort: "XXL",
        }).success
      ).toBe(false);

      // Tag max length 40, max items 10
      expect(
        OptionSchema.safeParse({
          id: "01J00000000000000000000000",
          title: "Valid option",
          tags: ["a".repeat(41)],
        }).success
      ).toBe(false);

      expect(
        OptionSchema.safeParse({
          id: "01J00000000000000000000000",
          title: "Valid option",
          tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
        }).success
      ).toBe(false);
    });
  });

  describe("GradeSchema & CommentSchema", () => {
    it("enforces grade value 1-5", () => {
      expect(
        GradeSchema.safeParse({
          id: "g1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          optionId: "opt1",
          value: 3,
        }).success
      ).toBe(true);

      expect(
        GradeSchema.safeParse({
          id: "g1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          optionId: "opt1",
          value: 6,
        }).success
      ).toBe(false);

      expect(
        GradeSchema.safeParse({
          id: "g1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          optionId: "opt1",
          value: 0,
        }).success
      ).toBe(false);
    });

    it("enforces comment body length 1-10 000 chars", () => {
      expect(
        CommentSchema.safeParse({
          id: "c1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          optionId: "opt1",
          body: "",
        }).success
      ).toBe(false);

      expect(
        CommentSchema.safeParse({
          id: "c1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          optionId: "opt1",
          body: "x".repeat(10001),
        }).success
      ).toBe(false);

      expect(
        CommentSchema.safeParse({
          id: "c1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          optionId: "opt1",
          body: "x".repeat(10000),
        }).success
      ).toBe(true);
    });
  });

  describe("RankingSchema", () => {
    it("enforces uniqueness and length <= topN", () => {
      const top3Schema = createRankingSchema(3);

      expect(
        top3Schema.safeParse({
          id: "r1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          round: 1,
          ranking: ["opt1", "opt2", "opt3"],
        }).success
      ).toBe(true);

      // Duplicates rejected
      expect(
        top3Schema.safeParse({
          id: "r1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          round: 1,
          ranking: ["opt1", "opt2", "opt1"],
        }).success
      ).toBe(false);

      // Exceeds topN
      expect(
        top3Schema.safeParse({
          id: "r1",
          at: "2026-10-05T12:00:00Z",
          by: "user@example.com",
          round: 1,
          ranking: ["opt1", "opt2", "opt3", "opt4"],
        }).success
      ).toBe(false);
    });
  });

  describe("OutcomeRecordSchema", () => {
    it("validates outcome record", () => {
      const outcome = {
        strategy: { id: "org.decisionator.strategy.borda", version: "1.0.0" },
        settings: { topN: 3 },
        inputs: {
          options: [{ id: "opt1", title: "Idea 1" }],
        },
        result: {
          winner: "opt1",
          order: [{ optionId: "opt1", points: 10, firstPlaces: 2 }],
        },
        tieBreak: "none",
        triggeredBy: "owner@example.com",
        at: "2026-10-05T12:00:00Z",
      };

      expect(OutcomeRecordSchema.safeParse(outcome).success).toBe(true);
    });
  });
});
