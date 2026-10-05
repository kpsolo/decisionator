# Deci

An open-source, modular **decision-making engine**.

**Live App**: [https://kpsolo.github.io/decisionator/](https://kpsolo.github.io/decisionator/)

Paste a list of ideas, let your own AI assistant turn it into structured options, then grade, comment, and vote on them together. Share a project with a single link, like a Google Doc. Each project lives in your own Google Drive; there is no Deci account, database, or server.

---

## How It Works (3 Steps)

1. **Paste & Format**: Paste a raw list of ideas or use the ready-made instruction prompt with your favorite AI chat assistant (Claude, Gemini, ChatGPT). Format and preview options before saving.
2. **Grade & Discuss**: Save directly to your personal Google Drive as a structured Google Sheet. Rate options 1–5, discuss in Markdown comment threads, and share contribute or view links with collaborators (optionally protected with AES-256 encryption).
3. **Vote & Decide**: Contributors drag and drop their top-N ballots. The owner closes voting to run a deterministic Borda count tally with full audit trails and one-click outcome verification ("Reproduced ✓").

---

## Key Features

- **Zero Server Footprint**: Runs 100% in the browser. Zero telemetry, zero external database servers.
- **Drive-Native Storage**: Uses per-file `drive.file` OAuth scope. Your data stays in your personal Google Sheets.
- **End-to-End Encryption**: Optional passphrase encryption using PBKDF2 (600,000 iterations) and AES-256-GCM.
- **Resilient & Offline-Ready**: Client-side write queue in IndexedDB with exponential backoff and quota monitoring.
- **Accessible & Tested**: Zero WCAG 2.1 AA violations across all screens (audited via Axe). 100% monorepo test pass rate.
- **Extensible Architecture**: Public contracts for Project Stores, Decision Strategies, and Idea Sources via `@decisionator/plugin-sdk`.

---

## Documentation & Guides

- [Self-Hosting Guide](docs/self-hosting.md): Configure your own Google Cloud OAuth Web Client and API key.
- [Plugin Authoring Guide](docs/plugin-authors.md): Build custom storage backends, decision strategies, or idea sources.
- [Release Notes (v0.1.0)](docs/releases/v0.1.md): Summary of MVP release metrics, performance, and staged compliance.
- [Specification & Architecture](specs/001-decision-engine-core/spec.md): Complete requirements, data model, and contracts.

---

## Repository Layout

```text
apps/
└── web/                             # React 19 + TypeScript SPA (@decisionator/web)
packages/
├── core/                            # Isomorphic domain core, crypto, RNG, format & voting models
└── plugin-sdk/                      # Extension point contracts & compliance test kits
plugins/
├── source-paste/                    # Paste & plain-list / AI JSON candidate source
├── store-google-sheets/             # Google Drive & Sheets storage adapter with queue & crypto
└── strategy-borda/                  # Deterministic Borda ranking strategy
examples/
├── plugin-store-memory/             # In-memory ProjectStore implementation & tests
├── plugin-strategy-example/         # Custom StrategyPlugin example & tests
└── plugin-source-example/           # Custom IdeaSourcePlugin example & tests
```

---

## Development

```bash
# Install dependencies
pnpm install

# Run local development server
pnpm --filter @decisionator/web dev

# Run unit and contract tests
pnpm test

# Run linter and formatting checks
pnpm lint

# Run type checking across all workspace packages
pnpm typecheck
```

---

## License

[MIT](LICENSE)
