import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractOptionsJson } from "../../src/format/extract.js";
import { validateOptionsPayload } from "../../src/format/validate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesRoot = path.resolve(__dirname, "../fixtures/format-answers");

describe("SC-002 Replay Quality Gate (T036)", () => {
  const versions = ["v1.0", "v1.1", "v1.2"];

  for (const v of versions) {
    const vDir = path.join(fixturesRoot, v, "answers");
    if (!fs.existsSync(vDir)) continue;

    const sampleDirs = fs.readdirSync(vDir);

    it(`replays ${v} fixture answers (quality gate ≥ 90% for current v1.2)`, () => {
      let totalCount = 0;
      let validCount = 0;
      const failures: string[] = [];

      for (const sample of sampleDirs) {
        const samplePath = path.join(vDir, sample);
        if (!fs.statSync(samplePath).isDirectory()) continue;

        const files = fs.readdirSync(samplePath);
        for (const file of files) {
          if (!file.endsWith(".txt")) continue;
          totalCount++;
          const content = fs.readFileSync(path.join(samplePath, file), "utf-8");

          try {
            const extracted = extractOptionsJson(content);
            if (extracted.kind === "single") {
              const validation = validateOptionsPayload(extracted.json);
              if (validation.ok) {
                validCount++;
              } else {
                failures.push(`${v}/${sample}/${file}: ${validation.errors.join("; ")}`);
              }
            } else {
              failures.push(`${v}/${sample}/${file}: extraction resulted in ${extracted.kind}`);
            }
          } catch (err) {
            failures.push(`${v}/${sample}/${file}: threw error ${err}`);
          }
        }
      }

      const passRate = totalCount > 0 ? (validCount / totalCount) * 100 : 0;
      console.log(`${v} Pass Rate: ${validCount}/${totalCount} (${passRate.toFixed(1)}%)`);

      if (v === "v1.2") {
        // Quality Gate SC-002: ≥ 90% must pass on first paste for current template v1.2
        if (failures.length > 0) {
          console.warn(`v1.2 failures:\n${failures.join("\n")}`);
        }
        expect(passRate).toBeGreaterThanOrEqual(90);
      }
    });
  }
});
