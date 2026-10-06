---
"@decisionator/share-inpage": minor
---

Live sessions now work across devices and browsers. The host tab answers guests over WebRTC data channels (star topology); connection offers are exchanged, AES-GCM-sealed under an opaque topic, through configurable Nostr relays and, for other tabs of the same browser, BroadcastChannel. Guest entries are validated by the host and recorded for each guest through delegated append, every submission is acknowledged, links carry a heartbeat with chunked framing, guests reconnect automatically, and each guest receives a redacted snapshot. Protocol v2 (contract `live-share` 2.0.0) replaces the BroadcastChannel-only v1; v1 join links no longer work. `InPageHostServer` and `InPagePeerClient` are replaced by `LiveShareHost`, `LiveShareGuest`, `startHosting` and `joinSession`.
