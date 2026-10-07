# Deci

An open-source, modular **decision-making engine**.

**Live App**: [https://kpsolo.github.io/decisionator/](https://kpsolo.github.io/decisionator/)

Paste a list of ideas, let your own AI assistant turn it into structured options, then grade, comment, and vote on them together. Share a project with a single link, like a Google Doc. Each project lives in your own Google Drive or local device; there is no Deci account, database, or server.

---

## Quick Testing & Public Deployment Guide

Deci operates directly in the browser as a client-side single-page app and uses your Google Cloud project credentials for Drive & Sheets sync. Follow either approach below to test:

### Option 1: Test Locally (Quickest)

1. **Get Google Cloud Credentials** (5 minutes):
   - In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable:
     - **Google Drive API**
     - **Google Sheets API**
     - **Google Picker API**
   - Under **APIs & Services → OAuth consent screen**, select **External**, fill in the app name (`Deci`) and email, and add scope `https://www.googleapis.com/auth/drive.file` (*non-sensitive, requires no Google verification*).
   - Under **Credentials → Create Credentials → OAuth client ID**, select **Web application**, add `http://localhost:5173` to **Authorized JavaScript origins**, and copy the **Client ID**.
   - Under **Credentials → Create Credentials → API key**, restrict the key to **Google Picker API**, and copy the **API Key**.

2. **Configure Environment**:
   Create `apps/web/.env.local`:
   ```env
   VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   VITE_GOOGLE_API_KEY=your-picker-api-key
   VITE_BASE_URL=http://localhost:5173/
   ```

3. **Start the Dev Server**:
   ```bash
   pnpm install
   pnpm --filter @decisionator/web dev
   ```
   Open `http://localhost:5173` in your browser.

---

### Option 2: Deploy Publicly to GitHub Pages

The repository contains an automated GitHub Actions deployment workflow ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)).

1. **Add JavaScript Origin in Google Cloud**:
   - In your OAuth Web Client ID settings (Google Cloud Console), add:
     ```text
     https://kpsolo.github.io
     ```
     to **Authorized JavaScript origins**.

2. **Configure GitHub Repository Variables**:
   - Go to your repository on GitHub: `https://github.com/kpsolo/decisionator`
   - Navigate to **Settings → Secrets and variables → Actions → Variables tab**.
   - Add the following Repository Variables:
     - `VITE_GOOGLE_CLIENT_ID`: Your Google OAuth Client ID
     - `VITE_GOOGLE_API_KEY`: Your Google Picker API Key
     - `VITE_BASE_URL`: `https://kpsolo.github.io/decisionator/`

3. **Enable GitHub Pages**:
   - Go to **Settings → Pages**.
   - Under **Build and deployment → Source**, choose **GitHub Actions**.

4. **Deploy**:
   - Push or merge changes into the `main` branch:
     ```bash
     git checkout main
     git merge 001-decision-engine-core
     git push origin main
     ```
   - GitHub Actions will build and deploy the app to `https://kpsolo.github.io/decisionator/`.
   - You can also manually trigger a run under **Actions → Deploy to GitHub Pages → Run workflow**.

---

### Step-by-Step Test Scenarios

Once open locally or at the public GitHub Pages URL:

1. **Create a Project**:
   - Click **New project**.
   - Paste 4–5 sample ideas (e.g. list of features or restaurants).
   - Choose **Use as plain list** or format using your preferred AI assistant.
   - Click **Create project** and sign in with Google.
   - A new Google Sheet named after your project will appear in your Google Drive.
2. **Grade & Comment**:
   - Set 1–5 star ratings on options.
   - Post Markdown comments.
   - Switch to **Stats** to view averages, vote counts, and category distributions.
3. **Share & Collaborate**:
   - Click **Share → Anyone with the link can contribute → Copy link** (optionally set a passphrase for client-side AES-256 encryption).
   - Open that URL in an incognito window or second browser profile.
   - Confirm file access via the Google Picker prompt.
   - Submit grades and comments from the second profile; observe updates sync to the owner.
