# Feature Specification: Restore Shared Sessions Across Devices and Disconnects

**Feature Branch**: `006-restore-shared-sessions`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "check how we can restore sessions if link was shared. plan the architecture"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Project owner resumes hosting from a shared link or after reload (Priority: P1)

As a project owner who shared a live session link with collaborators, I want to reopen the shared link on my device or reload my browser tab and immediately resume hosting the session, so that returning collaborators and new guests are not locked out and the meeting can continue without needing a new link.

**Why this priority**: The host's tab is the authoritative coordinator of the session. If the owner accidentally refreshes their tab or clicks the link they pasted in chat and is treated as an ordinary guest or receives a connection failure, the entire live session collapses.

**Independent Test**: An owner starts a live session for "Team Offsite", closes the tab, and clicks the join link in their chat. Instead of an error or a guest join prompt, they are recognized as the owner and can resume hosting with one click. Returning guests reconnect to the same link.

**Acceptance Scenarios**:

1. **Given** an owner started a live session, **When** the owner opens the join link on the same device and browser profile, **Then** the application recognizes them as the project owner and offers to resume hosting or open the project.
2. **Given** an owner is hosting a live session with connected guests, **When** the owner refreshes the browser tab, **Then** hosting resumes automatically upon page reload and the connected guests reconnect within 5 seconds without having to re-enter a new link.
3. **Given** an owner resumes hosting an existing session, **When** guests join using the previously shared link or QR code, **Then** they connect to the resumed session with their previous identities and votes intact.

---

### User Story 2 - Returning guests view the session when the host is offline (Priority: P1)

As a guest who participated in a live decision session, I want to open the shared link even when the host's tab is closed or offline, so that I can immediately review the options, comments, my submitted votes, and the outcome without being blocked by an unreachable host error.

**Why this priority**: Deliberations frequently extend beyond live calls. Collaborators regularly check back to see final results or reference options. If the link displays an infinite spinner or failure error when the host shuts their laptop, confidence in the tool is broken.

**Independent Test**: Gina joins a session, votes, and closes her tab. The host also closes their tab. Gina reopens the shared link: instead of a connection failure after 2 minutes, she immediately sees the decision workspace displaying the last updated state, clearly marked as offline, showing her ratings and the current results.

**Acceptance Scenarios**:

1. **Given** a guest previously joined a live session, **When** they reopen the shared link while the host is offline, **Then** the decision title, options, comments, and results are displayed within 1 second from their saved local state.
2. **Given** a guest is viewing an offline session, **When** looking at the status, **Then** they see a clear indicator that the host is offline and the timestamp of the last synchronized state.
3. **Given** a guest is viewing an offline session, **When** the host reopens their project and resumes hosting, **Then** the guest's view seamlessly upgrades to live status within 5 seconds without requiring a manual page refresh.
4. **Given** a guest is viewing an offline session, **When** they attempt to submit a new vote or rating, **Then** the interface explains that changes cannot be recorded until the host reconnects.

---

### User Story 3 - Anyone with a shared link can view the decision asynchronously (Priority: P2)

As an invited participant who opens a shared session link after the live meeting has ended (or before the host rejoins), I want to view the latest decision state and outcomes, so that I can catch up on the decision without requiring the host to keep their computer running.

**Why this priority**: Decisions in distributed teams happen across time zones. Team members must be able to view shared decisions asynchronously without scheduling live sync windows.

**Independent Test**: A new participant who never visited the site before opens a shared link while the host is offline. Within 5 seconds, they see the complete options, discussions, and decision outcome.

**Acceptance Scenarios**:

1. **Given** a participant opens a valid shared link for the first time while the host is not actively online, **Then** they see the latest decision options, descriptions, and outcomes rather than an unresolvable link error.
2. **Given** a participant opens a shared link that has expired or is invalid, **Then** they see an informative explanation of why the session cannot be reached.

---

### User Story 4 - Collaborators save or restore the shared session into their own permanent workspace (Priority: P2)

As a participant in a shared session, I want to save the deliberation as an independent, permanent decision project in my own workspace, so that I can keep an enduring record, run future voting rounds, or customize options independently of the original host.

**Why this priority**: Guests need data autonomy (Principle V). Once a decision is made, participants often need to take the outcome into their own documentation, tools, or follow-up workflows.

