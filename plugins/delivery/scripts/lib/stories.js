// scripts/lib/stories.js — the only writer of story files (stories/*.md in the project's plan folder)
// and of their index.
//
// The gates read a story as a recipe: an item in angle brackets is a template leftover they skip, and
// a criterion with no probe has nothing to check it, and nobody heard about either until the gate ran.
// So each change is checked when it is made, with the gates' own parser (gates.js parseStory), and a
// bad value is refused with its field named and the file left byte for byte as it was: a whole draft
// (checkDraft) before a story exists, then a field, a criterion or a section at a time. Each splice
// leaves every other line alone, so the other criteria keep their hashes and their evidence rows.
// The lane refuses every hand write of these files.
const fs = require('fs');
const path = require('path');
const G = require('./gates.js');
const { withLock } = require('./lock.js');

const KEYS = ['id', 'title', 'status', 'epic', 'supersedes', 'superseded_by', 'superseded_reason', 'phase', 'requirements', 'depends_on', 'size', 'surface', 'area', 'wave', 'reuses', 'fixes', 'finding', 'model'];
const STATUS = ['draft', 'ready', 'in-progress', 'done', 'superseded'];
const SIZES = ['S', 'M', 'L'];
const LISTS = ['supersedes', 'superseded_by', 'requirements', 'depends_on', 'reuses'];
const REQUIRED = ['id', 'title', 'status'];
const PLACEHOLDER = /<[^>\n]+>/;
const ITEM = /^(?:\d+[.)]|[-*](?:\s*\[[ xX]\])?)\s+(.*)$/;
const PROBE = /^\s+(?:[-*]\s+)?probe:\s*(.*)$/i;
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'story.md');

const dirOf = (root) => path.join(root, '.delivery', 'stories');
const fail = (field, why) => ({ field, why });
const outsideCode = (s) => String(s).replace(/`[^`\n]*`/g, '');

// The value a frontmatter line carries, validated and written as-is: there is no "# comment" convention on
// a real value, so a trailing "# ..." is part of the value and must pass the field's own rule (rv-225: a
// value was validated with the comment stripped but written whole, so `done # later` slipped through).
const bare = (v) => String(v == null ? '' : v).trim();
function valueProblem(key, raw) {
  const v = bare(raw);
  if (!KEYS.includes(key)) return `is not a story field (fields: ${KEYS.join(', ')})`;
  if (/[\r\n]/.test(String(raw))) return 'is one line';
  if (PLACEHOLDER.test(v)) return `holds a template placeholder in angle brackets (${PLACEHOLDER.exec(v)[0]})`;
  if (REQUIRED.includes(key) && !v) return 'is empty';
  if (key === 'id' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) return `is "${v}"; an id is letters, digits, dots and dashes`;
  if (key === 'status' && !STATUS.includes(v)) return `is "${v}"; a status is ${STATUS.join(', ')}`;
  if (key === 'size' && v && !SIZES.includes(v)) return `is "${v}"; a size is S, M or L (split a larger story)`;
  if (key === 'wave' && v && !/^[1-9]\d*$/.test(v)) return `is "${v}"; a wave is a whole number from 1`;
  if (LISTS.includes(key) && v && !/^\[[^\]]*\]$/.test(v)) return `is "${v}"; a list is written [a, b]`;
  return null;
}

// { start, end, lines } of the frontmatter block (lines between the --- fences), or null. A leading HTML
// comment before the fence is skipped, as gates.js parseStory does (it strips /^<!--...-->\s*/), so the
// 16 real stories that open with one are read, not refused (plan-sync writes their status through here).
function frontmatter(text) {
  const lines = String(text).split('\n');
  let open = 0;
  if (/^\s*<!--/.test(lines[0] || '')) {
    const close = lines.findIndex((l) => /-->/.test(l));
    if (close < 0) return null;
    open = lines.slice(close + 1).findIndex((l) => l.trim() !== '');
    open = open < 0 ? lines.length : close + 1 + open;
  }
  if (!/^---\r?$/.test(lines[open] || '')) return null;
  const end = lines.findIndex((l, i) => i > open && /^---\r?$/.test(l));
  return end > 0 ? { start: open + 1, end, lines } : null;
}