4. **Ranked Voting**:
   - Click **Voting → Open (top 3, live results on)**.
   - Drag and drop options to rank your ballot.
   - Click **Close voting** to calculate the deterministic Borda count result.
   - Click **Verify** to confirm reproducibility ("Reproduced ✓").
5. **Export & Restore** ([docs/project-export.md](docs/project-export.md)):
   - On **Results**, decide with a ranking system (Borda, weighted, random, owner pick); decide again with another one to change the ranking in force.
   - Project menu **⋯ → Export Project (JSON)** or **Export Project (Excel / Google Sheets)** downloads options, grades, ballots, comments, outcomes and contributions.
   - On the home page, **Open from File…** with the `.json` or `.xlsx` file restores the project (votes stay under their original authors; outcomes still verify).

---

## Key Features

- **Zero Server Footprint**: Runs 100% in the browser. Zero telemetry, zero external database servers.
- **Drive-Native Storage**: Uses per-file `drive.file` OAuth scope. Your data stays in your personal Google Sheets.
- **Local-First & Encrypted Relay**: Fully operational offline via Automerge 3 and IndexedDB, plus an optional self-hostable, end-to-end encrypted sync relay service (`packages/relay`).
- **End-to-End Encryption**: Optional passphrase encryption using PBKDF2 (600,000 iterations) and AES-256-GCM.
- **Connected AI & Agent API**: Built-in MCP (Model Context Protocol) and REST API endpoints (`packages/node`) with 256-bit token grants and rate limiting.
- **Sandboxed Plugin Runtime**: Sandboxed iframe host with CSP and JSON Schema forms for third-party strategies, sources (Google Docs), and stores.
- **Accessible & Tested**: Zero WCAG 2.1 AA violations across all screens (audited via Axe). 100% test pass rate across unit, contract, and integration suites.

---

## Repository Layout

```text
apps/
└── web/                             # React 19 + TypeScript SPA (@decisionator/web)
packages/
├── core/                            # Isomorphic domain core, crypto, RNG, format & voting models
├── plugin-sdk/                      # Extension point contracts & compliance test kits
├── node/                            # Companion local daemon with MCP & REST agent API
└── relay/                           # E2E encrypted sync relay & agent WebSocket tunnel
plugins/
├── share-inpage/                    # Live sessions: tab-hosted WebRTC voting across devices
├── source-paste/                    # Paste & plain-list / AI JSON candidate source
├── source-google-docs/              # Google Docs idea source with Google Picker integration
├── store-file/                      # Local-first direct file storage (.decisionator.json)
├── store-firestore/                 # Firebase Firestore real-time cloud storage with WebCrypto
├── store-google-sheets/             # Google Drive & Sheets storage adapter with queue & crypto
├── store-local/                     # Local-first ProjectStore backed by Automerge 3 & IndexedDB
├── strategy-borda/                  # Deterministic Borda ranking strategy
├── strategy-owner-pick/             # Owner manual pick strategy
├── strategy-random/                 # Seeded uniform random strategy
└── strategy-weighted/               # Grade-weighted lottery strategy
examples/
├── plugin-store-memory/             # In-memory ProjectStore implementation & tests
├── plugin-strategy-example/         # Custom StrategyPlugin example & tests
└── plugin-source-example/           # Custom IdeaSourcePlugin example & tests
```

---

## Documentation & Guides

- [Self-Hosting Guide](docs/self-hosting.md): In-depth setup for Google Cloud projects and static hosts.
- [Plugin Authoring Guide](docs/plugin-authors.md): Build custom storage backends, decision strategies, or idea sources.
- [Release Notes (v0.1.0)](docs/releases/v0.1.md): Summary of MVP release metrics, performance, and staged compliance.
- [Specification & Architecture](specs/001-decision-engine-core/spec.md): Complete requirements, data model, and contracts.

---

## Development

```bash
# Install dependencies
pnpm install

# Run local development server
pnpm --filter @decisionator/web dev

# Run all test suites across the monorepo
pnpm test

# Run linter and formatting checks
pnpm biome check .

# Run type checking across all workspace packages
pnpm typecheck
```

---

## License

[MIT](LICENSE)
