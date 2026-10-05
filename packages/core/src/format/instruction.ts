import { franc } from "franc-min";

export function detectLanguage(pastedText: string, defaultLocale = "English"): string {
  // Strip list markers and symbols before detection
  const cleanText = pastedText.replace(/^[\s*•\-–—\d.)\]]+/gm, "").trim();

  if (cleanText.length < 20) {
    return defaultLocale;
  }

  // Quick script check: Cyrillic -> Ukrainian default in our domain
  if (/[\u0400-\u04FF]/.test(cleanText)) {
    return "Ukrainian";
  }

  const code = franc(cleanText, { minLength: 15 });

  const map: Record<string, string> = {
    eng: "English",
    ukr: "Ukrainian",
    rus: "Russian",
    deu: "German",
    fra: "French",
    spa: "Spanish",
    pol: "Polish",
  };

  return map[code] || defaultLocale;
}

export function buildInstruction(pastedText: string, localeHint?: string): string {
  const language = localeHint || detectLanguage(pastedText);
  const localeLine = `Write all text in ${language}, even if you usually reply in another language.`;

  return `Turn the idea list below into JSON for Deci.

Rules:
- Reply with ONLY one JSON code block: no other text, no citations.
- Use exactly this structure: {"format": "decisionator.options/v1", "project": {"title": "..."}, "options": [ ... ]}
- Project title: the list's own heading if it has one, otherwise a short summary of the list.
- One option per distinct idea; merge duplicates. Skip lines that are not ideas
  (headings, notes, to-dos, questions for people).
- For titles and descriptions use only what the list says; do not invent ideas, features or facts.
  If an idea has only a title, write at most one short sentence.
- For each option: "title" (short, required; drop side notes such as "??" or "(check)"),
  "description" (1–3 sentences), "category" (one short group name; reuse the same names),
  "tags" (up to 5), "links" (any URLs from the list, as [{"url": "..."}]),
  and optionally your own short estimates: "pros" and "cons" (each a list of short phrases,
  e.g. ["Fast to build"]) and "effort" (one of XS, S, M, L, XL).
- Write all text in the same language as the idea list, unless told otherwise below.
${localeLine}

Example of the expected shape:
\`\`\`json
{"format":"decisionator.options/v1","project":{"title":"Weekend plans"},"options":[{"title":"Picnic in the park","description":"Bring food and games to the city park.","category":"Outdoors","tags":["food","friends"],"effort":"XS"}]}
\`\`\`

Idea list:
<<<IDEAS
${pastedText}
IDEAS>>>`;
}

export function buildCorrection(errors: string[]): string {
  const errorBullets = errors.map((e) => `- ${e}`).join("\n");
  return `Your JSON for Deci has these problems:
${errorBullets}
Reply with the corrected JSON only, in one code block, same structure as before.`;
}
