# Research: Local & Universal Storage with In-Page Sharing

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document resolves technical choices, dependencies, and integration patterns for:
1. Universal Storage Manager & Provider Registration
2. Browser-Local File Storage (`store-file` / File System Access API)
3. Firestore Storage Provider (`store-firestore` / Firebase v10 Modular SDK)
4. In-Page Local Sharing ("Local Server Directly from Page" via WebRTC DataChannels)

---

## R1: Universal Storage Architecture & Active Store Manager

### Problem
`apps/web` currently has hardcoded references to `GoogleSheetsProjectStore` and `GoogleAuthService` across pages (`HomePage.tsx`, `ProjectViewPage.tsx`, `pages.tsx`, `createProject.ts`). We need a universal storage abstraction that allows multiple backends (`google-sheets`, `firestore`, `local`, `file`) to register, allows users to choose an "Activated Storage" backend, and resolves project references (`ProjectRef = { store: string, id: string }`) uniformly.

### Decision
Implement a `StorageManager` in `apps/web/src/storage/` (with base types in `@decisionator/plugin-sdk`):
- **Store Registry**: A registry maintaining instances of `ProjectStore` implementations.
- **Active Store Selection**: Persisted in `localStorage` under `decisionator_active_store` (defaulting to `"file"` if no remote backend is activated/authenticated).
- **Uniform Project Reference Dispatch**:
  - `storageManager.getStore(storeId: string): ProjectStore`
  - `storageManager.getActiveStore(): ProjectStore`
  - `storageManager.resolve(ref: ProjectRef): ProjectStore`
- **Route Generalization**: Update web routes to support `/p/:storeId/:id` (with fallback for legacy `/p/:id` mapping to the active store or checking store ID prefixes).

### Alternatives Considered
- *Hardcoding an `if (store === 'firestore')` branch in every page*: Rejected. Violates Constitution Principle I ("Everything is a module").
- *Redux/Context-only store manager*: Storage operations must also be callable from hooks, utility functions, and background sync workers without React tree dependency.

---

## R2: Browser-Local File Storage Provider (`store-file`)

### Problem
Users need to use Deci 100% locally in the browser with zero cloud accounts or network traffic. When no cloud storage is activated, work must be saved to a local file, and existing files must be openable and editable.

### Decision
Implement `FileProjectStore` implementing the `ProjectStore` contract:
1. **Primary API — File System Access API (`window.showOpenFilePicker` / `window.showSaveFilePicker`)**:
   - Modern Chromium browsers (Edge, Chrome, Opera, Brave) support direct disk read/write via `FileSystemFileHandle`.
   - Projects are saved as formatted JSON (`.decisionator.json` conforming to `ProjectExportV1` schema in `@decisionator/core`).
   - Every mutation (`append`, `updateOptions`, `updateMeta`) streams an updated serialized bundle to disk via `handle.createWritable()`.
2. **Fallback API — In-Memory + IndexedDB + Download/Upload**:
   - For browsers without File System Access API (Safari, Firefox):
     - Uses IndexedDB for persistent local working copies.
     - Provides an explicit "Save / Download File" action and drag-and-drop / file input upload to reopen.
3. **Identity & Roles**:
   - Local user defaults to `local-author@device` or a custom configured display name.
   - Local author is always assigned role `"owner"`.

### Alternatives Considered
- *Only IndexedDB (`store-local`)*: IndexedDB is hidden in browser internal storage. If the user clears browser data or switches browsers, work is lost. A real file on the user's hard drive gives full data ownership (Constitution Principle V).
- *SQLite WASM (OPFS)*: Adds significant bundle size (~2MB) and binary complexity without being directly inspectable or shareable like standard `.decisionator.json` files.

---

## R3: Firestore Cloud Storage Integration (`store-firestore`)

### Problem
Teams require real-time collaborative decision making alongside Google Sheets, using Google Firebase/Firestore with low latency and instant updates.

### Decision
Implement `@decisionator/store-firestore` / `plugins/store-firestore`:
1. **SDK**: Firebase JS SDK v10 (modular tree-shaken imports from `firebase/app`, `firebase/firestore`, `firebase/auth`).
2. **Collection / Document Structure**:
   ```
   /projects/{projectId}
     ├── meta (title, description, voting state, password protection fields)
     ├── /options/{optionId}
     └── /entries/{entryId} (append-only log: grades, comments, rankings, outcomes)
   ```
3. **Real-Time Sync**:
   - `store.watch(ref, onChange)` establishes `onSnapshot` listeners on `/projects/{projectId}` and its subcollections.
   - Emits a rebuilt `ProjectSnapshot` whenever Firestore snapshots change.
4. **Append-Only Enforcement**:
   - Entries are written with `doc(collection(db, "projects", id, "entries"))`.
   - Security rules: `allow create: if request.auth != null; allow update, delete: if false;`.
5. **Client-Side Encryption**:
   - Reuses `@decisionator/core`'s WebCrypto primitives (`deriveKey`, `encrypt`, `decrypt`, `makeVerifier`, `checkVerifier`).
   - When a password is set on the project, all entry payloads and option descriptions are encrypted before calling Firestore `setDoc`/`addDoc`. Plaintext never touches Firestore.

### Alternatives Considered
- *Firestore REST API with polling*: Higher latency, loses real-time WebSocket/gRPC streaming benefits of `onSnapshot`.
- *Storing entire project in a single document*: Firestore documents have a 1MB limit. High-volume comments, votes, and option lists could exceed 1MB; subcollections scale cleanly to thousands of entries.

---

## R4: In-Page Local Sharing ("Local Server Directly from Page")

### Problem
Users need a way to share a decision project locally directly from the browser tab without deploying or paying for a backend server or cloud database.

### Decision
Implement an in-page P2P coordinator module (`plugins/share-inpage` / `@decisionator/share-inpage`):
1. **Architecture: Tab as Authoritative Peer Server**:
   - Host tab creates an ephemeral Session ID and generates a join URL (`#share=p2p:<sessionId>`) with QR code.
   - Host tab holds the master `ProjectSnapshot` and acts as the room host.
2. **Transport: WebRTC DataChannels**:
   - Peer connections are established via WebRTC DataChannels.
   - Ephemeral peer signaling uses a public zero-storage WebRTC signaling relay (e.g. public STUN/TURN + WebRTC signaling via PeerJS or Nostr/MQTT broker) or QR code / copy-paste signaling fallback for strictly isolated LANs.
   - On the same machine/browser, uses `BroadcastChannel("deci_p2p_<sessionId>")` for instantaneous zero-network multi-tab collaboration.
3. **Message Protocol**:
   - `PEER_JOIN { participantId, displayName }` → Host replies with `SESSION_WELCOME { snapshot, role }`.
   - `PEER_APPEND { entries: Entry[] }` → Host validates entries, appends them to its active store (e.g. Local File or IndexedDB), and broadcasts `SNAPSHOT_UPDATE { snapshot }` to all connected peers.
   - `HOST_CLOSING` → Host notifies peers that session is terminating; peers can save a local snapshot.

### Alternatives Considered
- *Running a local Node.js server*: Requires users to install Node.js and run CLI commands. Doesn't meet the "working directly from page" requirement for standard web users.
- *WebTorrent protocol*: Optimized for static file chunks, not low-latency bidirectional RPC/event messaging. WebRTC DataChannels are the standard browser-native solution for peer data exchange.
