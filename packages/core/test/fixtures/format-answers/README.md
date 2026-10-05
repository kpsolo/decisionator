# Format-answer fixtures (SC-002, task T036)

These are real answers from AI assistants to the format instruction in
`specs/001-decision-engine-core/contracts/format-instruction.md`. The test
`packages/core/test/format/fixtures.test.ts` replays every answer through extraction and
validation and asserts that at least 90% validate on the first paste.

## Layout

```text
inputs/<NN-name>.txt                        raw idea list, exactly as a user would paste it (shared by all versions)
inputs/<NN-name>.hint.txt                   optional {{LOCALE_HINT}} override (otherwise the language is detected)
v<X.Y>/instructions/<NN-name>.txt           instruction generated from template version X.Y; paste this into the assistant
v<X.Y>/answers/<NN-name>/<assistant>.txt    the assistant's full reply to that instruction, unedited
```

**Current template: v1.2.** `v1.0/` and `v1.1/` are kept as baselines; the SC-002 gate counts
only the current version's answers. Hint files and the generator's language detection apply to the
current version.

Assistant file names: `claude.txt` and `gemini.txt`, the launch compatibility list.

Regenerate the instructions after changing an input or the template:

```bash
node packages/core/test/fixtures/format-answers/build-instructions.mjs
```

## Collecting an answer

1. Open a **new chat** in the assistant, with default settings and no custom instructions.
2. Paste the whole `v1.2/instructions/<NN-name>.txt` file as one message (as text, not as an attached file).
3. Copy the **entire** reply, unedited, into `v1.2/answers/<NN-name>/<assistant>.txt`.
4. Add a line to the table below.

Never fix an answer by hand. A broken answer is exactly what the test should count.

## Sample lists

The SC-002 gate counts only whether an answer **validates**. The expected option counts below
are for judging quality (merging, dropping non-ideas, language), not part of the gate.

| ID | Input | Shape it tests | Expected options |
|----|-------|----------------|------------------|
| 01 | `01-app-ideas-50.txt` | 50 numbered ideas, each with a title line and a 2-sentence description (the owner's real list) | 50, titles and descriptions kept |
| 02 | `02-messy-feature-backlog.txt` | mixed bullets (`-`, `*`, `•`, `1)`, `[ ]`, `[x]`), a header, a continuation line, inline `—`/`–`/`:` descriptions, emoji, a URL, trailing spaces, 3 non-idea lines | 16; drops the header, "ask Ben…" and "TODO…" |
| 03 | `03-titles-only-side-projects.txt` | 20 bare titles, no descriptions or markers | 20; short descriptions that don't invent features |
| 04 | `04-mixed-ua-en-team-offsite.txt` + hint | Ukrainian and English mixed in one line, Cyrillic, emoji, with the locale hint "Write descriptions in Ukrainian." | 12; descriptions in Ukrainian |
| 05 | `05-near-duplicates-brainstorm.txt` | 14 lines with 5 near-duplicate pairs (Product Hunt, X thread, Telegram, YouTube, templates) | 9 after merging duplicates |

## Results so far

**v1.2:** Claude 5/5 valid; Gemini 0/5 collected.

**v1.1: 10/10 valid** after extraction rules (9/10 strictly: Gemini 01 gave `pros`/`cons` as
strings, now handled by extraction rule 6). Compared with v1.0, Gemini's answers lost all
`[cite: N]` markers (pasted as text), kept titles clean, dropped non-ideas (02: 16/16), stopped
inventing features (03: one sentence each, 73 characters on average versus 222), and took project
titles from headings. **Still open:** Gemini wrote list 02 in Ukrainian despite the same-language
rule (05 is now English).

**v1.0 (baseline): 10/10 answers validate (100%; SC-002 target ≥ 90%)**, counted after the extraction rules,
including rule 5 for citation markers. Gemini never used a code fence, and 4 of its 5 answers
carried `[cite: N]` markers.

## Collected answers

### v1.2

| List | Assistant | Model / app | Date | Notes |
|------|-----------|-------------|------|-------|
| 01–03, 05 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Same as v1.1 (already compliant) |
| 04 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Titles and tags fully in Ukrainian per the new "all text" hint |
| 01–05 | gemini | — | — | to collect |

### v1.1

| List | Assistant | Model / app | Date | Notes |
|------|-----------|-------------|------|-------|
| 01–05 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | v1.0 answers adjusted to the new rules: project titles from headings, side notes removed, no inferred details in title-only ideas, URLs in `links` |
| 01 | gemini | Gemini (app) | 2026-10-05 | Strictly invalid: `pros`/`cons` are strings in all 50 options (valid with rule 6). Titles and descriptions verbatim, English, project title "50 App Ideas" |
| 02 | gemini | Gemini (app) | 2026-10-05 | Valid; 16/16, non-ideas dropped, clean titles, URL in `links`, but all titles and descriptions translated to Ukrainian |
| 03 | gemini | Gemini (app) | 2026-10-05 | Valid; 20/20, titles verbatim, one short sentence each, no pros/cons |
| 04 | gemini | Gemini (app) | 2026-10-05 | Valid; 12/12, Ukrainian as hinted (titles translated too), concise, no embellishment |
| 05 | gemini | Gemini (app) | 2026-10-05 | Valid; 9/9 merged, English, project title = the list's heading |

### v1.0 (baseline)

| List | Assistant | Model / app | Date | Notes |
|------|-----------|-------------|------|-------|
| 01 | claude | claude-opus-5-5, in a Claude Code session, not the Claude chat app | 2026-10-05 | Valid; 50/50 options, titles and descriptions kept verbatim, 20 categories. Replace or add a Claude-app answer for a true chat-assistant sample |
| 02 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 16 options, non-ideas dropped, URL moved to `links` |
| 03 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 20 options, one-sentence descriptions |
| 04 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 12 options, Ukrainian descriptions and categories |
| 05 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 9 options, 5 duplicate pairs merged |
| 05 | gemini | Gemini (app; model not recorded) | 2026-10-05 | Valid; 9 options, duplicates merged. No code fence. Every description ends in a `[cite: 5]` marker (extraction rule 5 strips it). All text in Ukrainian although the list is English and there was no hint |
| 01 | gemini | Gemini (app; model not recorded) | 2026-10-05 | Valid; 50/50, titles and descriptions verbatim, 12 categories, no code fence. Copied the example's project title ("Which app do we build next?") |
| 02 | gemini | Gemini (app) | 2026-10-05 | Valid; 17 options (kept "ask Ben…" as a title-only option, per the "unclear idea" rule), notes left in titles ("?? maybe later", "(done already? check)"), URL not moved to `links`, Ukrainian text, 16 `[cite: 2]` markers |
| 03 | gemini | Gemini (app) | 2026-10-05 | Valid; 20/20, titles kept, but long descriptions that invent features (e.g. "ranked-choice voting", "tested Wi-Fi speeds"), 40 `[cite: 3]` markers |
| 04 | gemini | Gemini (app) | 2026-10-05 | Valid; 12/12, Ukrainian as hinted, embellished descriptions, 22 `[cite: 4]` markers |
