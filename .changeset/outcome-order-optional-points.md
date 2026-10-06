---
"@decisionator/core": patch
---

Outcome order items no longer require `points` / `firstPlaces`. Only ranked (Borda) strategies produce them; random, weighted and owner-pick outcomes list option ids alone, as the strategy contract allows. Exporting a project that contained such an outcome used to throw.
