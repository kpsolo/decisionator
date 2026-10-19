---
"@decisionator/share-inpage": minor
"@decisionator/relay": patch
"@decisionator/web": patch
---

Harden live sessions and the relay:
- `@decisionator/share-inpage`: a data channel that closes from the remote side now closes its `RTCPeerConnection` too, so departing guests no longer leak connections on the host. A dial aborted or timed out during ICE gathering no longer starts re-sending its offer. The host keeps at most `MAX_PENDING_CONNECTIONS` (16, `RtcOptions.maxPendingConnections`) unopened connection attempts, drops them after 30 s, and re-answers a repeated offer at most once a second. `HostingSession.revoke(reason, { purgeRelays })` is now async: it disconnects guests, then publishes the tombstone (plus a best-effort NIP-09 deletion of the last snapshot) and waits for relays to confirm it, or for a timeout, before closing the relay sockets; `purgeRelays: false` skips the relay retraction. The new `publishTombstone()` does the same for a session that is not hosted right now. Replaceable relay records are dated strictly after the previous one from the same tab, so a tombstone can no longer tie with the last snapshot. Relay records are validated with `RelayPayloadSchema` (`parseRelayPayload`) before a guest applies them, and `LiveGuestState.hostKey` reports the pinned host key, including one learned on first use.
- `@decisionator/relay`: an invite can be accepted only once (`409` afterwards), so nobody holding an invite id can replace the invitee's keys. `POST /v1/docs/{docId}/snapshots` applies the batch size (`413`) and document storage (`507`) limits.
- `@decisionator/web`: hosting starts are de-duplicated (React StrictMode, double clicks) and a stop or revoke during a pending start can no longer leave a live host behind. Revoking honours "Purge public relay snapshot", also from the Sessions dashboard for sessions not hosted in this tab, and returning guests keep the host key learned on first use.
