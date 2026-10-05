import { stripCitations } from "./extract.js";

export interface NormalizedOptionCandidate {
  id?: string;
  title: string;
  description: string;
  category?: string;
  tags: string[];
  pros: string[];
  cons: string[];
  effort?: "XS" | "S" | "M" | "L" | "XL";
  links: { url: string; title?: string }[];
  status: "active";
}

export type ValidateResult =
  | {
      ok: true;
      project?: { title: string; description?: string };
      options: NormalizedOptionCandidate[];
      warnings: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings: string[];
    };

function truncateString(
  str: string,
  maxLength: number,
  fieldName: string,
  warnings: string[]
): string {
  if (str.length > maxLength) {
    warnings.push(`${fieldName} exceeded maximum length of ${maxLength} chars and was truncated`);
    return str.substring(0, maxLength);
  }
  return str;
}

function normalizeStringList(val: unknown, fieldName: string, warnings: string[]): string[] {
  if (!val) return [];
  if (typeof val === "string") {
    warnings.push(`${fieldName} was provided as a string and wrapped into a list`);
    return [val.trim()];
  }
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((s) => s.length > 0);
  }
  return [];
}

export function validateOptionsPayload(
  rawJsonStr: string,
  initialWarnings: string[] = []
): ValidateResult {
  const warnings: string[] = [...initialWarnings];
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonStr);
  } catch (err) {
    return {
      ok: false,
      errors: [`JSON parse error: ${err instanceof Error ? err.message : String(err)}`],
      warnings,
    };
  }

  let optionsRaw: unknown[] = [];
  let projectMeta: { title: string; description?: string } | undefined;

  // Rule 3: Bare array accepted as options
  if (Array.isArray(parsed)) {
    warnings.push("Response provided as a bare array; format v1 assumed");
    optionsRaw = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Check unknown top-level keys
    const knownTopKeys = new Set(["format", "project", "options"]);
    for (const k of Object.keys(obj)) {
      if (!knownTopKeys.has(k)) {
        warnings.push(`Unknown top-level field "${k}" ignored`);
      }
    }

    if (obj.project && typeof obj.project === "object") {
      const proj = obj.project as Record<string, unknown>;
      if (typeof proj.title === "string") {
        projectMeta = {
          title: truncateString(proj.title.trim(), 200, "project.title", warnings),
          description: typeof proj.description === "string" ? proj.description.trim() : undefined,
        };
      }
    }

    if (Array.isArray(obj.options)) {
      optionsRaw = obj.options;
    } else {
      errors.push("Missing required field 'options' or options is not an array");
    }
  } else {
    return {
      ok: false,
      errors: ["Invalid JSON root: expected object or array"],
      warnings,
    };
  }

  if (optionsRaw.length === 0) {
    errors.push("Options array is empty (minimum 1 required)");
  }

  if (optionsRaw.length > 500) {
    warnings.push("Options array exceeded maximum 500 items and was capped");
    optionsRaw = optionsRaw.slice(0, 500);
  }

  const normalizedOptions: NormalizedOptionCandidate[] = [];

  const validEfforts = new Set(["XS", "S", "M", "L", "XL"]);
  const knownOptionKeys = new Set([
    "id",
    "title",
    "description",
    "category",
    "tags",
    "pros",
    "cons",
    "effort",
    "links",
    "status",
  ]);

  for (let idx = 0; idx < optionsRaw.length; idx++) {
    const rawOpt = optionsRaw[idx];
    const pathPrefix = `options[${idx}]`;

    if (typeof rawOpt !== "object" || rawOpt === null) {
      errors.push(`${pathPrefix}: expected option object`);
      continue;
    }

    const opt = rawOpt as Record<string, unknown>;

    // Warn unknown keys
    for (const key of Object.keys(opt)) {
      if (!knownOptionKeys.has(key)) {
        warnings.push(`${pathPrefix}.${key}: unknown field ignored`);
      }
    }

    // Title validation
    if (!opt.title || typeof opt.title !== "string" || opt.title.trim() === "") {
      errors.push(`${pathPrefix}.title: missing or empty`);
      continue;
    }

    const strippedTitle = stripCitations(opt.title);
    if (strippedTitle.found) {
      warnings.push("Assistant citation markers were stripped from option content");
    }
    const title = truncateString(
      strippedTitle.cleaned.trim(),
      200,
      `${pathPrefix}.title`,
      warnings
    );

    // Description
    let description = "";
    if (typeof opt.description === "string") {
      const strippedDesc = stripCitations(opt.description);
      if (strippedDesc.found && !strippedTitle.found) {
        warnings.push("Assistant citation markers were stripped from option content");
      }
      description = truncateString(
        strippedDesc.cleaned.trim(),
        20_000,
        `${pathPrefix}.description`,
        warnings
      );
    }

    // Category
    let category: string | undefined;
    if (typeof opt.category === "string" && opt.category.trim() !== "") {
      const cleanedCat = stripCitations(opt.category).cleaned.trim();
      category = truncateString(cleanedCat, 60, `${pathPrefix}.category`, warnings);
    }

    // Tags
    const tags = normalizeStringList(opt.tags, `${pathPrefix}.tags`, warnings)
      .slice(0, 10)
      .map((t) => truncateString(t, 40, `${pathPrefix}.tags[]`, warnings));

    // Pros & Cons
    const pros = normalizeStringList(opt.pros, `${pathPrefix}.pros`, warnings).slice(0, 20);
    const cons = normalizeStringList(opt.cons, `${pathPrefix}.cons`, warnings).slice(0, 20);

    // Effort
    let effort: "XS" | "S" | "M" | "L" | "XL" | undefined;
    if (typeof opt.effort === "string") {
      const upper = opt.effort.toUpperCase().trim();
      if (validEfforts.has(upper)) {
        effort = upper as "XS" | "S" | "M" | "L" | "XL";
      } else {
        warnings.push(`${pathPrefix}.effort: invalid value "${opt.effort}" ignored`);
      }
    }

    // Links
    const links: { url: string; title?: string }[] = [];
    if (Array.isArray(opt.links)) {
      for (const linkItem of opt.links.slice(0, 10)) {
        if (typeof linkItem === "string" && linkItem.startsWith("http")) {
          links.push({ url: linkItem });
        } else if (typeof linkItem === "object" && linkItem !== null) {
          const lObj = linkItem as Record<string, unknown>;
          if (typeof lObj.url === "string" && lObj.url.startsWith("http")) {
            links.push({
              url: lObj.url,
              title: typeof lObj.title === "string" ? lObj.title : undefined,
            });
          }
        }
      }
    }

    normalizedOptions.push({
      id: typeof opt.id === "string" ? opt.id : undefined,
      title,
      description,
      category,
      tags,
      pros,
      cons,
      effort,
      links,
      status: "active",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    project: projectMeta,
    options: normalizedOptions,
    warnings,
  };
}
