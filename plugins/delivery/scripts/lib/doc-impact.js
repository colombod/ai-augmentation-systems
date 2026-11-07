// scripts/lib/doc-impact.js — docs ship with the change that makes them stale. The merge gate asks
// every pull request that changes what users see for one line in its description, at the start of a line:
//   Doc-impact: <the docs it updates>          and the pull request changes at least one doc file
//   Doc-impact: none (<why users see no change>)
// It is a line, not a guess from the diff, because only the author knows whether a code change alters
// what a README or quick start says; the gate makes the author say so, where the reviewer reads it.
// What users cannot see needs no line: tests, generated files and lockfiles, and the team's own records.
// A tool users run (scripts/testing/run-tests.js) is not a test, and a .txt is data unless it sits in docs/.
const { GENERATED } = require('./reviews.js');

const INTERNAL = /(?:^|\/)(?:\.(?:delivery|superpowers|github|beads)|tests?|__tests__|spec|fixtures)\/|\.(?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]*\.py$/i;
const DOC = /(?:^|\/)docs?\/|\.(?:md|mdx|markdown|rst|adoc)$|(?:^|\/)(?:README|CHANGELOG|LICENSE|NOTICE)(?:\.[a-z]+)?$/i;
const LINE = /^[ \t>*-]*doc[- ]?impact[ \t]*:[ \t]*(.*)$/im;
const NONE = /^none\b[\s:,.;()–—-]*(.*)$/i;
const FIX = 'Add one line to the pull request\'s description: `Doc-impact: <the docs this pull request updates>` (and update them in it), or `Doc-impact: none (<why users see no change>)`';

const userVisible = (p) => !INTERNAL.test(p) && !GENERATED.test(p);
const isDoc = (p) => DOC.test(p);

// { ok, why?, fix?, warning? }
function check(view) {
  const files = Array.isArray(view && view.files) ? view.files.map((x) => String(x.path || '')).filter(Boolean) : null;
  if (!files || !files.length) return { ok: true, warning: 'doc impact not checked: the pull request\'s files could not be read' };
  const visible = files.filter(userVisible);
  const code = visible.filter((p) => !isDoc(p));
  if (!code.length) return { ok: true };
  const m = LINE.exec(String((view && view.body) || ''));
  const shown = code.slice(0, 3).join(', ') + (code.length > 3 ? ` and ${code.length - 3} more` : '');
  if (!m) return { ok: false, why: `it changes what users see (${shown}) and its description has no doc-impact line`, fix: FIX };
  const said = m[1].trim();
  const none = NONE.exec(said);
  if (none) {
    if (none[1].replace(/[()\s.]/g, '').length < 3) return { ok: false, why: 'its doc-impact line says none without a reason', fix: FIX };
    return { ok: true };
  }
  if (!said) return { ok: false, why: 'its doc-impact line is empty', fix: FIX };
  if (!visible.some(isDoc)) return { ok: false, why: `its doc-impact line names docs ("${said.slice(0, 80)}") but changes no doc file`, fix: 'Update those docs in this pull request, or say `Doc-impact: none (<why users see no change>)`' };
  return { ok: true };
}

module.exports = { check, userVisible, isDoc };
