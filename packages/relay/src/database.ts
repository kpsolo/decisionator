import { DatabaseSync } from "node:sqlite";
import type { SignedAcl, StoredChangeBatch } from "./protocol.js";

export interface StoredDoc {
  docId: string;
  aclJson: string;
  version: number;
  keyEpoch: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredInvite {
  inviteId: string;
  docId: string;
  role: "contribute" | "view";
  expiresAt: string;
  status: "pending" | "accepted" | "fulfilled";
  inviteeKey?: string;
  inviteeEncKey?: string;
  sealedKey?: string;
  createdAt: string;
}

export interface StoredSnapshot {
  docId: string;
  seq: number;
  keyEpoch: number;
  nonce: string;
  ciphertext: string;
  signerKey: string;
  createdAt: string;
}

export class RelayDatabase {
  private db: DatabaseSync;

  constructor(filePath = ":memory:") {
    this.db = new DatabaseSync(filePath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        docId TEXT PRIMARY KEY,
        aclJson TEXT NOT NULL,
        version INTEGER NOT NULL,
        keyEpoch INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS changes (
        docId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        keyEpoch INTEGER NOT NULL,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        signerKey TEXT NOT NULL,
        signature TEXT NOT NULL,
        receivedAt TEXT NOT NULL,
        PRIMARY KEY (docId, seq)
      );

      CREATE TABLE IF NOT EXISTS invites (
        inviteId TEXT PRIMARY KEY,
        docId TEXT NOT NULL,
        role TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        status TEXT NOT NULL,
        inviteeKey TEXT,
        inviteeEncKey TEXT,
        sealedKey TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        docId TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        keyEpoch INTEGER NOT NULL,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        signerKey TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);
  }

  saveDoc(docId: string, acl: SignedAcl): void {
    const aclJson = JSON.stringify(acl);
    const now = new Date().toISOString();
    const existing = this.getDoc(docId);
    if (!existing) {
      const stmt = this.db.prepare(
        "INSERT INTO docs (docId, aclJson, version, keyEpoch, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"
      );
      stmt.run(docId, aclJson, acl.version, acl.keyEpoch, now, now);
    } else {
      const stmt = this.db.prepare(
        "UPDATE docs SET aclJson = ?, version = ?, keyEpoch = ?, updatedAt = ? WHERE docId = ?"
      );
      stmt.run(aclJson, acl.version, acl.keyEpoch, now, docId);
    }
  }

  getDoc(docId: string): StoredDoc | undefined {
    const stmt = this.db.prepare("SELECT * FROM docs WHERE docId = ?");
    return stmt.get(docId) as StoredDoc | undefined;
  }

  deleteDoc(docId: string): void {
    this.db.prepare("DELETE FROM docs WHERE docId = ?").run(docId);
    this.db.prepare("DELETE FROM changes WHERE docId = ?").run(docId);
    this.db.prepare("DELETE FROM invites WHERE docId = ?").run(docId);
    this.db.prepare("DELETE FROM snapshots WHERE docId = ?").run(docId);
  }

  appendChange(
    docId: string,
    keyEpoch: number,
    nonce: string,
    ciphertext: string,
    signerKey: string,
    signature: string
  ): StoredChangeBatch {
    const maxSeqRow = this.db
      .prepare("SELECT MAX(seq) as maxSeq FROM changes WHERE docId = ?")
      .get(docId) as { maxSeq: number | null } | undefined;
    const nextSeq = (maxSeqRow?.maxSeq ?? 0) + 1;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(
      "INSERT INTO changes (docId, seq, keyEpoch, nonce, ciphertext, signerKey, signature, receivedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    stmt.run(docId, nextSeq, keyEpoch, nonce, ciphertext, signerKey, signature, now);

    return {
      seq: nextSeq,
      keyEpoch,
      nonce,
      ciphertext,
      signerKey,
      signature,
      receivedAt: now,
    };
  }

  getChanges(docId: string, afterSeq = 0, limit = 100): StoredChangeBatch[] {
    const stmt = this.db.prepare(
      "SELECT seq, keyEpoch, nonce, ciphertext, signerKey, signature, receivedAt FROM changes WHERE docId = ? AND seq > ? ORDER BY seq ASC LIMIT ?"
    );
    return stmt.all(docId, afterSeq, limit) as unknown as StoredChangeBatch[];
  }

  getDocTotalBytes(docId: string): number {
    const stmt = this.db.prepare(
      "SELECT SUM(LENGTH(ciphertext)) as totalBytes FROM changes WHERE docId = ?"
    );
    const row = stmt.get(docId) as { totalBytes: number | null } | undefined;
    return row?.totalBytes ?? 0;
  }

  saveSnapshot(
    docId: string,
    seq: number,
    keyEpoch: number,
    nonce: string,
    ciphertext: string,
    signerKey: string
  ): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO snapshots (docId, seq, keyEpoch, nonce, ciphertext, signerKey, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    stmt.run(docId, seq, keyEpoch, nonce, ciphertext, signerKey, now);
  }

  getSnapshot(docId: string): StoredSnapshot | undefined {
    const stmt = this.db.prepare("SELECT * FROM snapshots WHERE docId = ?");
    return stmt.get(docId) as StoredSnapshot | undefined;
  }

  createInvite(
    inviteId: string,
    docId: string,
    role: "contribute" | "view",
    expiresAt: string
  ): StoredInvite {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "INSERT INTO invites (inviteId, docId, role, expiresAt, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)"
    );
    stmt.run(inviteId, docId, role, expiresAt, "pending", now);
    return {
      inviteId,
      docId,
      role,
      expiresAt,
      status: "pending",
      createdAt: now,
    };
  }

  getInvite(inviteId: string): StoredInvite | undefined {
    const stmt = this.db.prepare("SELECT * FROM invites WHERE inviteId = ?");
    return stmt.get(inviteId) as StoredInvite | undefined;
  }

  acceptInvite(inviteId: string, inviteeKey: string, inviteeEncKey: string): void {
    const stmt = this.db.prepare(
      "UPDATE invites SET inviteeKey = ?, inviteeEncKey = ?, status = 'accepted' WHERE inviteId = ?"
    );
    stmt.run(inviteeKey, inviteeEncKey, inviteId);
  }

  setInviteKey(inviteId: string, sealedKey: string): void {
    const stmt = this.db.prepare(
      "UPDATE invites SET sealedKey = ?, status = 'fulfilled' WHERE inviteId = ?"
    );
    stmt.run(sealedKey, inviteId);
  }

  close(): void {
    this.db.close();
  }
}
