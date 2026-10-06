import { runStrategyContractTests } from "@decisionator/plugin-sdk/testing";
import { describe } from "vitest";
import { FirstCandidateStrategy } from "../src/index.js";

describe("FirstCandidateStrategy Contract Compliance", () => {
  runStrategyContractTests(new FirstCandidateStrategy(), { minOptions: 2 });
});
