# claim-guard

Adversarial claim-verification gate for changesets — a Claude Code port of
[amplifier-bundle-claim-guard](https://github.com/colombod/amplifier-bundle-claim-guard)'s
static gate. Harvests every claim a change makes (explicit and implicit), tries to
prove each false against the shipped source via a bench of adversarial lens agents,
and emits a claim-verification matrix plus a deterministic
BLOCK / PASS / INDETERMINATE verdict.

Under construction — see `docs/superpowers/specs/2026-08-27-claim-guard-plugin-design.md`.
