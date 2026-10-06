# Data Model: Local & Universal Storage with In-Page Sharing

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

This document specifies data structures, entities, and storage layouts across the universal storage layer, local file storage, Firestore cloud backend, and in-page sharing.

---

## 1. Storage Placement & Overview

| Storage Backend | Primary Medium | Persistence Lifetime | Scope & Use Case |
|-----------------|----------------|----------------------|------------------|
| **Local File (`store-file`)** | Host OS Filesystem (`.decisionator.json`) via File System Access API | Permanent disk file | Default offline storage when no cloud store is activated; full user data ownership |
| **Firestore (`store-firestore`)** | Google Cloud Firestore (multi-region NoSQL) | Remote database | Team collaboration, multi-device sync, real-time live updates |
| **Google Sheets (`store-google-sheets`)** | Google Drive / Google Sheets v4 | Remote spreadsheet | Personal Drive spreadsheet storage (existing MVP) |
| **In-Page Share Session** | WebRTC DataChannel (Host memory) | Ephemeral (duration of open tab) | Real-time peer voting directly coordinated by the host's browser page |

---

## 2. Universal Storage Entities

### Active Storage Preference
Persisted in browser `localStorage` (`decisionator_active_storage_v1`).

```ts
interface ActiveStorageConfig {
  activeStoreId: "file" | "firestore" | "google-sheets" | "local";
  configuredStores: {
    firestore?: {
      apiKey: string;
      authDomain: string;
      projectId: string;
      storageBucket?: string;
      messagingSenderId?: string;
      appId: string;
    };
    googleSheets?: {
      clientId?: string;
    };
    local?: {
      dbName?: string;
    };
  };
}
```

### Universal Project Reference (`ProjectRef`)
Standardized across all storage providers:

```ts
interface ProjectRef {
  store: "file" | "firestore" | "google-sheets" | "local";
  id: string; // File name/handle-hash for file; Firestore document ID; Drive file ID; or local Automerge docId
  name?: string; // Human-friendly display label
  handle?: FileSystemFileHandle; // Present in active browser memory for live file-backed projects
}
```

---

## 3. Local File Storage Layout (`.decisionator.json`)

The local file uses the versioned `ProjectExportV1` JSON schema defined in `@decisionator/core`:

```json
{
  "format": "decisionator.project/v1",
  "exportedAt": "2026-10-06T08:30:00.000Z",
  "project": {
    "title": "Quarterly Strategy Decision",
    "description": "Choose between Product A and Product B",
    "protected": false,
    "formatVersion": 2,
    "voting": {
      "state": "open",
      "round": 1,
      "topN": 3,
      "liveResults": true
    }
  },
  "options": [
    {
      "id": "01J9...",
      "title": "Option A: Mobile First",
      "description": "Focus development on mobile app",
      "order": 0,
      "status": "active",
      "pros": ["Faster user acquisition"],
      "cons": ["Higher development overhead"],
      "tags": ["mobile", "q4"],
      "at": "2026-10-06T08:31:00.000Z",
      "by": "local-author@device"
    }
  ],
  "grades": [],
  "comments": [],
  "rankings": [],
  "outcomes": [],
  "contributions": []
}
```

---

## 4. Firestore Document & Subcollection Schema

### 1. Document: `/projects/{projectId}`
```ts
interface FirestoreProjectDoc {
  formatVersion: 2;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  isProtected: boolean;
  
  // Present if isProtected === true
  crypto?: {
    salt: string;
    iterations: number;
    verifier: string;
  };

  voting: {
    state: "open" | "closed";
    round: number;
    topN: number;
    liveResults: boolean;
  };
}
```

### 2. Subcollection: `/projects/{projectId}/options/{optionId}`
```ts
interface FirestoreOptionDoc {
  id: string; // ULID
  order: number;
  status: "active" | "removed";
  title: string;
  description: string; // Plaintext or AES-GCM ciphertext base64
  category?: string;
  tags: string[];
  pros: string[];
  cons: string[];
  effort?: "XS" | "S" | "M" | "L" | "XL";
  links: { title?: string; url: string }[];
  at: string;
  by: string;
}
```

### 3. Subcollection: `/projects/{projectId}/entries/{entryId}` (Append-Only Log)
```ts
interface FirestoreEntryDoc {
  id: string; // ULID
  kind: "grade" | "comment" | "ranking" | "outcome" | "contribution";
  participantId: string;
  displayName: string;
  at: string; // ISO-8601
  payload: Record<string, unknown>; // Or { ciphertext: string, iv: string } if protected
}
```

---

## 5. In-Page Sharing Message Protocol

Messages exchanged over WebRTC DataChannel / BroadcastChannel:

```ts
type InPagePeerMessage =
  | {
      type: "PEER_HELLO";
      participantId: string;
      displayName: string;
    }
  | {
      type: "HOST_WELCOME";
      snapshot: ProjectSnapshot;
      role: "contribute" | "view";
    }
  | {
      type: "PEER_APPEND";
      entries: Entry[];
    }
  | {
      type: "HOST_SNAPSHOT_UPDATE";
      snapshot: ProjectSnapshot;
    }
  | {
      type: "HOST_CLOSING";
      reason: string;
    };
```
