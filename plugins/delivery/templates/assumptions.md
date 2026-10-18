<!--
The assumption register (R-14): every claim the design rests on that nobody has yet seen hold, one row
each. /delivery:architecture writes it from its spike list; /delivery:challenge and /delivery:realign
read it. Rows are added with `assumptions.js add` and settled only with `assumptions.js observe|refute
<A-n> --evidence <ev-id>`, citing a probe in the real host: never a reading of the documentation, and a
twin only when it was built from a recording of real traffic. Keep the table's columns as they are; the
gates parse it.
-->

# Assumptions: <initiative>

**Kinds.** `external-host` (how a host we do not control behaves: what the ChatGPT app passes a tool,
how many tools it shows, what a manifest accepts), `platform` (our runtime, framework or store),
`data` (the shape or volume of real data), `customer` (what the customer will do or want),
`internal` (a design choice we can settle locally).

**Criteria.** `<story id>#<criterion number>`, space separated; a bare story id means every criterion.
A story whose criteria sit on an `external-host` assumption that is still `assumed` is not ready, and
its claim is refused until the spike for it has a result in the real host and the decision owner has
acknowledged it. A `refuted` one stops its stories and pauses their area until the design changes.

**Decision owner.** `DM`, `PM`, or `owner` when the answer decides scope.

## Register

| Id | Statement | Kind | Criteria | Status | Evidence | Decision owner |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
