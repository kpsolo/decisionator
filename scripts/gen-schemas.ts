import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  CommentSchema,
  GradeSchema,
  OptionSchema,
  OutcomeRecordSchema,
  ProjectExportV1Schema,
  ProjectSchema,
  RankingSchema,
} from "../packages/core/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaDir = path.resolve(__dirname, "../packages/core/schema");

if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir, { recursive: true });
}

const schemas = {
  project: ProjectSchema,
  option: OptionSchema,
  grade: GradeSchema,
  comment: CommentSchema,
  ranking: RankingSchema,
  outcome: OutcomeRecordSchema,
  "project-export-v1": ProjectExportV1Schema,
};

for (const [name, schema] of Object.entries(schemas)) {
  const jsonSchema = zodToJsonSchema(schema, name);
  const targetPath = path.join(schemaDir, `${name}.schema.json`);
  fs.writeFileSync(targetPath, JSON.stringify(jsonSchema, null, 2), "utf-8");
  console.log(`Generated schema: ${targetPath}`);
}
