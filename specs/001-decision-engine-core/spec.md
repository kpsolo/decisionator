# Feature Specification: Decision Engine Core

**Feature Branch**: `001-decision-engine-core`

**Created**: 2026-10-05

**Status**: Draft (revised 2026-10-05: MVP redefined around the owner's first user story)

**Input**: User description: "Open source decision making engine. It should be a module system
built from ideas, descriptions, options and user picking, some randomizer, or custom strategy
modules. UI should be as easy as possible but extendable (with detailed plugin customization).
Ideas store should be a plugin — from clipboard, to Obsidian (not included); Google Docs API
included. We should have an easy to use agentic API: main feature — ask the user's own agent to
add relevant data to an option or idea (like some research) and share with friends / other
collaborators."

**First user story (owner, 2026-10-05)**: "I have a list of ideas to build a software
product/app. I paste it from the clipboard. If Deci doesn't have a configured AI to
format the options properly, it asks the user to use a format. The user goes to their agent,
asks it to format the options and comes back with properly formatted JSON. Deci forms a project
to share. The user goes through each option and makes comments or sets grades. It should be
easy to share like Google Docs — by link (optionally with a password). Other collaborators look
through the ideas/options, vote and comment. Each contributor can see stats: list, group and
sort the options. The first MVP release should work out of the box with the Google API. All
limits must stay within free API usage."

## Clarifications

### Session 2026-10-05 (initial)

- Q: Hosting & identity model? → A: Local-first; data on the user's device, sharing and remote
  agent access via an optional, self-hostable sync/relay service. **Superseded for the MVP by
  the revision session below; still the direction for US7.**
- Q: Can collaborators take part in making the decision? → A: Yes, by casting ballots that
  group strategies tally.
- Q: How are third-party plugins obtained in v1? → A: Local package file or URL only; no in-app
  catalog (FR-061).
- Planning refinement (research R8): remote-agent tunnel traffic is visible to the relay
  operator in transit; disclosed in UI (applies to US7).

### Session 2026-10-05 (revision: first user story)

- Q: How does the MVP run? → A: A hosted web app with no backend of its own. Each project lives
  in the owner's Google Drive and is shared through Google's link sharing. Free API quotas only.
  The local node, agent API and relay move after the MVP.
- Q: Which Google file holds a project? → A: A Google Sheet per project (options, grades,
  rankings and comments as rows).
- Q: What does "vote" mean next to grades? → A: Each collaborator grades each option 1–5 and
  also submits a ranked vote of their top options, tallied by a ranking strategy.
- Q: Product name? → A: Deci. The repository and technical identifiers keep the lowercase name `decisionator`.

## User Scenarios & Testing *(mandatory)*

The **MVP release = US1 + US2 + US3** (the owner's first user story). Each story is still
independently testable, and US1 alone is useful as a personal idea board.

### User Story 1 - Turn a pasted idea list into a graded project (Priority: P1)

A person has a raw list of product ideas. They paste it into Deci. Without a connected
AI, Deci gives them a ready-made instruction and format. The person copies it to their own AI
agent (any chat assistant), gets back formatted JSON and pastes that into Deci. Deci shows a
preview of the options, and on confirmation creates a project saved in the person's own Google
Drive. The person then goes through each option, sets a grade and adds comments, and can list,
group and sort the options.

**Why this priority**: This is the start of every decision and is already useful alone: a
structured, graded idea board kept in the user's own Google Drive.

**Independent Test**: Paste a 10-line idea list. Copy the instruction to any AI assistant, paste
the returned JSON, confirm, and check that a Google Sheet appears in your Drive with 10 options.
Grade 3 options, comment on one, then sort by grade and group by category.

**Acceptance Scenarios**:

1. **Given** the user has pasted a plain list and no AI is connected, **When** they choose
   "Format with my AI", **Then** Deci shows a copyable instruction that includes their pasted
   list and the required JSON format, plus a box to paste the AI's answer.
2. **Given** the user pastes JSON that matches the format, **When** Deci validates it, **Then**
   a preview lists each option with its title, description and category/tags, and the user can
   edit or remove items before confirming.
3. **Given** the pasted JSON is invalid or incomplete, **When** Deci validates it, **Then** it
   shows exactly what is wrong (e.g. "item 4: title is missing") and offers a corrected
   instruction to send back to the AI.
4. **Given** the user does not want to use an AI, **When** they choose "Use as plain list",
   **Then** each non-empty line or list item becomes an option title.
5. **Given** a confirmed preview, **When** the user signs in with Google and creates the
   project, **Then** a Google Sheet with the project is created in their Drive. Deci only asks
   for access to files it creates or that the user opens with it.
6. **Given** a project, **When** the user sets a 1–5 grade or adds a comment on an option,
   **Then** it is saved to the project and shown with their name and the time.
7. **Given** a project, **When** the user opens the stats view, **Then** they can sort options by
   average grade, number of grades, number of comments or title, and group them by category or
   tag.
8. **Given** the user closes and reopens Deci, **When** they open "My projects", **Then** their
   projects are listed and open with all grades and comments intact.
9. **Given** an owner's project, **When** they choose "Delete project" and confirm by typing its
   name, **Then** the project's Sheet is moved to their Google Drive trash, Deci's local copy and
   pending changes are cleared, the project leaves "My projects", and collaborators see "project
   unavailable".

---

### User Story 2 - Share by link and collaborate (Priority: P2)

The owner shares the project the way they share a Google Doc: they copy a link, choose whether
people can only view or can also grade and comment, and optionally add a password. Collaborators
open the link, sign in with Google if needed, and grade and comment on each option. Everyone
sees everyone's input and the aggregated stats.

**Why this priority**: Group input is the point of the owner's story. It builds directly on
US1's project.

**Independent Test**: Share a project with "can contribute" access. A second Google account
opens the link, grades two options and comments on one. The owner sees the new grades in the
averages and the comment with the collaborator's name within 30 seconds.

**Acceptance Scenarios**:

1. **Given** a project, **When** the owner chooses "Share", **Then** they pick an access level
   (view, or contribute = grade + comment + vote) and get a link to copy.
2. **Given** a link, **When** a collaborator opens it, **Then** they see the project after at most
   one Google sign-in and one access confirmation. No other account creation is needed.
3. **Given** the owner set a password, **When** anyone opens the link, **Then** they must enter
   the password before any project content is shown. Without the password, the project data
   stored in Google is unreadable.
4. **Given** a collaborator with contribute access, **When** they grade or comment, **Then** the
   owner and other collaborators see it attributed to them, and nobody's input overwrites
   anyone else's.
5. **Given** a collaborator with view access, **When** they try to grade, comment or vote,
   **Then** the action is unavailable and the reason is shown.
6. **Given** the owner turns off link sharing, or removes a person they invited by email,
   **When** that person next opens or refreshes the project, **Then** access is refused.
7. **Given** several people are working at once, **When** anyone adds input, **Then** others see
   it without reloading, within 30 seconds while the project is open.

---

### User Story 3 - Ranked vote and results (Priority: P3)

When the group is ready, each contributor submits a ranked vote of their top options. The owner
closes voting, Deci tallies the rankings, and everyone sees the result next to the grade stats.

**Why this priority**: Turns grades and discussion into a decision. It needs US2's collaborators
to be meaningful.

**Independent Test**: Three accounts each rank their top 3 of 6 options. The owner closes voting.
The result shows the winner and full order with points per option, and re-running the tally on
the same ballots gives the same result.

**Acceptance Scenarios**:

1. **Given** an open project, **When** a contributor ranks options (drag to order, top N chosen by
   the owner, default 3), **Then** their ranking is saved. Submitting again replaces their
   previous ranking and is never counted twice.
2. **Given** submitted rankings, **When** any participant opens results, **Then** they see the
   current tally (if the owner allows live results) or a "voting in progress" notice with the
   number of ballots.
3. **Given** the owner closes voting, **When** the tally runs, **Then** an outcome is recorded with
   the winner, the full order with points, the ranking strategy and version, the ballots counted
   and the time. The outcome cannot be edited afterwards.
4. **Given** a tie, **When** the tally runs, **Then** the tie is broken by the documented rule
   (higher average grade, then more first-place votes, then a recorded random seed) and the
   result says which rule was used.
5. **Given** a closed vote, **When** the owner reopens voting and closes it again, **Then** a new
   outcome is appended and the earlier one stays in history.

---

### User Story 4 - Decide with strategy modules (Priority: P4)

Besides ranked voting, the owner can decide with other strategies: their own pick, a fair random
draw, a random draw weighted by grades, or any installed strategy plugin. Random results are
reproducible and anyone can verify them.

**Why this priority**: Expands the "engine" beyond voting and proves the strategy extension
point, after the MVP flow works.

**Independent Test**: Run a weighted random draw on a project, then press Verify and get
"Reproduced". Install a sample strategy plugin and use it without other changes.

**Acceptance Scenarios**:

1. **Given** a project, **When** the owner runs "Random", **Then** the outcome records the seed,
   the strategy and version, and the inputs.
2. **Given** a recorded random outcome, **When** anyone presses Verify, **Then** the system
   reproduces the same result from the recorded inputs and seed.
3. **Given** "Weighted by grades", **When** the draw runs, **Then** options are drawn in
   proportion to their average grade, and ungraded options are excluded unless the owner
   includes them.
4. **Given** a strategy whose preconditions are unmet, **When** it is chosen, **Then** the reason
   is explained and no outcome is recorded.

---

### User Story 5 - Connected AI and agent API (Priority: P5)

Instead of copy-pasting, the user connects an AI agent. Deci can then format pasted lists
automatically, and the user can ask the agent to research an option. Findings land on the option
with sources, attributed and pending review. Collaborators can do the same with their own agents.

**Why this priority**: The full "ask your own agent" vision. The MVP already supports any agent
through the copy-paste format; this removes the manual step.

**Independent Test**: Connect a test agent, paste a list and get formatted options without
copy-paste. Then ask the agent to research one option and see a sourced, attributed note marked
"pending review".

**Acceptance Scenarios**:

1. **Given** a connected agent, **When** the user pastes a list, **Then** Deci asks the agent to
   format it and shows the preview, without the copy-paste step.
2. **Given** an option, **When** the user chooses "Ask my agent" with an instruction, **Then** the
   agent gets scoped, time-limited, revocable access to that option only.
3. **Given** an agent adds findings, **Then** they appear on the option attributed to the agent
   and the user it acted for, with sources, marked "pending review" until a human accepts, edits
   or dismisses them.
4. **Given** an agent tries to grade, vote, delete, change sharing or act outside its scope,
   **Then** the action is refused and the attempt is visible to the user.

---

### User Story 6 - Plugins and more idea sources (Priority: P6)

Power users install plugins: more idea sources (a Google Doc import, or external ones like
Obsidian), strategies and UI panels. They review each plugin's permissions, configure it in a
generated settings panel, and can disable it at any time. The default screens stay simple.

**Why this priority**: Delivers the extensibility promise once the core flow is proven.

**Independent Test**: Install a sample plugin, approve its permissions, change a setting and see
the behavior change. Disable it and confirm the rest of the app works unchanged.

**Acceptance Scenarios**:

1. **Given** a plugin package (file or URL), **When** the user installs it, **Then** its
   requested permissions are shown and must be approved first.
2. **Given** the Google Docs idea source, **When** the user picks a document, **Then** its list
   items or heading sections become ideas, read-only, with links back to the document, and
   refreshing never duplicates items.
3. **Given** a plugin with settings, **When** the user opens them, **Then** a form generated from
   the plugin's declared settings is shown, with validation.
4. **Given** a plugin built for an incompatible platform version, or one that fails at runtime,
   **Then** it is refused or isolated with a plain-language message naming it, and the rest of
   the app keeps working.

---

### User Story 7 - Local-first mode without Google (Priority: P7)

A privacy-minded user or team runs Deci without Google: data on their own device, and
sharing through a self-hostable relay that only stores end-to-end encrypted data.

**Why this priority**: Keeps the project's local-first, user-owns-the-data direction available
for people who don't want a Google dependency, after the Google-based MVP.

**Independent Test**: Run the local app and a self-hosted relay, share a project with a second
device, and confirm the relay's storage contains no readable option titles.

**Acceptance Scenarios**:

1. **Given** local mode, **When** the user creates and grades projects offline, **Then**
   everything works without network access.
2. **Given** a self-hosted relay, **When** the owner shares a project, **Then** collaborators can
   contribute and vote, and the relay operator cannot read the content.
3. **Given** a project in Google Sheets, **When** the user exports it and imports it in local mode
   (and back), **Then** options, grades, comments, rankings and outcomes are preserved.

---

### Edge Cases

- Pasted text is empty, not text, or very large (more than 500 lines): Deci explains, or shows a
  preview with an adjustable cap.
- The AI returns JSON wrapped in prose or markdown fences: Deci extracts the JSON block. If it
  finds several, it asks which one to use.
- The AI returns options with duplicate titles: they are allowed but flagged in the preview.
- The user declines Google sign-in: they can still format and preview their list. Deci explains
  that saving and sharing need Google, and keeps the draft in the browser.
- The project Sheet is deleted, trashed or its sharing changed outside Deci: Deci shows "project
  unavailable" with the reason it can detect. It never silently creates a new copy.
- Someone edits the Sheet directly in Google Sheets: Deci ignores rows it cannot validate, shows
  a warning that names the row, and never crashes.
- A wrong password: no content is shown. After 5 wrong tries, Deci waits 30 seconds before
  accepting another try.
- Free Google API quota is reached: Deci slows down automatically, shows "syncing paused, retrying
  in N s", and never loses the user's unsent input (it is queued locally).
- Two people grade the same option at the same moment: both grades are kept (one per person).
- An option is removed after people graded or ranked it: its grades stay in history, and it is
  excluded from new tallies with a note.
- A collaborator signs in with a different Google account than the one invited: Deci shows which
  account is signed in and how to switch.

## Requirements *(mandatory)*

### Functional Requirements

**MVP — capture and formatting (US1)**

- **FR-001**: Users MUST be able to paste text from the clipboard to start a project.
- **FR-002**: Without a connected AI, the system MUST offer a copyable **format instruction**
  containing the user's pasted text, the required JSON format and an example, written to work
  with any general-purpose AI assistant.
- **FR-003**: The JSON format MUST be a published, versioned contract (title, description,
  category, tags, and optional pros, cons, effort and links per option) and MUST accept a top-level
  project title and description.
- **FR-004**: The system MUST validate pasted JSON against the format, extract it from
  surrounding prose or code fences, report each problem with its item number and field, and
  offer a correction instruction for the AI.
- **FR-005**: Users MUST be able to skip the AI and import each non-empty line or list item as an
  option title (list markers removed).
- **FR-006**: Users MUST see an editable preview (edit, remove or add options) before a project is
  created. Drafts MUST be kept in the browser until saved.

**MVP — project storage in Google (US1)**

- **FR-007**: Creating a project MUST create a Google Sheet in the owner's Google Drive that holds
  the project: options, grades, comments, rankings, outcomes and settings.
- **FR-008**: The system MUST request only per-file Google access (files the app creates or the
  user explicitly opens with it), never access to all of the user's Drive.
- **FR-009**: Every grade, comment and ranking MUST be stored as its own entry attributed to its
  author's Google account, so concurrent input never overwrites other people's input.
- **FR-010**: The system MUST list the user's projects ("My projects") and reopen them with all
  data intact.
- **FR-011**: Project storage MUST sit behind a project-store contract. Google Sheets is the first
  implementation, and US7's local store is another implementation of the same contract.
- **FR-025**: Owners MUST be able to delete a project from Deci after an explicit confirmation.
  Deleting moves the Sheet to the owner's Google Drive trash (recoverable there for Google's
  retention period), clears the project's local drafts, snapshot and write queue, and removes it
  from "My projects". Non-owners can only remove a project from their own list (constitution V).

**MVP — grading, comments and stats (US1, US2)**

- **FR-012**: Participants with contribute access MUST be able to set one 1–5 grade per option
  (changeable) and add comments to options.
- **FR-013**: The stats view MUST let any participant sort options by average grade, number of
  grades, number of comments, ranked-vote points (when available) or title, and group them by
  category or tag. It MUST show each option's average, grade count and distribution.
- **FR-014**: Each grade and comment MUST show its author's display name and time. Owners MUST be
  able to hide a comment, which stays in history.

**MVP — sharing (US2)**

- **FR-015**: Owners MUST be able to share a project by link with an access level: view, or
  contribute (grade, comment, vote).
- **FR-016**: Opening a link MUST require at most one Google sign-in and one access confirmation.
  No Deci account exists.
- **FR-017**: Owners MAY protect a project with a password. Password-protected project content
  MUST be encrypted in the browser before it is stored in Google, so that neither Google nor
  anyone with Sheet access can read it without the password. The password MUST never be stored
  or sent anywhere.
- **FR-018**: Owners MUST be able to turn off link sharing (effective for everyone at their next
  access) and to invite people by email instead of by link. Only people invited by email can be
  removed individually. The UI MUST explain this when an owner tries to remove someone from a
  link-shared project (research R21).
- **FR-019**: While a project is open, other participants' input MUST appear without a reload
  within 30 seconds.
- **FR-020**: All Google API use MUST stay within the free quotas. The client MUST budget its
  requests, back off on rate-limit responses, queue unsent input locally, and tell the user when
  syncing is paused.

**MVP — ranked vote (US3)**

- **FR-021**: Contributors MUST be able to submit one ranked vote per project (top N, owner
  configurable, default 3). Re-submitting replaces it.
- **FR-022**: The owner MUST be able to open and close voting and choose whether results are
  visible live or only after closing.
- **FR-023**: The ranked vote MUST be tallied by a ranking strategy module (default: Borda count
  over each ballot's top N), with the documented tie-break chain from US3 #4.
- **FR-024**: Each closed vote MUST record an immutable outcome: winner, full order with points,
  strategy id and version, ballots counted, tie-break used, seed (if any), who closed it and
  when. Outcomes are append-only.

**Post-MVP — strategies (US4)**

- **FR-030**: Strategies MUST be modules implementing a common strategy contract. Built-ins:
  owner pick, uniform random, weighted by average grade, and the Borda ranking strategy.
- **FR-031**: Random strategies MUST record a seed, and any participant MUST be able to verify an
  outcome by reproducing it.
- **FR-032**: Strategies MUST declare preconditions, and unmet preconditions MUST be explained.

**Post-MVP — connected AI and agent API (US5)**

- **FR-040**: The system MUST expose a documented, versioned, self-describing agent API (MCP and
  REST) with parity to user actions relevant to agents.
- **FR-041**: Users MUST be able to connect an agent to auto-format pasted lists using the FR-003
  format.
- **FR-042**: Agent requests MUST carry scoped, time-limited (default 24 h) and revocable access.
  Any agent vendor must work.
- **FR-043**: Agent contributions MUST be attributed (agent name, on whose behalf, sources) and
  pending review until a human accepts, edits or dismisses them.
- **FR-044**: Agents MUST NOT grade, vote, record outcomes, delete content or change sharing.
  Refused attempts MUST be visible to the user.

**Post-MVP — plugins and sources (US6)**

- **FR-050**: Idea sources, strategies, project stores and UI panels MUST be plugins with a
  manifest (identity, version, compatible platform version, permissions, settings schema).
- **FR-051**: Built-in modules MUST use the same public contracts as third-party plugins.
- **FR-052**: Third-party plugins MUST run isolated, limited to their approved permissions and
  network hosts. A failing plugin MUST NOT break the app and MUST be named in the error.
- **FR-053**: Plugin settings panels MUST be generated from the plugin's settings schema.
- **FR-054**: A Google Docs idea source MUST import list items or heading sections from documents
  the user picks, read-only, with source links and without duplicates on refresh.
- **FR-055**: Other sources (e.g. Obsidian) MUST be addable as external plugins without app
  changes. An Obsidian source is not bundled.
- **FR-061**: In v1, third-party plugins MUST be installed from a local file or URL with a
  permission review. There is no in-app catalog.

**Post-MVP — local-first mode (US7)**

- **FR-070**: A local mode MUST store projects on the user's device and work offline.
- **FR-071**: Local-mode sharing MUST go through an optional, self-hostable relay that cannot read
  stored content (end-to-end encrypted). Remote-agent traffic through the relay MUST be disclosed
  as visible to the relay operator in transit.
- **FR-072**: Projects MUST be exportable and importable between Google and local modes in an open,
  documented format.

**All releases — data and quality**

- **FR-080**: Users MUST be able to export a project (options, grades, comments, rankings,
  outcomes) in an open, documented format.
- **FR-081**: Credentials and access tokens MUST never appear in project data, exports, share
  links or logs. Google access tokens are kept in memory only.
- **FR-082**: The default interface MUST meet WCAG 2.1 AA and be usable from 360 px wide.

### Key Entities *(include if feature involves data)*

- **Project**: The thing being decided (e.g. "Which app do we build?"). Title, description,
  owner, storage location (Google Sheet or local), access settings, password-protected flag,
  voting settings (top N, live results, open or closed).
- **Option**: One candidate idea. Title, description, category, tags, optional pros, cons, effort
  and links, status (active or removed), who added it.
- **Participant**: A person with access, identified by their Google account in the MVP (display
  name and email) or by a device identity in local mode, with a role: owner, contribute or view.
- **Grade**: One participant's 1–5 score for one option. The latest grade per participant and
  option counts.
- **Comment**: Text on an option by a participant (or, later, an agent), with time and hidden
  flag.
- **Ranking (ballot)**: One participant's ordered top-N options. The latest submission counts.
- **Outcome**: An immutable result of a tally or strategy run: winner, order and points,
  strategy and version, inputs counted, tie-break, seed, who and when.
- **Format instruction**: The generated prompt plus the JSON format (FR-002, FR-003).
- **Contribution (post-MVP)**: Agent or human research attached to an option, with sources and
  review status.
- **Plugin (post-MVP)**: An installable module with manifest, permissions, settings and enabled
  state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user goes from pasting a 10-item list to a saved project in under
  3 minutes, including the round trip to their own AI assistant.
- **SC-002**: At least 90% of AI answers produced from the format instruction by mainstream
  assistants validate on the first paste (measured with the launch agent list: Claude and
  Gemini).
- **SC-003**: A collaborator goes from opening a share link to their first grade in under
  1 minute.
- **SC-004**: Input from one participant appears for others within 30 seconds in 95% of cases
  while the project is open.
- **SC-005**: With 20 collaborators active on one project, the app stays within free Google API
  quotas and no input is lost.
- **SC-006**: 100% of tallies reproduce identically from the same ballots (and seed).
- **SC-007**: Without the password, a password-protected project's options, grades and comments
  are unreadable in the stored Google Sheet.
- **SC-008**: Sorting or grouping 200 options in the stats view feels instant (under 1 second).
- **SC-009**: The MVP runs with zero server cost to the project beyond static hosting.

## Assumptions

- The MVP is a pet project: there are no adoption targets, and success is measured by the
  criteria above.
- Users of the MVP have a Google account. People without one can format and preview, but cannot
  save or share until local mode (US7) ships.
- The project publishes one Google Cloud OAuth client for the hosted app, with only non-sensitive
  per-file scopes, so no Google app verification is needed. Self-hosters can use their own client.
- "Any AI" in the MVP means a general-purpose chat assistant that can follow instructions and
  return JSON. The launch compatibility list is Claude and Gemini.
- Typical projects have up to 200 options and up to 20 active collaborators.
- Password protection is a privacy feature, not access control: anyone with the password and
  Sheet access can read the project, and a lost password cannot be recovered.
- People who can edit the underlying Sheet in Google Sheets could tamper with it directly. Deci
  validates rows, and Google's version history provides an audit trail; this is accepted for the
  MVP.
- English UI only for now, with text kept translatable.
