# Feature Specification: Local & Universal Storage with In-Page Sharing

**Feature Branch**: `002-local-storage-sharing`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Make module to work local on browser with universal api and save work in activated storage. If there is no activated then in file. Add firestore alongside with Google api. Also we need local sharing module, can we have something like local server working directly from page?"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Local-First Decision Making with File Fallback (Priority: P1)

A user wants to quickly start a decision process (brainstorm ideas, evaluate options, and cast votes) in their browser without signing up, connecting any external cloud account, or sending data across the internet. If no remote storage provider is activated, the system defaults to saving work directly into a local file on their device. When returning later, the user can reopen the file and continue right where they left off.

**Why this priority**: Delivers immediate, zero-friction value for private or offline users. Ensures the decision tool functions fully on day one without cloud dependencies.

**Independent Test**: Can be tested completely offline: open app in a fresh browser session, create a decision project with three options, add a vote, save to a local file, close the browser, reopen the file, and verify all options and votes remain intact.

**Acceptance Scenarios**:

1. **Given** a user with no cloud storage activated, **When** they create a new decision project and save changes, **Then** the application prompts to save the project as a local file and automatically persists subsequent updates to that file.
2. **Given** an existing decision file on the user's computer, **When** the user opens or imports that file into the application, **Then** the full decision state (metadata, options, votes, and history) is loaded and editable.
3. **Given** a user editing a file-backed project, **When** they make additions or adjustments, **Then** the local file is updated without requiring re-authentication or network access.

---

### User Story 2 - Universal Storage Selection & Multi-Backend Support (Priority: P2)

A user or team with an active cloud storage preference (such as Google Drive/Sheets or Firestore) wants to select and activate that backend as their primary storage location. The application provides a unified interface where users can switch their active storage provider, see which backend is active, and migrate existing decisions between storage providers seamlessly.

**Why this priority**: Enables cross-device persistence and cloud collaboration for users who want it, while abstracting storage mechanics behind a single, consistent user experience.

**Independent Test**: Activate Firestore or Google Drive in storage settings, create a project, and verify it stores remotely; then switch active storage to another provider or local file and verify migration operates smoothly.

**Acceptance Scenarios**:

1. **Given** a user in the storage settings, **When** they view available storage providers, **Then** they see status indicators for available backends (Local File, Google Drive, and Firestore) and can select which one is currently activated.
2. **Given** an active cloud storage backend (Google Drive or Firestore), **When** a user creates a new project, **Then** the project is created in that activated storage backend and appears in their project catalog.
3. **Given** a project stored in one location (e.g. Local File), **When** the user chooses to move or copy it to another activated storage (e.g. Firestore), **Then** the decision content is transferred losslessly and accessible via the new location.

---

### User Story 3 - Firestore Cloud Storage Integration (Priority: P3)

A team using Firestore wants to use it as their collaborative decision backend alongside the existing Google Drive integration. They want real-time synchronization so that when any participant votes, adds options, or comments, changes appear instantly for other team members without manual refreshes, adhering to append-only decision auditability and client-side encryption when a password is set.

**Why this priority**: Provides a low-latency, scalable cloud option for organizations and teams using the Firebase ecosystem.

**Independent Test**: Connect two browser windows to the same Firestore-backed project, submit a vote in one window, and observe the results update in the other window in real time without refreshing.

**Acceptance Scenarios**:

1. **Given** Firestore activated as the storage provider, **When** a user creates a project, **Then** the project metadata and options are initialized in Firestore and assigned a shareable project link.
2. **Given** multiple collaborators viewing an open Firestore project, **When** one collaborator records a grade or comment, **Then** all other collaborators see the update reflected live.
3. **Given** a password-protected Firestore project, **When** entries are saved, **Then** sensitive content is encrypted on the client device before reaching the cloud database.

---

### User Story 4 - Direct In-Page Local Sharing & Peer Collaboration (Priority: P4)

A user running a decision session locally (from a local file or browser storage) wants to invite nearby colleagues to vote or contribute in real time without creating cloud accounts or hosting a dedicated backend server. The user turns on "In-Page Live Share", and their browser tab acts as a local session coordinator (in-page server). Collaborators connect directly to the host tab via a generated link or QR code, cast their ballots, and the host tab collects and tallies the responses directly into the local project file.

**Why this priority**: Fulfills the "local server working directly from page" requirement, enabling live in-person or ad-hoc collaborative voting without third-party server infrastructure.

**Independent Test**: Open a local file project in Host Browser A, click "Start In-Page Live Session", scan/open the generated peer link in Guest Browser B on the same network, submit a ballot from Browser B, and verify Browser A tallies the vote and updates the local file.

**Acceptance Scenarios**:

