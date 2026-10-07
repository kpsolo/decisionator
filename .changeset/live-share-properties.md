---
"@decisionator/share-inpage": major
---

Live sessions speak protocol 3 (contract `live-share` 3.0.0). Guests can set their own person-scoped option properties with a new `property` guest entry; the host accepts it only for active options, with `scope: "person"` and a value of at most 2 KiB, and answers anything else with `invalid` ("That change is not allowed."). Each guest's snapshot carries shared property values and only that guest's own person values. Hosts and guests on protocol 2 are turned away with `protocol_mismatch`.
