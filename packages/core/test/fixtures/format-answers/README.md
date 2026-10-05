# Format-answer fixtures (SC-002, task T036)

These are real answers from AI assistants to the format instruction in
`specs/001-decision-engine-core/contracts/format-instruction.md`. The test
`packages/core/test/format/fixtures.test.ts` replays every answer through extraction and
validation and asserts that at least 90% validate on the first paste.

## Layout

```text
inputs/<NN-name>.txt                      raw idea list, exactly as a user would paste it
instructions/<NN-name>.txt                the generated instruction (template + input); paste this into the assistant
answers/<NN-name>/<assistant>.txt         the assistant's full reply, unedited (code fences and any extra prose included)
```

Assistant file names: `claude.txt`, `grok.txt`, `muse.txt`, `dots.txt`, which is the launch
compatibility list.

## Collecting an answer

1. Open a **new chat** in the assistant, with default settings and no custom instructions.
2. Paste the whole `instructions/<NN-name>.txt` file as one message.
3. Copy the **entire** reply, unedited, into `answers/<NN-name>/<assistant>.txt`.
4. Add a line to the table below.

Never fix an answer by hand. A broken answer is exactly what the test should count.

## Sample lists

| ID | Input | Shape it tests |
|----|-------|----------------|
| 01 | `01-app-ideas-50.txt` | 50 numbered ideas, each with a title line and a 2-sentence description (the owner's real list) |
| 02–05 | *to add* | e.g. a messy bulleted list, titles only, mixed Ukrainian/English, duplicates and near-duplicates |

## Collected answers

| List | Assistant | Model / app | Date | Notes |
|------|-----------|-------------|------|-------|
| 01 | claude | claude-opus-5-5, in a Claude Code session, not the Claude chat app | 2026-10-05 | Valid; 50/50 options, titles and descriptions kept verbatim, 20 categories. Replace or add a Claude-app answer for a true chat-assistant sample |
| 01 | grok | — | — | to collect |
| 01 | muse | — | — | to collect |
| 01 | dots | — | — | to collect |
