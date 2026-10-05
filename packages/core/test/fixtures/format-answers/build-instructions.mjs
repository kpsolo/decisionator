// Regenerates v<major.minor>/instructions/<name>.txt from inputs/<name>.txt using the current
// template in specs/001-decision-engine-core/contracts/format-instruction.md. The version folder
// comes from the contract's "— vX.Y.Z" heading, so older versions are never overwritten.
// An optional inputs/<name>.hint.txt fills {{LOCALE_HINT}}.
// Usage: node packages/core/test/fixtures/format-answers/build-instructions.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = join(here, "../../../../../specs/001-decision-engine-core/contracts/format-instruction.md");
const contract = readFileSync(contractPath, "utf8");
const [, major, minor] = /— v(\d+)\.(\d+)\.\d+/.exec(contract);
const template = /## Template[\s\S]*?````text\n([\s\S]*?)````/.exec(contract)[1];

const outDir = join(here, `v${major}.${minor}`, "instructions");
mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(join(here, "inputs"))) {
  if (!file.endsWith(".txt") || file.endsWith(".hint.txt")) continue;
  const name = file.slice(0, -4);
  const pasted = readFileSync(join(here, "inputs", file), "utf8").replace(/\n+$/, "");
  const hintFile = join(here, "inputs", `${name}.hint.txt`);
  const hint = existsSync(hintFile) ? readFileSync(hintFile, "utf8").trim() : "";
  const out = template
    .replace("{{LOCALE_HINT}}\n", hint ? `${hint}\n` : "")
    .replace("{{PASTED_TEXT}}", () => pasted);
  writeFileSync(join(outDir, file), out);
  console.log(`v${major}.${minor}/instructions/${file}${hint ? " (with locale hint)" : ""}`);
}
