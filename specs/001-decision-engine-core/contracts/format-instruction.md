# Contract: Format Instruction — v1.0.0

The text Deci shows when no AI is connected (spec FR-002). The user copies it to any AI
assistant and pastes the answer back. The same template is sent automatically to connected
agents in US5. The template is versioned together with
[options-format.schema.json](./options-format.schema.json).

## Template

`{{PASTED_TEXT}}` is the user's raw paste, inserted verbatim between the markers.
`{{LOCALE_HINT}}` is optional ("Write descriptions in Ukrainian.").

````text
Turn the idea list below into JSON for Decisionator.

Rules:
- Reply with ONLY one JSON code block, no other text.
- Use exactly this structure: {"format": "decisionator.options/v1", "project": {"title": "..."}, "options": [ ... ]}
- One option per distinct idea. Keep the author's meaning; do not invent new ideas.
- For each option: "title" (short, required), "description" (1–3 sentences),
  "category" (one short group name; reuse the same names across options),
  "tags" (up to 5), "pros" and "cons" (short phrases, optional),
  "effort" (one of XS, S, M, L, XL, optional).
- If an idea is unclear, keep its original text as the title and leave other fields out.
{{LOCALE_HINT}}

Example of the expected shape:
```json
{"format":"decisionator.options/v1","project":{"title":"Which app do we build next?"},"options":[{"title":"Receipt splitter","description":"Photograph a receipt and split items between people.","category":"Finance","tags":["mobile"],"effort":"S"}]}
```

Idea list:
<<<IDEAS
{{PASTED_TEXT}}
IDEAS>>>
````

## Correction template

Used after validation fails (FR-004). `{{ERRORS}}` is a bullet list such as
`- options[3].title: missing`.

````text
Your JSON for Decisionator has these problems:
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

## Quality gate

SC-002: at least 90% of answers validate on the first paste, measured on 5 sample lists × each
launch assistant (Claude, Grok, Muse, Dots). The answers are stored as fixtures in
`packages/core/test/fixtures/format-answers/` and replayed in CI. Any change to the template
must keep this pass rate.
