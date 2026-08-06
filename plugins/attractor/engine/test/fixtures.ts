// Shared fixtures used by more than one test file. Deliberately not named
// *.test.ts -- node --test's default discovery would otherwise treat it as
// its own test file (harmless, since it registers no tests, but avoid the
// ambiguity) -- and more importantly, this lets it be imported without
// re-executing another file's top-level test() registrations.

// Lints as an ERROR (TOPO-004: `orphan` is unreachable) but would otherwise
// execute cleanly: start -> a -> done, exit 0. That gap is what makes a test
// using this fixture discriminate: a fresh graph that fails for an unrelated
// structural reason (e.g. missing start node) would pass even with the lint
// gate deleted.
export const LINT_FAILS_BUT_WOULD_RUN = `
digraph LR {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  a [shape=parallelogram, tool_command="printf ok"]
  orphan [shape=box, prompt="never reached"]
  start -> a -> done
}
`
