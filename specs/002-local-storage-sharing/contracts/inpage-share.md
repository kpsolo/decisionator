# Contract: In-Page Sharing & Local Peer Coordinator — v1.0.0

Plugin ID: `org.decisionator.share.inpage`

## Capabilities & Constraints

1. **Host-as-Server**:
   - The owner's browser tab acts as the in-page session host.
   - Host generates a random session identifier and temporary join URL (`#join=p2p:<sessionId>`) with QR code.
2. **WebRTC DataChannel Transport**:
   - Direct peer-to-peer data channel between guest browser and host browser.
   - No project data or ballots pass through intermediate cloud databases.
3. **BroadcastChannel Local Transport**:
   - When host and guests run on the same browser/device (multi-tab testing), exchanges occur via browser `BroadcastChannel` with zero network overhead.
4. **Lifecycle**:
   - Host receives peer ballots (`Entry[]`), appends them to host's active project store (File or Database), and broadcasts new `ProjectSnapshot` to all connected peers.
   - When host closes the tab, a `HOST_CLOSING` message is dispatched, allowing peers to retain a local export of the session.
