// scripts/lib/doc-impact.js — docs ship with the change that makes them stale. The merge gate asks
// every pull request that changes what users see for one line in its description, at the start of a line:
//   Doc-impact: <the docs it updates>          and the pull request changes at least one doc file
//   Doc-impact: none (<why users see no change>)
// It is a line, not a guess from the diff, because only the author knows whether a code change alters
// what a README or quick start says; the gate makes the author say so, where the reviewer reads it.
// What users cannot see needs no line: tests, generated files and lockfiles, and the team's own records.
// A tool users run (scripts/testing/run-tests.js) is not a test, and a .txt is data unless it sits in docs/.
const fs = require('fs');
const path = require('path');
const { GENERATED } = require('./reviews.js');

const INTERNAL = /(?:^|\/)(?:\.(?:delivery|superpowers|github|beads)|tests?|__tests__|spec|fixtures)\/|\.(?:test|spec)\.[a-z0-9]+$|(?:^|\/)test_[^/]*\.py$/i;
const DOC = /(?:^|\/)docs?\/|\.(?:md|mdx|markdown|rst|adoc)$|(?:^|\/)(?:README|CHANGELOG|LICENSE|NOTICE)(?:\.[a-z]+)?$/i;
const LINE = /^[ \t>*-]*doc[- ]?impact[ \t]*:[ \t]*(.*)$/im;
const NONE = /^none\b[\s:,.;()–—-]*(.*)$/i;
// 8l1.4.1: a builder cannot edit a pull request's description (gh pr edit fails on this host, and the
// lane refuses body files and gh api writes), but gh pr comment works and leaves the reviewed head as
// it was, so the fix names the comment first; the description or a commit message counts too.
const fixFor = (pr) => `Add one line saying the doc impact as a comment on the pull request: gh pr comment ${pr || '<pr>'} --body 'Doc-impact: <the docs this pull request updates>' (and update them in it), or gh pr comment ${pr || '<pr>'} --body 'Doc-impact: none (<why users see no change>)'; a comment adds no commit, so a passing review still counts. The description or a commit message counts too`;

// every place the line can be said, in the order a later one overrides an earlier: the description,
// the commits in order, the comments in order
function sources(view) {
  const out = [String((view && view.body) || '')];
  for (const c of (view && Array.isArray(view.commits) ? view.commits : [])) out.push(`${(c && c.messageHeadline) || ''}\n${(c && c.messageBody) || ''}`);
  for (const c of (view && Array.isArray(view.comments) ? view.comments : [])) out.push(String((c && c.body) || ''));
  return out;
}
// the latest doc-impact line said anywhere, or null
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

// 8l1.4.1: when the gate first ran in this project. The gate applies the moment it installs, so a pull
// request already open then is warned, not refused (merge-gate.js). The first run writes the time, once
// (wx: a second writer keeps the first); a record that cannot be read or written gives no grace: null.
const SINCE = path.join('.delivery', 'reviews', 'doc-impact-since.json');
function since(root, now = new Date().toISOString()) {
  const file = path.join(root, SINCE);
  const read = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && Number.isFinite(Date.parse(j.since)) ? j.since : null; } catch (err) { return null; } };
  if (fs.existsSync(file)) return read();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ since: now })}\n`, { flag: 'wx' });
  } catch (err) { /* another writer was first, or the directory is not writable: read what is there */ }
  return read();
}
// true when the pull request was created before the gate first ran here
function openedBefore(view, at) {
  const c = Date.parse(view && view.createdAt);
  const s = Date.parse(at);
  return Number.isFinite(c) && Number.isFinite(s) && c < s;
}

module.exports = { check, userVisible, isDoc, since, openedBefore, SINCE };
