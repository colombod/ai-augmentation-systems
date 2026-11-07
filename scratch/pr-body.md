Refs delivery-plugin-planning-8l1.3.4.1.1

A team.json role entry can now carry `permissions: [{allow, record}]`. `prepare-role.js` writes each rule into `permissions.allow` of every instance of that role, but only while its record verifies as the owner's word (via the gate context's owner-record check):

- A rule whose record does not verify, or rests on no owner words, is refused and named; nothing is written for it.
- A sidecar (`.claude/.delivery-managed-allow.json`) tracks the rules prepare-role wrote, so a rule is taken out again once its record stops verifying; the user's own allow rules are never touched.
- `manifest.js` refuses a permissions entry without an `allow` string and a `dec-`/`ans-` record id.
- `docs/reference.md` documents the field. Version 0.43.77.

Tests: three new `8l1.3.4.1.1:` tests in `prepare-role.test.js`; four mutants (no verify, no write, no take-out, no validation) each fail their test. Sealed suite on this head: 1501 tests, 1500 pass, 0 fail, 1 skip.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
