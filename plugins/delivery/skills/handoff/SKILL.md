---
description: Renamed — handing a sprint package to a runner is now /delivery:sprint --runner superpowers|generic. This alias is kept for one version.
argument-hint: "[runner]"
---

Renamed to `sprint --runner`: run `/delivery:sprint --runner $ARGUMENTS` (`superpowers` or `generic`). An existing package in `.delivery/sprints/` is reused, not rewritten.
