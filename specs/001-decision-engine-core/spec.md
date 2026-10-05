# Feature Specification: Decision Engine Core (MVP)

**Feature Branch**: `001-decision-engine-core`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "Open source decision making engine. It should be a module system
built from ideas, descriptions, options and user picking, some randomizer, or custom strategy
modules. UI should be as easy as possible but extendable (with detailed plugin customization).
Ideas store should be a plugin — from clipboard, to Obsidian (not included); Google Docs API
included. We should have an easy to use agentic API: main feature — ask the user's own agent to
add relevant data to an option or idea (like some research) and share with friends / other
collaborators."

## Clarifications

### Session 2026-10-05

- Q: Hosting & identity model? → A: Local-first; data on the user's device, sharing and remote
  agent access via an optional, self-hostable sync/relay service (FR-027–FR-027b).
- Q: Can collaborators take part in making the decision? → A: Yes, by casting ballots tallied
  by group strategy modules; owner triggers the outcome (US5 #6–7, FR-027c–FR-027d).
- Q: How are third-party plugins obtained in v1? → A: Local package file or URL only; no
  in-app catalog in v1 (FR-034).
- Planning refinement (research R8): remote-agent tunnel traffic is visible to the relay
  operator in transit; disclosed in UI (FR-027a).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture options and make a decision (Priority: P1)

A person facing a choice ("Where do we go for dinner?", "Which job offer do I take?") creates
a decision, adds a few options — each with a title and an optional description — and then
decides by picking an option themselves. The chosen outcome is recorded with the decision.

**Why this priority**: This is the irreducible core of the product. Without it nothing else
(strategies, sources, agents, sharing) has anything to act on. On its own it is already a
usable, if simple, decision journal.

**Independent Test**: Start with an empty workspace, create a decision with three options,
pick one manually, reopen the decision and confirm the outcome, the options and who picked
it are shown.

**Acceptance Scenarios**:

1. **Given** an empty workspace, **When** the user creates a decision titled "Dinner tonight"
   and adds options "Sushi", "Pizza" and "Tacos", **Then** the decision shows three options
   in the order they were added.
2. **Given** a decision with options, **When** the user edits an option's description or
   removes an option, **Then** the change is visible immediately and persists after reopening.
3. **Given** a decision with at least two options, **When** the user chooses "Pick myself"
   and selects "Tacos", **Then** an outcome is recorded showing "Tacos", the strategy used
   ("Manual pick"), the user and the time.
4. **Given** a decision with a recorded outcome, **When** the user decides again, **Then** a
   new outcome is added to the decision's history and the previous outcome is kept.
5. **Given** a first-time user, **When** they open the application, **Then** they can create
   a decision and record an outcome without opening any settings screen.

---

### User Story 2 - Decide with a strategy module (randomizer, weighted, custom) (Priority: P2)

Instead of picking themselves, the user chooses a decision strategy: a fair random draw, a
weighted random draw (options get weights), or any other installed strategy module. The result
is explained and can be reproduced by anyone who has the decision.

**Why this priority**: Strategies are what makes this a decision *engine* rather than a list.
The randomizer is the most-requested "help me decide" capability and proves the strategy
extension point.

**Independent Test**: With a decision of four options, run the random strategy, verify an
outcome is recorded with its seed; re-run verification with the same seed and confirm the
identical result. Install a sample custom strategy and confirm it appears and can be used
with no change to the rest of the app.

**Acceptance Scenarios**:

1. **Given** a decision with options, **When** the user selects "Random" and confirms,
   **Then** one option is chosen, and the outcome records the strategy, its version, its
   settings and the random seed.
2. **Given** a recorded random outcome, **When** any viewer chooses "Verify", **Then** the
   system re-runs the strategy with the recorded inputs and seed and shows that it produces
   the same option.
3. **Given** the weighted strategy, **When** the user assigns weights to options, **Then**
   options are drawn proportionally to their weights and options with weight zero are never
   drawn.
4. **Given** a third-party strategy module is installed, **When** the user opens the strategy
   chooser, **Then** the new strategy is listed with its name and description, and its
   settings are shown in a generated settings panel.
5. **Given** a strategy that cannot run on the current decision (e.g. fewer options than it
   requires), **When** the user tries to run it, **Then** the system explains why in plain
   language and records no outcome.

---

### User Story 3 - Import ideas from pluggable sources (clipboard, Google Docs) (Priority: P3)

The user brings in raw ideas from where they already keep them. They paste a list from the
clipboard, or connect a Google Doc, and the lines/items become ideas. Ideas can be turned into
options of a decision. Other sources (for example Obsidian) can be added later as external
plugins without changing the application.

**Why this priority**: Removes the friction of retyping. It exercises the idea-source
extension point, which is a key promise of the platform, but the product is usable without it.

**Independent Test**: Copy a 5-line list to the clipboard, import it, verify 5 ideas appear
and can be added to a decision as options. Connect a Google Doc containing a bulleted list,
import it, verify the ideas appear with a link back to the source document.

**Acceptance Scenarios**:

1. **Given** clipboard text with one idea per line (or a bulleted/numbered list), **When** the
   user chooses "Import from clipboard", **Then** a preview shows the detected ideas, and on
   confirmation each becomes an idea; blank lines and list markers are discarded.
2. **Given** the user has not connected Google, **When** they choose "Import from Google Docs",
   **Then** they are asked to grant read-only access to the document(s) they select, and
   nothing is read before they grant it.
3. **Given** a connected Google Doc, **When** the user imports it, **Then** each list item or
   heading-delimited section becomes an idea that keeps a reference to its source document.
4. **Given** a previously imported Google Doc that has since changed, **When** the user
   chooses "Refresh", **Then** new items are added as new ideas and existing ideas are not
   duplicated or overwritten.
5. **Given** a set of ideas, **When** the user selects some and chooses "Add to decision",
   **Then** they become options of that decision, keeping their descriptions and source links.
6. **Given** a user revokes Google access, **When** they next try to refresh, **Then** they are
   told access was revoked, and already-imported ideas remain available.

---

### User Story 4 - Ask your own agent to research an option or idea (Priority: P4)

The user wants more information before deciding. On an option, idea or the whole decision
they choose "Ask my agent", describe what they want ("compare prices and reviews"), and hand
the request to an AI agent of their choice. The agent reads the relevant context and attaches
its findings — text, links, pros/cons, sources — back onto the option or idea. The user reviews
the contribution and keeps, edits or dismisses it.

**Why this priority**: This is the product's headline differentiator. It depends on stories
1 (something to enrich) and benefits from 5 (sharing the results), so it comes after the core.

**Independent Test**: Create a decision with two options, issue an agent request on one
option, have a test agent use the agentic API to attach a research note with two source
links, and verify the note appears on that option, attributed to the agent and the requesting
user, pending the user's review.

**Acceptance Scenarios**:

1. **Given** an option, **When** the user chooses "Ask my agent" and enters an instruction,
   **Then** the system produces an agent request containing the instruction and a scoped,
   time-limited access grant limited to that option (and read access to its decision).
2. **Given** a valid agent request, **When** the agent uses the agentic API, **Then** it can
   discover the available actions, read the context it was granted, and attach contributions
   only within that scope.
3. **Given** an agent attaches a contribution, **Then** it is shown on the target, labelled as
   agent-made, attributed to the agent and to the user it acted for, with its sources, and
   marked "pending review".
4. **Given** a pending agent contribution, **When** the user accepts, edits or dismisses it,
   **Then** its status updates accordingly and dismissed contributions are hidden from the
   default view but remain in history.
5. **Given** an agent request, **When** the user revokes it or it expires, **Then** any further
   attempt by the agent to read or write is refused.
6. **Given** an agent tries to change an outcome, delete options or act outside its granted
   target, **Then** the action is refused and the attempt is visible to the user.

---

### User Story 5 - Share a decision with friends and collaborators (Priority: P5)

The user shares a decision (with its options, enrichment and outcomes) with friends or
colleagues. Collaborators can view it and, depending on the access the owner gave them,
add options, add their own notes, or ask their own agents to contribute.

**Why this priority**: Turns a personal tool into a group one and completes the "research and
share" headline flow, but relies on the earlier stories.

**Independent Test**: Share a decision with a second user, have them open it, add a note to
an option, and verify the owner sees the note attributed to that collaborator; then revoke
access and verify the collaborator can no longer open it.

**Acceptance Scenarios**:

1. **Given** a decision, **When** the owner chooses "Share", **Then** they choose an access
   level for collaborators and receive a way to invite them.
2. **Given** an invited collaborator with contribute access, **When** they add an option or a
   note, **Then** the owner and other collaborators see it attributed to that collaborator.
3. **Given** a collaborator with contribute access, **When** they choose "Ask my agent" on an
   option, **Then** their agent's contributions are attributed to their agent acting for them.
4. **Given** a collaborator with view-only access, **When** they try to change anything,
   **Then** the change is not allowed and the reason is explained.
5. **Given** a shared decision, **When** the owner revokes a collaborator's access, **Then**
   that collaborator can no longer open the decision or submit changes.
6. **Given** a shared decision using a group strategy (e.g. plurality vote), **When** each
   collaborator with contribute access casts a ballot and the owner triggers the outcome,
   **Then** the outcome tallies all submitted ballots, records who voted (or that votes were
   anonymous, if the owner chose so) and shows the result to all participants.
7. **Given** a collaborator has already voted, **When** they vote again before the outcome is
   triggered, **Then** their previous ballot is replaced, never counted twice.

---

### User Story 6 - Customize the app through plugins (Priority: P6)

A power user opens the plugin area, sees installed modules (idea sources, strategies,
enrichers, UI panels), enables/disables them, adjusts their detailed settings, and installs
new ones. The default screens stay just as simple for everyone else.

**Why this priority**: Delivers the "extendable with detailed customization" promise. Basic
plugin hosting is a prerequisite of stories 2–4, but the management experience can come last.

**Independent Test**: Install a sample plugin package, confirm the permissions it requests are
shown before enabling, change one of its settings, confirm the behaviour changes, disable it
and confirm it disappears from the UI without affecting other features.

**Acceptance Scenarios**:

1. **Given** the plugin area, **When** the user views it, **Then** each plugin shows its name,
   type, version, author, the permissions it holds and whether it is enabled.
2. **Given** a new plugin, **When** the user installs it, **Then** the permissions it requests
   (e.g. clipboard, network hosts, document access) are shown and must be approved before it
   is enabled.
3. **Given** a plugin with settings, **When** the user opens its settings, **Then** a settings
   panel generated from the plugin's declared settings is shown with defaults and validation.
4. **Given** a plugin built for an incompatible version of the platform, **When** the user
   tries to enable it, **Then** it is refused with a plain-language explanation.
5. **Given** a plugin that fails or hangs at runtime, **Then** the rest of the app keeps
   working and the user sees an error naming the plugin.

---

### Edge Cases

- A decision with zero or one option: deciding is disabled with an explanation (one option
  can be confirmed manually but strategies requiring a choice are unavailable).
- Duplicate option titles are allowed but visually flagged.
- Clipboard is empty, contains non-text content, or contains a very large paste (thousands of
  lines): the user sees a clear message, and large imports show a preview with a cap the user
  can adjust.
- Google Doc is deleted, moved, or access is lost after import: imported ideas stay, the source
  link is marked as unavailable.
- Network is unavailable: local actions (create, edit, manual/random decide) keep working;
  imports, sharing and agent requests show they are waiting for connectivity.
- An agent submits a huge or malformed contribution, or floods many contributions: the system
  enforces size limits and a per-request contribution limit and reports the rejection to the
  agent.
- Two collaborators edit the same option at the same time: neither change is silently lost.
- An option is removed while an agent request targets it: the request is cancelled and the
  agent receives a clear "target no longer exists" response.
- A strategy module is uninstalled after it produced outcomes: past outcomes remain readable,
  showing the strategy name/version, but verification reports that the strategy is unavailable.
- An uninstalled idea-source plugin: ideas it imported remain; refresh is unavailable.

## Requirements *(mandatory)*

### Functional Requirements

**Decisions, ideas and options**

- **FR-001**: Users MUST be able to create, rename, describe, archive and delete decisions.
- **FR-002**: Users MUST be able to add, edit, reorder and remove options on a decision; each
  option has a title and an optional rich-text description.
- **FR-003**: Users MUST be able to keep a pool of ideas (not yet assigned to a decision) and
  turn selected ideas into options of a decision, preserving description and source reference.
- **FR-004**: The system MUST persist all decisions, ideas, options, contributions and outcomes
  so they survive restarts.

**Deciding and strategies**

- **FR-005**: The system MUST provide built-in strategies: manual pick, uniform random, and
  weighted random.
- **FR-006**: Decision strategies MUST be modules implementing a common strategy contract; the
  built-in strategies MUST use the same contract as third-party ones.
- **FR-007**: Each outcome MUST record the chosen option(s), the strategy identity and version,
  its settings, the inputs considered, the random seed (if any), who triggered it, and when.
- **FR-008**: Outcomes MUST be append-only; deciding again adds a new outcome.
- **FR-009**: Any participant who can view a decision MUST be able to verify a recorded random
  outcome by reproducing it from its recorded inputs and seed.
- **FR-010**: A strategy MUST be able to declare preconditions (e.g. minimum option count,
  weights required) and the system MUST explain unmet preconditions instead of running it.

**Idea sources**

- **FR-011**: Idea sources MUST be modules implementing a common idea-source contract.
- **FR-012**: The system MUST include a clipboard idea source that splits pasted text into ideas
  (one per line or list item) and shows a preview before import.
- **FR-013**: The system MUST include a Google Docs idea source that imports list items or
  heading-delimited sections from documents the user explicitly selects, using read-only access.
- **FR-014**: Imported ideas MUST keep a reference to their source (source type, document,
  location) and re-importing MUST NOT create duplicates of unchanged items.
- **FR-015**: Additional sources (e.g. Obsidian vaults) MUST be addable as external plugins
  without changes to the application; an Obsidian source is NOT bundled.

**Agentic API**

- **FR-016**: The system MUST expose a documented, versioned agentic API offering parity with
  user actions relevant to agents: read decision/idea/option context, attach contributions,
  propose new options or ideas, and report request status.
- **FR-017**: The agentic API MUST be self-describing so an agent can discover available actions
  and their inputs without external documentation.
- **FR-018**: Users MUST be able to create an agent request on a decision, idea or option that
  bundles an instruction and a scoped access grant (target, permissions, expiry).
- **FR-019**: The system MUST let the user hand the agent request to an agent of their choice
  (copyable instructions plus access details), without requiring a specific AI vendor.
- **FR-020**: Agent grants MUST be limited to their target and permissions, time-limited
  (default 24 hours, user-adjustable) and revocable at any time.
- **FR-021**: Agent contributions MUST record the agent's self-declared name, the user it acted
  for, the request it belongs to, its content, its sources and its timestamp, and MUST be shown
  as agent-made and "pending review" until a human accepts, edits or dismisses them.
- **FR-022**: Agents MUST NOT be able to trigger outcomes, delete content, change sharing or
  act outside their grant; refused attempts MUST be logged and visible to the requesting user.

**Sharing and collaboration**

- **FR-023**: Owners MUST be able to share a decision with specific people and choose their
  access level: view or contribute (add options, notes and agent requests).
- **FR-024**: All changes to a shared decision MUST be attributed to the person or agent that
  made them, and visible to all participants with view access.
- **FR-025**: Owners MUST be able to revoke a participant's access at any time, effective
  immediately.
- **FR-026**: Concurrent edits by different participants MUST NOT silently overwrite each other.
- **FR-027**: Deciginator MUST be local-first: all data lives on the user's device and every
  non-network feature works offline. Sharing and remote agent access MUST go through an
  optional sync/relay service that anyone can self-host; a user who never shares never needs it.
- **FR-027a**: Only decisions the owner explicitly shares (and agent requests the user issues)
  MUST be sent to the sync/relay service; the service MUST NOT be able to read shared decision
  content it stores or relays (end-to-end protection). Exception: when a user chooses the
  "remote agent" channel, the scoped context that agent reads passes through the relay and
  could be visible to the relay operator in transit; the UI MUST state this before the request
  is created, and local agents or a self-hosted relay avoid it.
- **FR-027b**: Participants MUST be identified to each other by a display name and a stable
  identity created on their device; no central account sign-up is required.
- **FR-027c**: Collaborators with contribute access MUST be able to cast a ballot (vote or
  ranking) on decisions that use a group strategy; one active ballot per participant, replaced
  on re-vote. The owner chooses whether ballots are attributed or anonymous to other
  participants.
- **FR-027d**: Group strategies (tallying ballots) MUST be strategy modules using the same
  strategy contract; a plurality-vote strategy MUST be built in.

**Plugins and UI**

- **FR-028**: Every plugin MUST declare a manifest: identity, version, compatible platform
  version, provided extension points, required permissions and a settings schema.
- **FR-029**: The system MUST show requested permissions and require user approval before a
  plugin is enabled; plugins MUST only access what they were granted.
- **FR-030**: The system MUST generate each plugin's settings panel from its declared settings
  schema, with defaults and validation.
- **FR-031**: Users MUST be able to list, enable, disable, configure, install and uninstall
  plugins.
- **FR-032**: Plugins MAY contribute UI only into defined UI slots (e.g. option detail panel,
  decision toolbar, strategy chooser); they MUST NOT alter the primary flow.
- **FR-033**: A failing or unresponsive plugin MUST NOT block or crash the rest of the app; the
  user sees an error that names the plugin.
- **FR-034**: In v1, third-party plugins MUST be installable from a local package file or a URL,
  with the permission review of FR-029; an in-app community catalog is out of scope for v1.
  Installing from a URL MUST show the source and warn that the plugin is not reviewed by the
  project.

**Data ownership**

- **FR-035**: Users MUST be able to export all their decisions (including ideas, contributions
  and outcomes) in an open, documented format and import such an export.
- **FR-036**: Credentials for external services MUST never appear in exports, share links,
  logs or agent requests.
- **FR-037**: The default interface MUST meet WCAG 2.1 AA accessibility guidelines.

### Key Entities *(include if feature involves data)*

- **Decision**: A question to be resolved. Has title, description, owner, participants with
  access levels, options, contributions, outcome history, status (open, decided, archived).
- **Idea**: A raw item captured from a source or typed in. Has title, description, source
  reference, created-by, and may be linked to options derived from it.
- **Option**: A candidate answer within a decision. Has title, description, order, optional
  strategy inputs (e.g. weight), link to originating idea, and contributions.
- **Contribution**: Information attached to a decision, idea or option — note, research,
  pros/cons, links/sources. Has author (human or agent), on-behalf-of user, review status
  (pending, accepted, edited, dismissed) and timestamp.
- **Outcome**: An immutable record of one decision run: chosen option(s), strategy id and
  version, settings, inputs snapshot, seed, triggered-by and time.
- **Strategy**: A module that, given a decision's options and settings, produces an outcome.
  Declares name, description, version, preconditions and settings schema.
- **Idea Source**: A module that reads items from an external place (clipboard, Google Docs,
  third-party: Obsidian…) and produces ideas with source references.
- **Plugin**: An installable module package with a manifest (identity, version, compatibility,
  extension points, permissions, settings schema), enabled state and user settings.
- **Agent Request**: A user-issued task for an agent: instruction, target, access grant
  (permissions, expiry, revoked flag), requesting user, status, and resulting contributions.
- **Participant**: A person with access to a decision, identified by a device-created identity
  and display name, and their access level (owner, contribute, view).
- **Ballot**: A participant's vote or ranking on a decision's options for a group strategy;
  one active ballot per participant per decision, superseded on re-vote.
- **Sync/Relay Service**: An optional, self-hostable service that carries shared decisions and
  agent requests between participants' devices and remote agents without reading their content.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can create a decision with three options and record an outcome
  in under 60 seconds, without opening settings or documentation.
- **SC-002**: At least 90% of first-time test users complete the primary flow (add options →
  decide → view outcome) on the first attempt.
- **SC-003**: 100% of recorded random outcomes reproduce identically when verified.
- **SC-004**: A plugin author can build and load a working custom strategy by following the
  docs and example in under 30 minutes, without modifying the application.
- **SC-005**: Importing a 50-item list from the clipboard or a Google Doc takes under 10
  seconds end to end (excluding the one-time access grant).
- **SC-006**: A user can go from "Ask my agent" to seeing the agent's attributed contribution
  on the option in under 2 minutes of their own effort (excluding the agent's research time).
- **SC-007**: 100% of agent actions outside their grant, after expiry or after revocation are
  refused in testing.
- **SC-008**: A collaborator invited to a shared decision can open it and add a contribution in
  under 2 minutes from receiving the invitation.
- **SC-009**: Disabling or crashing any single plugin leaves the primary flow fully working.

## Assumptions

- The project will provide a reference sync/relay service that can be self-hosted; whether the
  project also operates a free public instance is a separate, non-blocking decision.
- Remote agents (running outside the user's device) reach agent requests through the
  sync/relay service; agents running on the same device may talk to the local app directly.
- The first release targets individuals and small groups (up to ~20 participants per decision);
  large-organization features (SSO, admin consoles, compliance reporting) are out of scope.
- "Your own agent" means any AI agent or assistant the user already uses that can follow
  instructions and call a documented API; Deciginator does not ship or pay for an AI model.
- Agents identify themselves by a self-declared name; the trust anchor is the user who issued
  the grant, not the agent's identity.
- Google Docs access is read-only and limited to documents the user explicitly selects;
  writing back to Google Docs is out of scope for v1.
- Obsidian support is delivered (if at all) by a separate, unbundled plugin; v1 only guarantees
  the idea-source contract makes it possible.
- Rich-text descriptions use a common lightweight markup; exact format is decided at planning.
- Mobile-specific apps are out of scope for v1; the UI should remain usable on small screens.
- English is the only UI language for v1, but user-facing text should be translatable later.
- Grant default expiry is 24 hours; contribution size and per-request count limits are set at
  planning with sensible defaults.
