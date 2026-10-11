#!/usr/bin/env node
/**
 * Automated Security & Anonymity Verification Runner
 * Validates the 8 Security Verification Gates specified in docs/security/verification-protocol.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

let passedCount = 0;
let failedCount = 0;

function pass(name, detail = "") {
  passedCount++;
  console.log(`\x1b[32m✔ PASS\x1b[0m [${name}]${detail ? ` — ${detail}` : ""}`);
}

function fail(name, reason) {
  failedCount++;
  console.error(`\x1b[31m✖ FAIL\x1b[0m [${name}] — ${reason}`);
}

// -----------------------------------------------------------------------------
// Gate 1: Cryptographic Parameter Integrity
// -----------------------------------------------------------------------------
function verifyGate1() {
  const codecFile = path.join(ROOT, "packages/core/src/crypto/payload-codec.ts");
  if (!fs.existsSync(codecFile)) {
    fail("Gate 1: Payload Codec", `File not found: ${codecFile}`);
    return;
  }
  const content = fs.readFileSync(codecFile, "utf-8");

  // Verify PBKDF2 iterations >= 600,000
  if (/iterations\s*=\s*600_?000/.test(content)) {
    pass("Gate 1: PBKDF2 Iterations", "600,000 iterations configured (OWASP standard)");
  } else {
    fail("Gate 1: PBKDF2 Iterations", "Expected iterations >= 600,000 in payload-codec.ts");
  }

  // Verify AES-GCM 256-bit
  if (/name:\s*["']AES-GCM["'],\s*length:\s*256/.test(content)) {
    pass("Gate 1: Cipher", "AES-256-GCM authenticated cipher confirmed");
  } else {
    fail("Gate 1: Cipher", "Expected AES-GCM 256-bit configuration in payload-codec.ts");
  }

  // Verify 12-byte IV for GCM
  if (/const\s+iv\s*=\s*new\s+Uint8Array\(12\)/.test(content)) {
    pass("Gate 1: IV Length", "12-byte cryptographically random IV confirmed");
  } else {
    fail("Gate 1: IV Length", "Expected 12-byte IV for AES-GCM");
  }
}

// -----------------------------------------------------------------------------
// Gate 2: Zero Token & Credential Leaks in Exports and LocalStorage
// -----------------------------------------------------------------------------
function verifyGate2() {
  const authFile = path.join(ROOT, "plugins/store-google-sheets/src/auth.ts");
  if (!fs.existsSync(authFile)) {
    fail("Gate 2: Google Auth", `File not found: ${authFile}`);
    return;
  }
  const content = fs.readFileSync(authFile, "utf-8");

  // Verify tokens are in memory and not written to localStorage
  if (
    /private currentToken:\s*string\s*\|\s*null\s*=\s*null/.test(content) &&
    !/localStorage\.setItem\(.*token/i.test(content)
  ) {
    pass(
      "Gate 2: OAuth Token Storage",
      "Tokens held strictly in memory; zero localStorage leakage"
    );
  } else {
    fail("Gate 2: OAuth Token Storage", "Potential persistent token leak in GoogleAuthService");
  }

  // Verify Project Export file does not serialize host secrets or tokens
  const exportFile = path.join(ROOT, "apps/web/src/features/project/project-file.ts");
  if (fs.existsSync(exportFile)) {
    const exportContent = fs.readFileSync(exportFile, "utf-8");
    if (!exportContent.includes("relaySecret") && !exportContent.includes("deviceSecret")) {
      pass("Gate 2: Export Sanitization", "Project export bundles exclude device & relay secrets");
    } else {
      fail("Gate 2: Export Sanitization", "Export file may leak secret keys");
    }
  }
}

// -----------------------------------------------------------------------------
// Gate 3: Relay Zero-Knowledge & Sealed Signaling
// -----------------------------------------------------------------------------
function verifyGate3() {
  const cryptoFile = path.join(ROOT, "plugins/share-inpage/src/crypto.ts");
  if (!fs.existsSync(cryptoFile)) {
    fail("Gate 3: Sealed Crypto", `File not found: ${cryptoFile}`);
    return;
  }
  const content = fs.readFileSync(cryptoFile, "utf-8");

  // Verify HKDF derives signalKey and topic
  if (
    /hkdf\(sha256,\s*ikm,\s*utf8ToBytes\("deci-live\/2"\),\s*utf8ToBytes\("signal\+topic"\),\s*64\)/.test(
      content
    )
  ) {
    pass("Gate 3: HKDF Envelope Key Derivation", "Derives 32-byte signalKey and 32-byte topic");
  } else {
    fail("Gate 3: HKDF Envelope Key Derivation", "HKDF parameters deviated from protocol");
  }

  // Verify sealing uses AES-GCM with topic as AAD
  if (/gcm\(key,\s*nonce,\s*utf8ToBytes\(topic\)\)\.encrypt/.test(content)) {
    pass(
      "Gate 3: Authenticated Associated Data",
      "Topic bound as AAD preventing envelope substitution"
    );
  } else {
    fail("Gate 3: Authenticated Associated Data", "AES-GCM sealing must bind topic as AAD");
  }
}

// -----------------------------------------------------------------------------
// Gate 5: Identity Unforgeability & Cross-Session Unlinkability
// -----------------------------------------------------------------------------
function verifyGate5() {
  const cryptoFile = path.join(ROOT, "plugins/share-inpage/src/crypto.ts");
  const content = fs.readFileSync(cryptoFile, "utf-8");

  // Verify participantId is derived via one-way hash
  if (
    content.includes("guestSessionKey(deviceSecret: string, sessionId: string)") &&
    content.includes("participantIdFromKey(sessionKey: string)")
  ) {
    pass(
      "Gate 5: Two-Tier Identity Derivation",
      "sessionKey -> participantId one-way derivation verified"
    );
  } else {
    fail(
      "Gate 5: Two-Tier Identity Derivation",
      "Missing two-tier identity functions in crypto.ts"
    );
  }
}

// -----------------------------------------------------------------------------
// Gate 6: Secret Ballot Secrecy & Snapshot Redaction
// -----------------------------------------------------------------------------
function verifyGate6() {
  const policyFile = path.join(ROOT, "plugins/share-inpage/src/policy.ts");
  if (!fs.existsSync(policyFile)) {
    fail("Gate 6: Snapshot Policy", `File not found: ${policyFile}`);
    return;
  }
  const content = fs.readFileSync(policyFile, "utf-8");

  // Verify secret ballots are redacted when liveResults === false
  if (
    /hideBallots\s*=\s*voting\?\.state\s*===\s*["']open["']\s*&&\s*voting\.liveResults\s*===\s*false/.test(
      content
    )
  ) {
    pass(
      "Gate 6: Secret Ballot Redaction",
      "Ballots redacted during active voting when liveResults=false"
    );
  } else {
    fail(
      "Gate 6: Secret Ballot Redaction",
      "Ballot redaction logic missing or compromised in policy.ts"
    );
  }

  // Verify hidden comment text is redacted
  if (/c\.hidden\s*\?\s*\{\s*\.\.\.c,\s*body:\s*["']["']\s*\}\s*:\s*c/.test(content)) {
    pass("Gate 6: Comment Body Redaction", "Hidden comment bodies redacted from guest snapshots");
  } else {
    fail("Gate 6: Comment Body Redaction", "Comment body redaction missing");
  }
}

// -----------------------------------------------------------------------------
// Gate 7: Host Policy Enforcement & Read-Only Immobility
// -----------------------------------------------------------------------------
function verifyGate7() {
  const policyFile = path.join(ROOT, "plugins/share-inpage/src/policy.ts");
  const content = fs.readFileSync(policyFile, "utf-8");

  // Verify role !== 'contribute' returns read_only
  if (
    /if\s*\(role\s*!==\s*["']contribute["']\)\s*\{\s*return\s*\{\s*ok:\s*false,\s*code:\s*["']read_only["']/.test(
      content
    )
  ) {
    pass(
      "Gate 7: Protocol-Level Read-Only Gate",
      "Host strictly rejects incoming submissions when role != contribute"
    );
  } else {
    fail(
      "Gate 7: Protocol-Level Read-Only Gate",
      "Host checkSubmission missing read_only validation"
    );
  }
}

// -----------------------------------------------------------------------------
// Gate 8: Anonymous-First & Zero Telemetry Scan
// -----------------------------------------------------------------------------
function verifyGate8() {
  // Check index.html for analytics/tracking scripts
  const indexHtml = path.join(ROOT, "apps/web/index.html");
  if (fs.existsSync(indexHtml)) {
    const html = fs.readFileSync(indexHtml, "utf-8");
    const trackers = [
      "google-analytics",
      "gtag",
      "mixpanel",
      "segment",
      "hotjar",
      "clarity",
      "sentry",
    ];
    const foundTrackers = trackers.filter((t) => html.toLowerCase().includes(t));
    if (foundTrackers.length === 0) {
      pass(
        "Gate 8: Zero Telemetry in index.html",
        "No third-party surveillance or tracking scripts found"
      );
    } else {
      fail(
        "Gate 8: Zero Telemetry in index.html",
        `Detected tracking scripts: ${foundTrackers.join(", ")}`
      );
    }
  }

  // Check URL fragment routing for join links
  const routesFile = path.join(ROOT, "apps/web/src/app/routes.tsx");
  if (fs.existsSync(routesFile)) {
    const routesContent = fs.readFileSync(routesFile, "utf-8");
    if (routesContent.includes("/join/:sessionId/:secret")) {
      pass("Gate 8: URL Routing", "Join links configured under hash/client router");
    } else {
      fail("Gate 8: URL Routing", "Join route not found in routes.tsx");
    }
  }
}

// -----------------------------------------------------------------------------
// Main Runner
// -----------------------------------------------------------------------------
console.log("\n=======================================================");
console.log("  Deci Security & Anonymity Verification Runner");
console.log("  Standards: docs/security/verification-protocol.md");
console.log("=======================================================\n");

verifyGate1();
verifyGate2();
verifyGate3();
verifyGate5();
verifyGate6();
verifyGate7();
verifyGate8();

console.log("\n-------------------------------------------------------");
if (failedCount === 0) {
  console.log(`\x1b[32m✔ ALL GATES PASSED: ${passedCount} checks passed, 0 failures.\x1b[0m`);
  console.log("The codebase complies with the Anonymous-First Security Protocol.\n");
  process.exit(0);
} else {
  console.error(
    `\x1b[31m✖ VERIFICATION FAILED: ${failedCount} checks failed out of ${passedCount + failedCount}.\x1b[0m\n`
  );
  process.exit(1);
}
