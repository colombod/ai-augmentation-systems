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
    if (ch === '`') inCode = !inCode;
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
  let i = startIndex;
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (/^#{2,3}\s/.test(lines[i])) return { rows, end: i };
    i++;
  }
  let seenHeader = false;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const cells = splitCells(line);
    if (!seenHeader) { seenHeader = true; continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return { rows, end: i };
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
  const s = String(value).trim();
  if (!s || s === '[]') return [];
  const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
  return inner.split(',').map((x) => x.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
}

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
      phase: phaseNumber(meta.phase), dependsOn: listValue(meta.depends_on), size: String(meta.size || ''), file,
    });
  }
  return out;
}

function spikeKey(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseSpikes(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Spikes/i.test(l));
  if (start < 0) return [];
  const { rows } = tableRows(lines, start + 1);
  return rows.filter((c) => c[0]).map((c) => ({ key: spikeKey(c[0]), question: c[1] || '', timeBox: c[2] || '', blocks: c[3] || '' }));
}

module.exports = { phaseNumber, parseRoadmap, parseStories, parseSpikes, spikeKey, listValue };
