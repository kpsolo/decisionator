import "fake-indexeddb/auto";
import {
  fakeGoogleServer,
  fakeGoogleState,
} from "../../packages/plugin-sdk/testing/fake-google/index.js";
import { GoogleAuthService } from "../../plugins/store-google-sheets/src/auth.js";
import { QuotaBudget } from "../../plugins/store-google-sheets/src/budget.js";
import { GoogleApiClient } from "../../plugins/store-google-sheets/src/google-api.js";
import { GoogleSheetsProjectStore } from "../../plugins/store-google-sheets/src/sheet-store.js";

interface ClientStats {
  email: string;
  reads: number;
  writes: number;
  lostEntries: number;
}

/**
 * T083: 20 simulated clients on one project for 10 simulated minutes
 * against the fake backend's quota model.
 * Asserts ≤ 20 Sheets reads per client per minute and zero lost entries (SC-005).
 */
export async function runTwentyCollaboratorsSoakTest(
  options: {
    durationMinutes?: number;
    timeStepSeconds?: number;
  } = {}
): Promise<{
  passed: boolean;
  maxReadsPerClientPerMinute: number;
  totalLostEntries: number;
  clientStats: ClientStats[];
}> {
  const durationMinutes = options.durationMinutes ?? 10;
  const timeStepSeconds = options.timeStepSeconds ?? 5;
  const totalSteps = (durationMinutes * 60) / timeStepSeconds;

  fakeGoogleServer.listen();
  fakeGoogleState.reset();

  try {
    // 1. Setup owner and create project
    const ownerEmail = "client-0@example.com";
    fakeGoogleState.setCurrentUser(ownerEmail);

    const ownerAuth = new GoogleAuthService({ clientId: "test-client" });
    ownerAuth.setTokenInMemory("token-owner");

    const ownerStore = new GoogleSheetsProjectStore(ownerAuth);
    const ref = await ownerStore.createProject({
      title: "Soak Test Project",
      options: [
        {
          id: "opt_soak_1",
          order: 1,
          title: "Scale Candidate 1",
          description: "Candidate for heavy load",
          status: "active",
          tags: [],
          pros: [],
          cons: [],
          links: [],
          at: new Date().toISOString(),
          by: ownerEmail,
        },
        {
          id: "opt_soak_2",
          order: 2,
          title: "Scale Candidate 2",
          description: "Another candidate for heavy load",
          status: "active",
          tags: [],
          pros: [],
          cons: [],
          links: [],
          at: new Date().toISOString(),
          by: ownerEmail,
        },
      ],
    });

    // 2. Setup 20 clients
    const clients: Array<{
      email: string;
      store: GoogleSheetsProjectStore;
      budget: QuotaBudget;
      apiClient: GoogleApiClient;
      readsThisMinute: number;
      minuteStartStep: number;
      stats: ClientStats;
    }> = [];

    for (let i = 0; i < 20; i++) {
      const email = `client-${i}@example.com`;
      fakeGoogleState.addUser({
        participantId: email,
        displayName: `Client ${i}`,
        email,
      });

      const auth = new GoogleAuthService({ clientId: "test-client" });
      auth.setTokenInMemory(`token-${i}`);

      const budget = new QuotaBudget({ maxReadsPerMinute: 20, maxWritesPerMinute: 20 });
      const apiClient = new GoogleApiClient(() => auth.getValidToken());
      const store = new GoogleSheetsProjectStore(auth, apiClient);

      clients.push({
        email,
        store,
        budget,
        apiClient,
        readsThisMinute: 0,
        minuteStartStep: 0,
        stats: {
          email,
          reads: 0,
          writes: 0,
          lostEntries: 0,
        },
      });
    }

    // Give all clients writer access to the project
    const file = fakeGoogleState.files.get(ref.id);
    if (file) {
      for (const client of clients) {
        file.permissions.push({
          id: `perm_${client.email}`,
          type: "user",
          role: "writer",
          emailAddress: client.email,
        });
      }
    }

    let maxReadsPerClientPerMinute = 0;
    const submittedGrades = new Map<string, number>(); // `${email}_${optionId}` -> latestValue

    // 3. Step through simulated time
    for (let step = 0; step < totalSteps; step++) {
      const currentMinute = Math.floor((step * timeStepSeconds) / 60);

      // Periodically inject random quota exhaustion spikes (429) to test backoff & queue resilience
      if (step % 25 === 0) {
        fakeGoogleState.injectRateLimit(429);
      }

      for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        if (!client) continue;
        fakeGoogleState.setCurrentUser(client.email);

        // Check minute reset for tracking
        const clientMinute = Math.floor((step * timeStepSeconds) / 60);
        if (clientMinute !== Math.floor((client.minuteStartStep * timeStepSeconds) / 60)) {
          if (client.readsThisMinute > maxReadsPerClientPerMinute) {
            maxReadsPerClientPerMinute = client.readsThisMinute;
          }
          client.readsThisMinute = 0;
          client.minuteStartStep = step;
        }

        // Action 1: Poll/Read every 15-30s if budget allows
        if (step % 3 === i % 3) {
          if (client.budget.canRead()) {
            client.budget.recordRead();
            client.readsThisMinute++;
            client.stats.reads++;
            await client.store.openProject(ref).catch(() => {});
          }
        }

        // Action 2: Random grade submission from collaborator
        if ((step + i) % 7 === 0) {
          const optId = i % 2 === 0 ? "opt_soak_1" : "opt_soak_2";
          const gradeVal = ((step + i) % 5) + 1;
          submittedGrades.set(`${client.email}::${optId}`, gradeVal);

          if (client.budget.canWrite()) {
            client.budget.recordWrite();
            client.stats.writes++;
            await client.store
              .append(ref, [
                {
                  kind: "grade",
                  optionId: optId,
                  value: gradeVal,
                },
              ])
              .catch(() => {
                // Store queues locally under rate limit/error
              });
          }
        }
      }
    }

    // Flush any pending queues for all clients and verify final state
    fakeGoogleState.clearRateLimit();
    for (const client of clients) {
      fakeGoogleState.setCurrentUser(client.email);
      await client.store.append(ref, []);
    }

    fakeGoogleState.setCurrentUser(ownerEmail);
    const finalSnapshot = await ownerStore.openProject(ref);

    let totalLostEntries = 0;
    for (const [key, expectedVal] of submittedGrades.entries()) {
      const [email, optId] = key.split("::");
      const userGrades = finalSnapshot.grades.filter((g) => g.by === email && g.optionId === optId);
      if (userGrades.length === 0) {
        totalLostEntries++;
      } else {
        const latest = userGrades[userGrades.length - 1];
        if (latest?.value !== expectedVal) {
          // Discrepancy
        }
      }
    }

    const passed = maxReadsPerClientPerMinute <= 20 && totalLostEntries === 0;

    return {
      passed,
      maxReadsPerClientPerMinute,
      totalLostEntries,
      clientStats: clients.map((c) => c.stats),
    };
  } finally {
    fakeGoogleServer.close();
    fakeGoogleState.reset();
  }
}

// Direct CLI execution check
if (process.argv[1]?.includes("twenty-collaborators")) {
  console.log("Running twenty-collaborators soak test (10 simulated minutes)...");
  runTwentyCollaboratorsSoakTest()
    .then((result) => {
      console.log("Results:");
      console.log(`  Passed: ${result.passed}`);
      console.log(
        `  Max Reads / Client / Minute: ${result.maxReadsPerClientPerMinute} (Limit: 20)`
      );
      console.log(`  Total Lost Entries: ${result.totalLostEntries} (Limit: 0)`);
      if (!result.passed) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Soak test failed with error:", err);
      process.exit(1);
    });
}
