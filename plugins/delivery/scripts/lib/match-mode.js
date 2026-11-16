// scripts/lib/match-mode.js — how a check step's `match` is read: as literal text or as a regular
// expression, decided when the step is refined and stored with it (match_mode), so refine and verify-run
// read it the same way.
//
// Three failed rows were script defects, not product defects: a match written as text with regex
// characters in it ('Kicked: 1 (a message)', '... (a refined touch leaves no file)') was read as a
// pattern, the parentheses became a group, and the run's real line never matched; another match
// ('incident') named text the step's output never prints. Each raised the andon and stopped an area.
// So a new match is literal unless the refine says --regex, a match holding regex characters is refused
// until the refine says which it is, and --sample proves it matches the output it is meant for.
//
// Steps stored before this carry no mode, and most of them are real patterns (\d+, [\s\S]*, lookaheads),
// so reading them as text would fail them: a step with no mode passes when its text is found as written
// or its pattern matches. It can no longer fail on regex characters, and its pattern still works.
const MODES = ['literal', 'regex'];
const SPECIAL = /[\\^$.*+?()[\]{}|]/g;
const escapeRegex = (s) => String(s).replace(SPECIAL, '\\$&');
const specials = (s) => [...new Set(String(s).match(SPECIAL) || [])];

function pattern(match) {
  try { return new RegExp(match); } catch (err) { return null; }
}

// Whether text shows the match, read in its mode.
function matches(match, mode, text) {
  const t = String(text == null ? '' : text);
  if (mode === 'literal') return t.includes(match);
  if (mode === 'regex') { const re = pattern(match); return !!re && re.test(t); }
  if (t.includes(match)) return true;
  const re = pattern(match);
  return !!re && re.test(t);
}

// How a refine reads a new match: { mode } or { problem }. regex and literal are the refine's flags;
// sample, when given, is output the match must be found in.
function choose(match, { regex = false, literal = false, sample } = {}) {
  const m = String(match);
  if (regex && literal) return { problem: '--regex and --literal both given: a match is one or the other' };
  let mode = 'literal';
  if (regex) {
    try { new RegExp(m); } catch (err) { return { problem: `--match is not a valid regular expression (${err.message})` }; }
    mode = 'regex';
  } else if (!literal && specials(m).length) {
    return { problem: `--match "${m}" holds regex characters (${specials(m).join(' ')}): it is matched as literal text by default. Say which it is: add --literal to match it as written, or --regex with the pattern; as a pattern for the same text it is "${escapeRegex(m)}"` };
  }
  if (sample !== undefined && !matches(m, mode, sample)) {
    return { problem: `--match "${m}" (${mode}) is not found in --sample: the run would fail on that output. Copy the line the step prints, or fix the match` };
  }
  return { mode };
}

// One line for the refine's output and the run's capture.
const describe = (match, mode) => (mode === 'regex' ? `match (regex): /${match}/` : mode === 'literal' ? `match (literal): ${match}` : `match (stored before modes, text or pattern): ${match}`);

module.exports = { MODES, escapeRegex, specials, matches, choose, describe };
