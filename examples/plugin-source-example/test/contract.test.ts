import { runIdeaSourceContractTests } from "@decisionator/plugin-sdk/testing";
import { describe } from "vitest";
import { SimpleListIdeaSource } from "../src/index.js";

describe("SimpleListIdeaSource Contract Compliance", () => {
  runIdeaSourceContractTests(new SimpleListIdeaSource());
});
