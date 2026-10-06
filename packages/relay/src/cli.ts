#!/usr/bin/env node
import { startRelayServer } from "./server.js";

const port = Number.parseInt(process.env.PORT || "4179", 10);
const dbPath = process.env.DB_PATH || "relay.sqlite";

console.log(`Starting Decisionator Relay on port ${port} (database: ${dbPath})...`);
const service = await startRelayServer({ port, dbPath });
console.log(`Decisionator Relay listening at http://127.0.0.1:${service.port}`);
