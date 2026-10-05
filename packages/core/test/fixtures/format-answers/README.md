# Format-answer fixtures (SC-002, task T036)

These are real answers from AI assistants to the format instruction in
`specs/001-decision-engine-core/contracts/format-instruction.md`. The test
`packages/core/test/format/fixtures.test.ts` replays every answer through extraction and
validation and asserts that at least 90% validate on the first paste.

## Layout

```text
inputs/<NN-name>.txt                      raw idea list, exactly as a user would paste it
inputs/<NN-name>.hint.txt                 optional {{LOCALE_HINT}} line
instructions/<NN-name>.txt                generated instruction (template + input + hint); paste this into the assistant
answers/<NN-name>/<assistant>.txt         the assistant's full reply, unedited (code fences and any extra prose included)
```

Assistant file names: `claude.txt`, `grok.txt`, `muse.txt`, `dots.txt`, which is the launch
compatibility list.

Regenerate the instructions after changing an input or the template:

```bash
node packages/core/test/fixtures/format-answers/build-instructions.mjs
```

## Collecting an answer

1. Open a **new chat** in the assistant, with default settings and no custom instructions.
2. Paste the whole `instructions/<NN-name>.txt` file as one message.
3. Copy the **entire** reply, unedited, into `answers/<NN-name>/<assistant>.txt`.
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

## Collected answers

| List | Assistant | Model / app | Date | Notes |
|------|-----------|-------------|------|-------|
| 01 | claude | claude-opus-5-5, in a Claude Code session, not the Claude chat app | 2026-10-05 | Valid; 50/50 options, titles and descriptions kept verbatim, 20 categories. Replace or add a Claude-app answer for a true chat-assistant sample |
| 02 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 16 options, non-ideas dropped, URL moved to `links` |
| 03 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 20 options, one-sentence descriptions |
| 04 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 12 options, Ukrainian descriptions and categories |
| 05 | claude | claude-opus-5-5, Claude Code session | 2026-10-05 | Valid; 9 options, 5 duplicate pairs merged |
| 01–05 | grok | — | — | to collect |
| 01–05 | muse | — | — | to collect |
| 01–05 | dots | — | — | to collect |