1. **Given** an active decision project in a browser tab, **When** the owner activates "In-Page Live Share", **Then** the tab initializes as an in-page session host and generates a temporary join link and QR code.
2. **Given** a guest navigating to the join link while the host tab is open, **When** the guest submits a vote or option, **Then** the data is securely transmitted directly to the host tab and incorporated into the decision snapshot.
3. **Given** an ongoing in-page session, **When** the host tab closes or stops sharing, **Then** guests are informed that the host is offline, and guest tabs can optionally download a read-only copy of the final tallied state.

---

### Edge Cases

- **No File System Access Support**: When a browser does not support direct disk file editing, how does the local file fallback function? The system must fall back to in-memory/browser-cached storage with explicit download prompts and file-drag import.
- **Host Tab Disconnection During In-Page Sharing**: If the host closes their browser tab while peers are voting, pending unacknowledged peer votes must notify the peer that the host has disconnected.
- **Multiple Simultaneous Local Edits**: If two tabs open the same local file concurrently, the system must detect file timestamp or version conflicts and warn the user before overwriting.
- **Storage Backend Switching with Unsaved Changes**: If a user switches the active storage while drafting, the draft must remain preserved in memory and saved to the newly selected target.
- **Firestore Offline Transition**: If network drops while using Firestore, operations must queue locally and automatically synchronize once connectivity is restored.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a unified storage interface capable of dispatching project operations uniformly across all supported storage backends.
- **FR-002**: The system MUST provide a Local File storage backend that reads and writes project data directly to/from local files on the user's device.
- **FR-003**: When no external or database storage provider is activated, the system MUST default to the Local File storage backend for newly created projects.
- **FR-004**: The system MUST maintain an "Active Storage" setting indicating which storage provider is currently preferred for new projects (Local File, Google Drive, or Firestore).
- **FR-005**: The system MUST allow users to view, configure, and switch the active storage provider from the application settings.
- **FR-006**: The system MUST support opening and viewing projects from any supported storage provider regardless of which provider is currently marked as active.
- **FR-007**: The system MUST provide lossless export and migration between any pair of storage backends (e.g. from Local File to Firestore, or from Google Drive to Local File).
- **FR-008**: The system MUST implement a Firestore storage backend that stores project metadata, options, and an append-only log of grades, comments, rankings, and outcomes.
- **FR-009**: The Firestore backend MUST support real-time change notifications, broadcasting remote project updates to active viewers without manual page refresh.
- **FR-010**: The Firestore backend MUST enforce append-only integrity for decision entries, preventing tampering with or deletion of historical votes.
- **FR-011**: The Firestore backend MUST support client-side password protection, ensuring project data is encrypted prior to transmission whenever a password is set.
- **FR-012**: The system MUST provide an In-Page Sharing capability where an open browser tab acts as a local session coordinator for real-time peer participation.
- **FR-013**: The In-Page Sharing module MUST generate a shareable link and visual QR code that peers can use to connect directly to the active session host.
- **FR-014**: The In-Page Sharing module MUST attribute and validate contributions received from peers and record them into the host's active project storage.
- **FR-015**: The In-Page Sharing module MUST notify connected peers if the host becomes unavailable and allow peers to export or retain their local view of the session.

### Key Entities

- **Storage Provider**: A registered persistence adapter representing a specific storage mechanism (Local File, Google Drive, Firestore) adhering to the standard project lifecycle contract.
- **Active Storage Configuration**: The user preference defining the designated default storage provider for new projects, along with provider-specific connection settings.
- **Project Reference**: A globally unique identifier specifying both the storage provider type and the project identifier (e.g. store type and resource ID).
- **In-Page Share Session**: An ephemeral coordination session hosted inside an active browser tab, managing connected peer participants, session tokens, and real-time message exchange.
- **Peer Participant**: A user connected directly to an In-Page Share Session who can view the decision project and submit votes or comments according to granted permissions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: First-time users can launch the application, create a decision project, and save it to a local file in under 60 seconds with zero configuration or cloud logins.
- **SC-002**: Decision projects stored in Local File format can be reopened, edited, and validated with 100% data fidelity across browser restarts.
- **SC-003**: Live updates made in a Firestore-backed project or an In-Page Share session are reflected on collaborator screens within 1 second under standard network conditions.
- **SC-004**: Migrating a project between any two storage providers preserves 100% of options, tags, comments, grades, and historical outcomes.
- **SC-005**: An In-Page Share host can successfully coordinate and collect votes from up to 20 concurrent peer participants without requiring an external server or database.

## Assumptions

- Users choosing the Local File backend in modern browsers benefit from direct live-file saving via standard browser file access APIs; in older or restricted browsers, standard file download/import is used as a seamless fallback.
- In-Page Sharing uses standard peer-to-peer browser connectivity mechanisms with a lightweight public or local signaling coordinator to establish direct peer connections between devices without passing decision contents through any intermediary database.
- Firestore configuration allows users to either input their own Firebase project credentials or connect to an organization-provided project.
- Password-protected decisions continue to employ client-side WebCrypto encryption (AES-GCM with PBKDF2 key derivation), ensuring no plaintext leaves the client regardless of whether Firestore or Google Drive is used.
