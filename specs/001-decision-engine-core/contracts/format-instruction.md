# Contract: Format Instruction — v1.2.0

The text Deci shows when no AI is connected (spec FR-002). The user copies it to any AI
assistant and pastes the answer back. The same template is sent automatically to connected
agents in US5. The template is versioned together with
[options-format.schema.json](./options-format.schema.json).

## Template

`{{PASTED_TEXT}}` is the user's raw paste, inserted verbatim between the markers.
`{{LOCALE_HINT}}` is filled by Deci (see "Language hint" below), for example "Write all text in
English, even if you usually reply in another language."

````text
Turn the idea list below into JSON for Deci.

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
{{LOCALE_HINT}}

Example of the expected shape:
```json
{"format":"decisionator.options/v1","project":{"title":"Weekend plans"},"options":[{"title":"Picnic in the park","description":"Bring food and games to the city park.","category":"Outdoors","tags":["food","friends"],"effort":"XS"}]}
```

Idea list:
<<<IDEAS
{{PASTED_TEXT}}
IDEAS>>>
````

## Language hint

Deci always fills `{{LOCALE_HINT}}` with an explicit language, because "the same language as the
list" alone was not enough: in fixture `v1.1/02/gemini` Gemini translated an English list into
Ukrainian.

1. If the user picked an output language in the format step, use it.
2. Otherwise, detect the language of the pasted text in the browser, with a small client-side
   detector (`franc-min`, MIT) over the text after list markers are stripped.
3. If detection is not confident (text under 20 characters, or no clear winner), use the UI
   language.

Hint text: `Write all text in <Language>, even if you usually reply in another language.` The user
can change the language in the format step before copying. The fixture generator uses a
script-based stand-in (Cyrillic → Ukrainian, Latin with English stop words → English), and an
`inputs/<name>.hint.txt` file overrides it.

## Correction template

Used after validation fails (FR-004). `{{ERRORS}}` is a bullet list such as
`- options[3].title: missing`.

````text
Your JSON for Deci has these problems:
{{ERRORS}}
Reply with the corrected JSON only, in one code block, same structure as before.
````

## Extraction rules (host)

1. If the answer contains a ```json fenced block, use it. If there are several, ask the user to
   choose.
2. Otherwise, take the first balanced `{…}` or `[…]`.
3. A bare array is accepted as `options`, with `format` assumed to be v1. A warning is shown.
4. Unknown fields are ignored and listed as warnings. Over-length strings are truncated, with a
   warning.
5. Assistant citation markers are removed from every string, with one warning per answer. These
   are tokens matching `\[cite(?:_start|_end)?(?::[^\]]*)?\]`, such as Gemini's `[cite: 5]` and
   `[cite_start]`. Found in fixture `05/gemini` (2026-10-05).
6. A single string where a list of strings is expected (`tags`, `pros`, `cons`) is wrapped into a
   one-item list, with one warning per answer. Found in fixture `v1.1/01/gemini` (2026-10-05),
   where all 50 options gave `pros` and `cons` as strings.

## Quality gate

SC-002: at least 90% of answers validate on the first paste. This is measured on 5 sample lists
× each launch assistant (Claude, Gemini), for the **current** template version. Answers are
stored per template version in `packages/core/test/fixtures/format-answers/v<major.minor>/` and
replayed in CI. Older versions stay as a baseline. Any change to the template must re-collect
answers and keep this pass rate.

## Changelog

| Version | Date | Change | Evidence |
|---------|------|--------|----------|
| 1.2.0 | 2026-10-05 | `pros`/`cons` stated as lists of short phrases, with an example; `{{LOCALE_HINT}}` always filled with an explicit language | v1.1 Gemini answers: `pros`/`cons` as strings (01); Ukrainian output for an English list despite the same-language rule (02) |
| 1.1.0 | 2026-10-05 | Same-language rule; skip non-ideas and merge duplicates (replaces "keep unclear text as title"); clean titles; no invented facts, one sentence for title-only ideas; URLs into `links`; project title from the list's heading; "no citations"; neutral example project title | v1.0 Gemini answers: Ukrainian output without a hint (02, 05), "ask Ben…" kept as an option (02), notes left in titles (02), invented features (03), copied example project title (01), `[cite: N]` markers (02–05) |
| 1.0.0 | 2026-10-05 | Initial template | — |
