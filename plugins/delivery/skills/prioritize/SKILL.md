---
description: Renamed — MVP staging is now step 6 of /delivery:prd; run /delivery:prd --stage to re-stage an existing PRD. This alias is kept for one version.
disable-model-invocation: true
argument-hint: "[initiative]"
---

Renamed to `prd --stage`: run `/delivery:prd --stage $ARGUMENTS`. It still writes `.delivery/initiatives/<initiative>/prioritization.md`; the real-cost pass stays in `/delivery:roadmap`.