// The first frontmatter line that breaks the contract, as { field, why }, or null
function frontmatterProblem(text) {
  const fm = frontmatter(text);
  if (!fm) return fail('frontmatter', 'is missing: a story starts with a --- block of fields');
  const seen = new Set();
  for (let i = fm.start; i < fm.end; i++) {
    const line = fm.lines[i].replace(/\r$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!kv) return fail(`frontmatter line ${i + 1}`, `is "${line}", not "field: value"`);
    const why = valueProblem(kv[1], kv[2]);
    if (why) return fail(kv[1], why);
    seen.add(kv[1]);
  }
  const missing = REQUIRED.find((k) => !seen.has(k));
  return missing ? fail(missing, 'is missing') : null;
}

// One criterion as the command takes it: its text and its probe line.
function criterionProblem(n, text, probe) {
  const t = String(text || '').trim();
  const p = String(probe || '').trim();
  const f = `criterion ${n}`;
  if (!t) return fail(f, 'is empty');
  if (/[\r\n]/.test(t) || /[\r\n]/.test(p)) return fail(f, 'is one line of text and one probe line');
  if (PLACEHOLDER.test(outsideCode(t))) return fail(f, `holds text in angle brackets (${PLACEHOLDER.exec(outsideCode(t))[0]}), a template placeholder the ready gate never counts; put a command's argument in a code span`);
  if (!p) return fail(`${f} probe`, 'is missing: every criterion has one (what is observed; where: the surface id; by: test or reality-check)');
  if (PLACEHOLDER.test(outsideCode(p))) return fail(`${f} probe`, `holds a template placeholder in angle brackets (${PLACEHOLDER.exec(outsideCode(p))[0]})`);
  const pr = G.parseStory(`## Acceptance criteria\n\n1. x\n   - Probe: ${p}\n`).criteria[0].probe;
  if (!pr.where) return fail(`${f} probe`, 'names no "where:" (the surface id it is observed on)');
  if (!pr.by) return fail(`${f} probe`, 'names no "by: test" or "by: reality-check"');
  return null;
}

