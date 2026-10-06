# Implementation Plan: Local & Universal Storage with In-Page Sharing

**Branch**: `002-local-storage-sharing` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-local-storage-sharing/spec.md`

## Summary

This feature delivers:
1. **Universal Storage Architecture**: Decouples `apps/web` from concrete store implementations by introducing a `StorageManager` registry. Supports user-selectable "Activated Storage" (Google Drive, Firestore, or Local File) and transparent URL routing (`/p/:storeId/:id`).
2. **Browser-Local File Storage (`store-file`)**: Implements `ProjectStore` using the HTML5 File System Access API (`.decisionator.json` directly saved to disk with live auto-save stream, falling back to browser downloads/IndexedDB). Enables completely private, zero-config, offline decision making.
3. **Firestore Cloud Storage (`store-firestore`)**: Implements `ProjectStore` using modular Firebase v10 SDK. Delivers subsecond live updates via `onSnapshot`, append-only audit logs, and WebCrypto AES-GCM client-side encryption for password-protected decisions.
4. **In-Page Local Sharing ("In-Page Server")**: Introduces a peer-to-peer collaboration module where the host browser tab acts as an authoritative in-page server coordinating votes directly over WebRTC DataChannels and BroadcastChannel without third-party databases.

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict ESM). Browser runtime targets evergreen browsers (Chromium, Firefox, Safari). Node.js 24 LTS for tooling.

**Primary Dependencies**:
- UI: React 19, Vite, React Router 7.
- Universal Storage & Local File: HTML5 File System Access API, `idb` (IndexedDB draft cache), Zod 4 (`ProjectExportV1Schema`).
- Cloud Storage: Firebase JS SDK v10 (`firebase/app`, `firebase/firestore`, `firebase/auth`).
- In-Page Peer Sharing: WebRTC (`RTCPeerConnection`, `RTCDataChannel`), browser `BroadcastChannel` API, and lightweight zero-data signaling.
- Crypto & Integrity: WebCrypto (AES-GCM, PBKDF2), `@noble/hashes` (SHA-256).

**Storage**:
- Local File: `.decisionator.json` files on user device via `FileSystemFileHandle`.
- Firestore: `/projects/{id}`, `/options/{id}`, `/entries/{id}`.
- Google Sheets: Existing Drive v3 + Sheets v4 integration.
- In-Page Session: Ephemeral host memory + WebRTC DataChannel message stream.

**Testing**: Vitest 3, `@decisionator/plugin-sdk/testing` (`runProjectStoreContractTests`), and MSW / Firebase Emulator.

**Target Platform**: Browser SPA (GitHub Pages static host) with optional offline PWA support.

**Performance Goals**:
- Subsecond (<1000ms) sync latency for Firestore `onSnapshot` and in-page WebRTC peer updates.
- Zero-latency local file and memory updates.

**Constraints**:
- Must comply with Constitution Principle I (Everything is a module) and Principle V (User owns the data; zero plaintext leakage).
- Backward compatibility for existing Google Drive project URLs.

**Scale/Scope**:
- Support up to 20 concurrent peer participants in in-page sharing.
- Unlimited projects in local file system and Firestore.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Evaluation | Status |
|-----------|------------|:------:|
| **I. Minimal Core, Everything Is a Module** | Local file storage, Firestore storage, and in-page sharing are implemented as standalone modules implementing public SDK contracts (`ProjectStore`, `ShareProvider`). The core remains minimal. | **PASS** |
| **II. Stable, Versioned Contracts** | Uses `@decisionator/plugin-sdk`'s `ProjectStore` v1.1.0 contract without breaking changes. Introduces versioned `StorageManager` (v1.0.0) and in-page peer message contracts. | **PASS** |
| **III. Simple by Default, Deep on Demand** | Default experience requires zero login or cloud setup (saving directly to file). Cloud backends and in-page sharing are accessible progressively on demand. | **PASS** |
| **IV. Agent-Native by Design** | Local files and Firestore entries use standard Zod schemas (`decisionator.project/v1`), easily discoverable and parseable by local agents. | **PASS** |
| **V. User Owns the Data** | Local files live on the user's disk. Password protection encrypts all payloads via WebCrypto before writing to Firestore. Zero tracking or remote lock-in. | **PASS** |
| **VI. Transparent, Reproducible Decisions** | Append-only entries strictly enforced across both Firestore and Local File backends; deterministic tally strategies preserved. | **PASS** |
| **VII. Test-First for Contracts** | Contract tests (`runProjectStoreContractTests`) will be written and executed against `FileProjectStore` and `FirestoreProjectStore` before rollout. | **PASS** |

---

## Project Structure

### Documentation (this feature)

```text
specs/002-local-storage-sharing/
├── spec.md                  # Feature specification
├── plan.md                  # Implementation plan (this file)
├── research.md              # Phase 0 technical research
├── data-model.md            # Phase 1 data models & schemas
├── quickstart.md            # Phase 1 validation scenarios
├── contracts/               # Phase 1 interface contracts
│   ├── universal-storage.md # StorageManager contract
│   ├── file-store.md        # FileProjectStore contract
│   ├── firestore-store.md   # FirestoreProjectStore contract
│   └── inpage-share.md      # In-Page Sharing protocol
└── checklists/
    └── requirements.md      # Spec quality checklist
```

### Source Code Layout

```text
packages/
├── plugin-sdk/              # Storage & plugin interfaces
│   └── src/
│       └── storage-manager.ts # StorageManager base interface
plugins/
├── store-file/              # NEW: Local File System Access API ProjectStore
│   ├── src/
│   │   ├── index.ts
│   │   ├── file-store.ts
│   │   └── download-fallback.ts
│   └── test/
│       └── contract.test.ts
├── store-firestore/         # NEW: Firebase Firestore ProjectStore
│   ├── src/
│   │   ├── index.ts
│   │   ├── firestore-store.ts
│   │   ├── collections.ts
│   │   └── config.ts
│   └── test/
│       └── contract.test.ts
├── share-inpage/            # NEW: In-Page WebRTC Peer Sharing
│   ├── src/
│   │   ├── index.ts
│   │   ├── host-server.ts
│   │   ├── peer-client.ts
│   │   └── protocol.ts
│   └── test/
│       └── inpage.test.ts
apps/
└── web/
    └── src/
        ├── storage/         # Universal storage manager & active store context
        │   ├── StorageContext.tsx
        │   └── storage-manager.ts
        ├── features/
        │   ├── settings/
        │   │   └── StorageSettings.tsx # Active storage switcher
        │   └── sharing/
        │       └── InPageShareModal.tsx # In-page sharing host & QR UI
        └── app/             # Generalized routing (/p/:storeId/:id)
```

**Structure Decision**: Monorepo plugin architecture: New storage and sharing capabilities live in modular plugin packages under `plugins/`, registered into `apps/web` through the universal `StorageManager`.

## Complexity Tracking

*No constitutional violations; no complexity exemptions requested.*