**Independent Test**: Gina opens a shared session (live or offline) and clicks "Save to my workspace". A new, permanent decision project is created in her chosen storage, containing all options, comments, and attributed votes from the live session.

**Acceptance Scenarios**:

1. **Given** a participant viewing a live or offline shared session, **When** they choose to save to their workspace, **Then** a new project is created in their configured storage with the full title, options, comments, grades, and ballot history.
2. **Given** a saved project, **When** the participant inspects the entries, **Then** each comment, grade, and vote retains the author display name and timestamp from the original session.
3. **Given** a saved project, **When** the original host later modifies or ends their live session, **Then** the saved project remains completely unaffected as an independent copy.

---

### User Story 5 - Project owners monitor participants, drop votes, make sessions read-only, and revoke access (Priority: P1)

As a project owner hosting a live decision, I want to see which users have joined and participated, drop (reset) the votes of specific users if needed, switch the session to read-only mode to freeze input, and revoke access links or purge public relay records whenever I choose.  
As a participant, I want to view all sessions I have joined and manage cached data on my device.

**Why this priority**: Full administrative sovereignty and moderation (Principle V). The host coordinates the live meeting and must be able to see participants, remove disruptive or invalid votes, lock the deliberation to view-only when discussion ends, and revoke access.

**Independent Test**: An owner hosts a live session with Gina and Tom. Tom submits an invalid ballot. The owner opens the participant list in the live panel, clicks "Drop votes" for Tom, and turns on "Read-only mode". Tom's ballot is cleared from the tally, and both Gina's and Tom's screens immediately show "The host made this session view-only" with voting inputs disabled.

**Acceptance Scenarios**:

1. **Given** an owner has shared one or more projects, **When** they open the Sessions dashboard, **Then** they see a list of all shared sessions showing project titles, share links, active peer counts, hosting status (Live / Idle), and creation timestamps.
2. **Given** a live session with participants, **When** the owner views the live session panel or dashboard, **Then** an interactive participant roster displays all connected and participating users, showing their display names, online status, submitted grade count, and ballot status.
3. **Given** a participant who submitted grades and/or a ballot, **When** the host clicks "Drop votes" for that participant, **Then** a reset entry is recorded in the project store, the participant's grades and ballot are immediately removed from the project tally for everyone, and the participant is notified that their votes were reset.
4. **Given** a live session in contribution mode, **When** the host toggles the session to "Read-only", **Then** within 1 second all connected guests have their grading, commenting, and ballot inputs locked with the message "The host made this session view-only", and any incoming submissions are rejected with `read_only`.
5. **Given** a live session in read-only mode, **When** the host toggles back to "Allow contributions", **Then** all connected guests have their inputs re-enabled immediately.
6. **Given** an active or idle shared session, **When** the owner clicks "Revoke link", **Then** the previous link and QR code are permanently invalidated; any participant opening the old link is told "This session link has been revoked by the owner."
7. **Given** a session with a published snapshot on public relays, **When** the owner revokes or deletes the session with "Purge from relays", **Then** the snapshot is permanently retracted from public relays so no guest can retrieve it asynchronously.
8. **Given** a participant who has joined live sessions on this device, **When** they view "Joined Sessions", **Then** they see all past deliberations with project names, timestamps, and assigned names, with actions to reopen the session or "Remove from device" to delete cached local data.

---

### Edge Cases