// The Acceptance criteria section's items: [{ from, to, text, probe }] as line indexes into lines
// (to exclusive): the item line and the indented lines under it, which the gates read as its text
// and probe. A blank line or an unindented line ends an item.
function criteriaBlocks(lines) {
  const at = lines.findIndex((l) => /^##\s+acceptance criteria\s*$/i.test(l.replace(/\r$/, '')));
  if (at < 0) return null;
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const blocks = [];
  for (let i = at + 1; i < end; i++) {
    const m = ITEM.exec(lines[i].replace(/\r$/, ''));
    if (!m) continue;
    let j = i + 1;
    while (j < end && /^\s+\S/.test(lines[j]) && !ITEM.test(lines[j])) j++;
    const probeLine = lines.slice(i + 1, j).map((l) => PROBE.exec(l.replace(/\r$/, ''))).find(Boolean);
    blocks.push({ from: i, to: j, text: [m[1], ...lines.slice(i + 1, j).filter((l) => !PROBE.test(l)).map((l) => l.trim())].join(' ').trim(), probe: probeLine ? probeLine[1] : '' });
    i = j - 1;
  }
  return { at, end, blocks };
}

// The first field a whole draft gets wrong, or null: the frontmatter, then each criterion in order.
function checkDraft(text) {
  const fp = frontmatterProblem(text);
  if (fp) return fp;
  const c = criteriaBlocks(String(text).split('\n'));
  if (!c || !c.blocks.length) return fail('acceptance criteria', 'has no criterion: a story has a ## Acceptance criteria section with at least one numbered criterion and its probe');
  for (let n = 0; n < c.blocks.length; n++) {
    const why = criterionProblem(n + 1, c.blocks[n].text, c.blocks[n].probe);
    if (why) return why;
  }
  // the gates' own read must agree: every item a criterion that counts
  const s = G.parseStory(text);
  if (s.criteria.length !== c.blocks.length) return fail('acceptance criteria', `has ${c.blocks.length} items, but the ready gate counts ${s.criteria.length}`);
  return null;
}

// Set one frontmatter field (the line is added when the story has none). { text } or { field, why }.
function setField(text, key, value) {
  const why = valueProblem(key, value);
  if (why) return fail(key, why);
  const fm = frontmatter(text);
  if (!fm) return fail('frontmatter', 'is missing');
  const lines = fm.lines.slice();
  const i = lines.findIndex((l, n) => n >= fm.start && n < fm.end && l.startsWith(`${key}:`));
  const v = String(value).trim();
  // write exactly the validated value; any old trailing text (a stale "# ..." or "PR #12") is replaced,
  // never carried past the new value (rv-225)
  if (i >= 0) {
    const cr = /\r$/.test(lines[i]) ? '\r' : '';
    lines[i] = `${key}:${v ? ` ${v}` : ''}${cr}`;
  } else lines.splice(fm.end, 0, `${key}:${v ? ` ${v}` : ''}`);
  return { text: lines.join('\n') };
}

// Replace criterion n, or add it as the next one (n = count + 1). Only its own lines change.
function setCriterion(text, n, crit, probe) {
  const lines = String(text).split('\n');
  const c = criteriaBlocks(lines);
  if (!c) return fail('acceptance criteria', 'is not a section of this story');
  const count = c.blocks.length;
  if (!Number.isInteger(n) || n < 1 || n > count + 1) return fail('criterion', `is ${n}; this story has ${count} (replace 1 to ${count}, or add ${count + 1})`);
  const why = criterionProblem(n, crit, probe);
  if (why) return why;
  const block = [`${n}. ${String(crit).trim()}`, `   - Probe: ${String(probe).trim()}`];
  if (n <= count) lines.splice(c.blocks[n - 1].from, c.blocks[n - 1].to - c.blocks[n - 1].from, ...block);
  else lines.splice(count ? c.blocks[count - 1].to : c.at + 1, 0, ...(count ? block : ['', ...block]));
  const out = lines.join('\n');
  const s = G.parseStory(out);
  if (s.criteria.length !== Math.max(count, n) || G.criterionHash(s.criteria[n - 1]) !== G.criterionHash({ text: crit })) return fail(`criterion ${n}`, 'would not be read by the ready gate as written');
  return { text: out };
}

// A heading's name: the text before any ":" or "(", lower-cased ("Context: where ..." is Context).
const headingKey = (h) => String(h).replace(/^#+\s*/, '').split(/[:(]/)[0].trim().toLowerCase().replace(/[’]/g, "'");
let templateKeys = null;
function allowedHeadings() {
  if (!templateKeys) { const t = fs.readFileSync(TEMPLATE, 'utf8').split('\n'); templateKeys = headingLines(t).map((i) => headingKey(t[i])); }
  return templateKeys;
}

// The indexes of `## ` heading lines, skipping any inside a ``` or ~~~ code fence: a fenced "## x" is
// body text, not a heading (rv-225). A fence opens on a line starting with three or more backticks or
// tildes and closes on the next line starting with that same marker.
function headingLines(lines) {
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    const marker = (/^\s*(`{3,}|~{3,})/.exec(l) || [])[1] || null;
    if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null; continue; }
    if (marker) { fence = marker; continue; }
    if (/^##\s/.test(l)) out.push(i);
  }
  return out;
}
// true when the body holds a level-1 or level-2 heading outside any code fence (a section body uses ###)
function bodyHasTopHeading(body) {
  let fence = null;
  for (const raw of String(body).split('\n')) {
    const l = raw.replace(/\r$/, '');
    const marker = (/^\s*(`{3,}|~{3,})/.exec(l) || [])[1] || null;
    if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null; continue; }
    if (marker) { fence = marker; continue; }
    if (/^#{1,2}\s/.test(l)) return true;
  }
  return false;
}

// Write a prose section by heading. The heading may be a template one or one already in the story; a
// genuinely new free-text heading needs { allowNew } (so a typo is caught, but a deliberate section like
// "Design answers" can be added). Fence-aware: a "## x" inside a code fence is not a heading, so a fenced
// section is found and replaced whole, not left with its old tail. A rewrite whose body is the section's
// current inter-heading text reproduces the file byte for byte (the body is written verbatim, with no
// reflow), so re-applying a section does not churn it.
function setSection(text, heading, body, { allowNew = false } = {}) {
  const h = String(heading || '').replace(/^#+\s*/, '').trim();
  const key = headingKey(h);
  const order = allowedHeadings();
  if (!h || /[\r\n]/.test(h)) return fail('heading', 'is one line of text');
  if (key === 'acceptance criteria') return fail('heading', 'Acceptance criteria changes one criterion at a time: `stories.js criterion`');
  const b = String(body == null ? '' : body);
  if (bodyHasTopHeading(b)) return fail('body', 'holds a # or ## heading line; a section body uses ### for its own headings (a fenced ## is fine)');
  const lines = String(text).split('\n');
  const heads = headingLines(lines);
  const next = (i) => heads.find((x) => x > i) ?? lines.length;
  const here = heads.find((i) => headingKey(lines[i]) === key);
  if (here === undefined && !order.includes(key) && !allowNew) {
    return fail('heading', `"${h}" is not a heading of the story and not a template heading; add it with --new (or fix the spelling). Template headings: ${order.join(', ')}`);
  }
  if (here !== undefined) {
    // replace the section whole, keeping the heading line; the body is written verbatim between it and the
    // next heading, so the same body round-trips to the same bytes
    lines.splice(here, next(here) - here, `## ${h}`, ...b.split('\n'));
  } else {
    const block = [`## ${h}`, '', ...(b ? [...b.split('\n'), ''] : [''])];
    const later = heads.find((i) => order.indexOf(headingKey(lines[i])) > order.indexOf(key) && order.indexOf(headingKey(lines[i])) >= 0);
    if (order.includes(key) && later !== undefined) lines.splice(later, 0, ...block);
    else lines.push(...(lines[lines.length - 1] === '' ? [] : ['']), ...block);
  }
  return { text: lines.join('\n') };
}

// The generated story index is retired (ADR-004): stories.js no longer writes .delivery/stories/README.md
// on a new story or a status change. The command writes only the one story file it changes.

// One read, check and write under the stories lock: fn(text) returns { text } or { field, why }.
// Nothing is written on a refusal. The write is through a temp file in the same directory and an atomic
// rename, so a crash mid-write never leaves a half-written story (rv-225). Returns { written: [rel] }.
function change(root, file, fn, { create = false } = {}) {
  const name = path.basename(String(file));
  const abs = path.join(dirOf(root), name);
  fs.mkdirSync(dirOf(root), { recursive: true });
  return withLock(path.join(dirOf(root), '.lock'), () => {
    const exists = fs.existsSync(abs);
    if (create && exists) return fail('file', `${name} already exists`);
    if (!create && !exists) return fail('story', `no story file ${name}`);
    const r = fn(create ? '' : fs.readFileSync(abs, 'utf8'));
    if (r.field) return r;
    const tmp = path.join(dirOf(root), `.${name}.${process.pid}.tmp`);
    try { fs.writeFileSync(tmp, r.text); fs.renameSync(tmp, abs); } finally { try { fs.unlinkSync(tmp); } catch (err) { /* already renamed */ } }
    return { written: [path.join('.delivery', 'stories', name)] };
  }, { strict: true, waitMs: 1500 });
}

// The status a script moves (plan-sync after a merge): checked and written, no index.
function setStatus(root, file, status) {
  return change(root, file, (text) => setField(text, 'status', status));
}

module.exports = { KEYS, STATUS, checkDraft, valueProblem, frontmatterProblem, criterionProblem, criteriaBlocks, setField, setCriterion, setSection, headingKey, allowedHeadings, change, setStatus, dirOf };
