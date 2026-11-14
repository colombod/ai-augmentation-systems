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
// 8l1.4.1: a builder cannot edit a pull request's description (gh pr edit fails on this host, and the
// lane refuses body files and gh api writes), but gh pr comment works and leaves the reviewed head as
// it was, so the fix names the comment first; the description or a commit message counts too.
const fixFor = (pr) => `Add one line saying the doc impact as a comment on the pull request: gh pr comment ${pr || '<pr>'} --body 'Doc-impact: <the docs this pull request updates>' (and update them in it), or gh pr comment ${pr || '<pr>'} --body 'Doc-impact: none (<why users see no change>)'; a comment adds no commit, so a passing review still counts. The description or a commit message counts too`;

// rv-201: the product repository is public, so anyone can comment on a pull request. A comment counts
// only from the pull request's author (every role session posts as the owner's account) or from someone
// GitHub lists as the repository's owner, a member or a collaborator; a stranger's comment can neither
// clear a refusal nor block a good pull request. The description and the commits are the author's own.
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
function trustedComment(view, c) {
  if (!c) return false;
  if (TRUSTED.has(String(c.authorAssociation || '').toUpperCase())) return true;
  const by = c.author && c.author.login;
  const owner = view && view.author && view.author.login;
  return Boolean(by && owner && String(by).toLowerCase() === String(owner).toLowerCase());
}
// every place the line can be said: the description first, then the commits and the trusted comments in
// the order they were made (committedDate, createdAt), so a newer commit or comment overrides an older
// one and the description. One with no readable time sorts before every dated one, in list order.
function sources(view) {
  const at = (x) => { const t = Date.parse(x); return Number.isFinite(t) ? t : -1; };
  const later = [];
  (view && Array.isArray(view.commits) ? view.commits : []).forEach((c, i) => later.push({ t: at(c && (c.committedDate || c.authoredDate)), i, text: `${(c && c.messageHeadline) || ''}\n${(c && c.messageBody) || ''}` }));
  (view && Array.isArray(view.comments) ? view.comments : []).forEach((c, i) => { if (trustedComment(view, c)) later.push({ t: at(c.createdAt), i: 1e6 + i, text: String(c.body || '') }); });
  later.sort((a, b) => a.t - b.t || a.i - b.i);
  return [String((view && view.body) || ''), ...later.map((x) => x.text)];
}
// the doc-impact line said last, or null
function latestLine(view) {
  let found = null;
  for (const text of sources(view)) {
    const all = [...String(text).matchAll(new RegExp(LINE.source, 'gim'))];
    if (all.length) found = all[all.length - 1];
  }
  return found;
}

const userVisible = (p) => !INTERNAL.test(p) && !GENERATED.test(p);
const isDoc = (p) => DOC.test(p);

// { ok, why?, fix?, warning? }
function check(view, { pr } = {}) {
  const FIX = fixFor(pr);
  const files = Array.isArray(view && view.files) ? view.files.map((x) => String(x.path || '')).filter(Boolean) : null;
  if (!files || !files.length) return { ok: true, warning: 'doc impact not checked: the pull request\'s files could not be read' };
  const visible = files.filter(userVisible);
  const code = visible.filter((p) => !isDoc(p));
  if (!code.length) return { ok: true };
  const m = latestLine(view);
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

// 8l1.4.1, rv-201: a pull request opened before the gate shipped is warned, not refused (merge-gate.js).
// The bound is the release that added the gate (its pull request merged at this time), kept here in code:
// a record on disk could be deleted (and rewritten at the next run, granting the grace to everything
// open) or forged with a far-future date. Only pull requests created before it qualify, a set that can
// only shrink, so the grace ends by itself.
const GATE_SHIPPED = '2026-11-10T16:21:51Z';
// true when the pull request was created before the gate shipped; no creation time, no grace
function openedBefore(view, at = GATE_SHIPPED) {
  const c = Date.parse(view && view.createdAt);
  const s = Date.parse(at);
  return Number.isFinite(c) && Number.isFinite(s) && c < s;
}

module.exports = { check, userVisible, isDoc, openedBefore, trustedComment, GATE_SHIPPED };