- **Host clears browser storage**: If the host clears local application data, the reverse lookup mapping is removed. The link treats the browser as a guest, but the host can still open the project file or cloud record from their workspace and initiate a session.
- **Revoked link accessed by connected guest**: If the host revokes a session while guests are connected, the host immediately closes their links with the message "This session has been revoked by the owner."
- **Relay retraction race**: If a guest was actively fetching a snapshot while the host published a retraction tombstone, the tombstone takes precedence because it bears a later timestamp.
- **Dropped votes audit trail**: When a participant's votes are dropped, past historical outcomes continue to verify correctly because the reset is an append-only entry rather than an in-place mutation.
- **Duplicate guest display names across reconnects**: If a guest reconnects after the host was offline, the host ensures the guest retains their assigned numbered name (e.g. "Gina 2").
- **Concurrent submissions during brief host drop**: Any guest submission made during the brief moment before disconnect detection is rejected with a clear notification ("Host disconnected; submission not saved"), prompting retry once the connection restores.
- **Storage quota on guest device**: If a guest participates in many live sessions, cached snapshots are managed locally on a least-recently-used basis to stay within device storage quotas while keeping recent sessions accessible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST recognize when the current browser is the host of a shared session link and provide a direct path to resume hosting.
- **FR-002**: An active hosting session MUST survive browser page reloads and temporary tab closures on the host's device, automatically resuming with the same session credentials.
- **FR-003**: Returning guests MUST be able to view their previously received decision state (options, grades, comments, results) immediately when opening the link, even when the host is unreachable.
- **FR-004**: The system MUST display clear visual indicators distinguishing live interactive sessions from offline or cached states, including the timestamp of the last known update.
- **FR-005**: When the host reconnects, any connected or viewing guests MUST automatically synchronize with the latest project state without losing their current view.
- **FR-006**: First-time visitors opening a shared session link while the host is offline MUST receive the latest published decision snapshot asynchronously whenever network relay services are available.
- **FR-007**: Every shared session MUST allow participants to export or restore the deliberation into a new, independent project within their personal workspace.
- **FR-008**: Restoring a session into an independent project MUST preserve all author attributions, ratings, rankings, comments, option properties, and chronological history.
- **FR-009**: Session links and cached offline data MUST NOT leak private decryption keys, host credentials, or unredacted author data beyond the permissions granted in the session.
- **FR-010**: The system MUST provide a central dashboard displaying all hosted and joined sessions with their status, link, and last active timestamp.
- **FR-011**: Project owners MUST be able to revoke a shared session link at any time, instantly invalidating the session credentials and preventing further connections.
- **FR-012**: Revoking or ending a session MUST support purging the published asynchronous snapshot from public relays (retraction).
- **FR-013**: Participants MUST be able to view their joined session history and selectively delete cached deliberations from local device storage.
- **FR-014**: The host MUST be able to view an interactive participant roster showing all connected and participating users with their activity status (grade count, ballot submission status).
- **FR-015**: The host MUST be able to drop (reset) the grades and ballots of any specific participant directly from the session interface, immediately updating the decision tally for all peers.
- **FR-016**: The host MUST be able to dynamically toggle the live session between interactive contribution mode and read-only mode, instantly locking or unlocking guest controls in real time.

### Key Entities

- **Session Reference**: The unique identifier and access credentials encoded in the shareable link that define a collaborative decision instance.
- **Session Snapshot**: The point-in-time state of a decision project (options, ratings, comments, voting results, and history) available to session participants.
- **Local Session Cache**: The browser-persisted record of previously joined sessions, storing the latest received snapshot, the participant's assigned identity, and synchronization timestamps.
- **Workspace Project**: A permanent, independently managed decision record stored in a user's chosen storage system (local or cloud).
- **Session Control Registry**: The local index of all hosted sessions, their credentials, active statuses, and revocation flags.
- **Live Participant Profile**: The host-tracked record of a session participant containing their participant ID, display name, connection state, and submission counts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Returning participants can view the decision options and last known results in under 1 second when opening a shared link, regardless of host online status.
- **SC-002**: When a host refreshes their browser tab during a live session, connected guests reconnect within 5 seconds without manual intervention or link re-entry.
- **SC-003**: 100% of author names, grades, comments, and voting outcomes are preserved when a participant restores a shared session into their workspace.
- **SC-004**: First-time guests on supported networks can access the decision state within 5 seconds of opening a shared link, even if the host is offline.
- **SC-005**: When an owner revokes a link, 100% of subsequent connection attempts using the old link are refused within 1 second with a clear revocation notice.
- **SC-006**: When the host toggles read-only mode, 100% of connected guest controls are locked within 1 second.
- **SC-007**: When the host drops a participant's votes, the updated tally reaches all connected peers within 1 second.

## Assumptions

- Participants use modern web browsers with standard client-side storage capabilities.
- Live real-time interaction (submitting new votes, adding comments) requires an active host to validate and record writes into the authoritative project store.
- Public relay services used for asynchronous rendezvous do not retain data permanently; local caching on participant devices ensures lasting availability.
- A guest's identity is tied to their device profile; returning to a session from the same browser preserves their prior submissions and assigned name.
