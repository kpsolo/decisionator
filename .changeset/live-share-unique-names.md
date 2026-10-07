---
"@decisionator/share-inpage": minor
"@decisionator/web": patch
---

Live sessions give guests who pick the same name distinct names ("Gina", "Gina 2"), kept across reconnects and returned in `welcome.name` (contract `live-share` 2.1.0, wire protocol unchanged); `LiveShareGuest` state now carries `name`. Links keep messages that arrive before a listener is attached, so a guest turned away from a full session is told "This session is full." instead of retrying. The guest page says goodbye when its tab closes, so the host's list of connected people updates at once.
