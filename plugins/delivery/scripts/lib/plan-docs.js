// scripts/lib/plan-docs.js — parse roadmap, stories and architecture spikes. Pure.
const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./compose-brief.js');

function phaseNumber(text) {
  const m = /phase\s+(\d+[a-z]?)/i.exec(text || '');
  return m ? m[1].toLowerCase() : null;
}

function splitCells(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') {
      // Only open a code span when a closing backtick exists later in the row;
      // an unmatched backtick is literal text and must not swallow later pipes.
      if (inCode || body.indexOf('`', i + 1) !== -1) inCode = !inCode;
    }
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function tableRows(lines, startIndex) {
  // Returns the cells of the first markdown table starting at or after startIndex,
  // skipping the header and separator rows. Stops at the first non-table line after the table began.
  const rows = [];
  let header = [];
  let i = startIndex;
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (/^#{2,3}\s/.test(lines[i])) return { rows, header, end: i };
    i++;
  }
  let seenHeader = false;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const cells = splitCells(line);
    if (!seenHeader) { seenHeader = true; header = cells; continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return { rows, header, end: i };
}

function parseRoadmap(markdown) {
  const lines = markdown.split(/\r?\n/);
  const phases = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^###\s+Phase\s+(\d+[a-z]?)\s*:\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    let name = m[2].trim();
    const done = /\(done\)/i.test(name);
    name = name.replace(/\s*\(done\)\s*/i, '').trim();
    const items = [];
    let j = i + 1;
    while (j < lines.length && !/^###\s+Phase\s/i.test(lines[j]) && !/^##\s/.test(lines[j])) {
      if (/^\|\s*Work item/i.test(lines[j])) {
        const { rows } = tableRows(lines, j);
        for (const cells of rows) {
          if (!cells[0]) continue;
          items.push({ title: cells[0], size: cells[1] || '', confidence: cells[2] || '', dependsOn: cells[3] || '' });
        }
        break;
      }
      j++;
    }
    phases.push({ number: m[1].toLowerCase(), name, done, items });
  }
  return { phases };
}

function listValue(value) {
  if (value === undefined || value === null) return [];
  // an inline comment is not a value: `reuses: [] # existing code` is empty (Copilot 644)
  const s = String(value).replace(/\s+#.*$/, '').trim();
  if (!s || s === '[]') return [];
  const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  return inner.split(',').map((x) => x.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
}

// a frontmatter value without its trailing comment or a <placeholder>
const plain = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+#.*$/, '').replace(/<[^>]*>/g, '').trim();

function parseStories(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const file = path.join(dir, name);
    const text = fs.readFileSync(file, 'utf8');
    const stripped = text.replace(/^<!--[\s\S]*?-->\s*/, '');
    const { meta } = parseFrontmatter(stripped);
    if (!meta.id) continue;
    out.push({
      id: String(meta.id), title: String(meta.title || meta.id), status: String(meta.status || ''), epic: String(meta.epic || ''),
      phase: phaseNumber(meta.phase), dependsOn: listValue(meta.depends_on), size: String(meta.size || ''), model: String(meta.model || '').trim(), file,
      surface: plain(meta.surface), area: plain(meta.area), wave: plain(meta.wave),
    });
  }
  return out;
}

function spikeKey(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The spike gate's fields (R-16) are read by header, so an older four-column table (# | question |
// time box | blocks) still parses by position.
const SPIKE_COLS = { question: [/question|^q$/i, 1], decision: [/decision (?:it )?inform|^decision$/i, -1], decisionRule: [/rule/i, -1],
  decisionOwner: [/owner/i, -1], timeBox: [/time|box/i, 2], blocks: [/^blocks/i, 3], assumption: [/assumption/i, -1] };
function parseSpikes(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Spikes/i.test(l));
  if (start < 0) return [];
  const { rows, header } = tableRows(lines, start + 1);
  const at = {};
  for (const [k, [re, pos]] of Object.entries(SPIKE_COLS)) {
    const i = header.findIndex((h, n) => n > 0 && re.test(h));
    at[k] = i > 0 ? i : (header.length === 4 ? pos : -1);
  }
  const cell = (c, k) => (at[k] > 0 ? (c[at[k]] || '').trim() : '');
  return rows.filter((c) => c[0]).map((c) => {
    const sp = { key: spikeKey(c[0]), question: cell(c, 'question'), timeBox: cell(c, 'timeBox'), blocks: cell(c, 'blocks') };
    for (const k of ['decision', 'decisionRule', 'decisionOwner', 'assumption']) if (cell(c, k)) sp[k] = cell(c, k);
    return sp;
  });
}

module.exports = { phaseNumber, parseRoadmap, parseStories, parseSpikes, spikeKey, listValue, splitCells, tableRows };
