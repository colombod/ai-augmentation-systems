// scripts/lib/surface.js — the customer surface of an initiative (R-09): where the customer actually
// uses the product, as a tuple a check can compare. .delivery/initiatives/<slug>/surface.json:
//   { "owner_record": "dec-...", "surfaces": [ { "id": "S1", "host": "...", "app": "...", "mode": "...",
//     "install_artifact": "...", "scriptable": false, "size_budgets": { "tool_list_max": 20 },
//     "test_account": "<name, never a password>", "version_on_screen": "<where the version shows>" } ] }
// Evidence from another surface, or from the same id with a different tuple, never counts.
const fs = require('fs');
const path = require('path');

const TUPLE = ['host', 'app', 'mode', 'install_artifact'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function surfaceFile(root, initiative) { return path.join(root, '.delivery', 'initiatives', initiative, 'surface.json'); }

// { problems, warnings } for a parsed surface.json
function validateSurface(doc) {
  const problems = [];
  const warnings = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.surfaces) || !doc.surfaces.length) {
    return { problems: ['surface.json: "surfaces" must be a non-empty list'], warnings };
  }
  const seen = new Set();
  for (const [i, s] of doc.surfaces.entries()) {
    const at = `surface.json: surfaces[${i}]`;
    if (!s || typeof s !== 'object') { problems.push(`${at} must be an object`); continue; }
    if (!ID.test(String(s.id || ''))) problems.push(`${at}: "id" must match ${ID}`);
    else if (seen.has(s.id)) problems.push(`${at}: duplicate id ${s.id}`);
    seen.add(s.id);
    for (const k of TUPLE) if (typeof s[k] !== 'string' || !s[k].trim()) problems.push(`${at}: "${k}" must be a non-empty string`);
    if (typeof s.scriptable !== 'boolean') problems.push(`${at}: "scriptable" must be true or false`);
    // optional, for the reality-check script (R-33): the test account's name (never a password) and
    // where the surface shows the installed version
    for (const k of ['test_account', 'version_on_screen']) if (s[k] !== undefined && (typeof s[k] !== 'string' || !s[k].trim())) problems.push(`${at}: "${k}" must be a non-empty string when given`);
    const b = s.size_budgets;
    if (b === undefined || (b && typeof b === 'object' && !Array.isArray(b) && !Object.keys(b).length)) warnings.push(`${at}: no size_budgets; state the host's limits as numbers (tool_list_max, answer_max_chars, page weight)`);
    else if (!b || typeof b !== 'object' || Array.isArray(b) || Object.values(b).some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) problems.push(`${at}: "size_budgets" must map names to non-negative numbers`);
  }
  if (!/^dec-/.test(String(doc.owner_record || ''))) warnings.push('surface.json: no owner_record; the surface is agreed with the owner and cites the record (dec-...)');
  return { problems, warnings };
}

// { doc, surfaces, problems, warnings, missing } — never throws
function loadSurface(root, initiative) {
  const file = surfaceFile(root, initiative);
  if (!fs.existsSync(file)) return { doc: null, surfaces: [], problems: [], warnings: [], missing: true };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return { doc: null, surfaces: [], problems: [`surface.json: not valid JSON (${err.message})`], warnings: [], missing: false }; }
  const v = validateSurface(doc);
  return { doc, surfaces: v.problems.length ? [] : doc.surfaces, ...v, missing: false };
}

const tupleOf = (s) => Object.fromEntries(TUPLE.map((k) => [k, s ? s[k] : undefined]));
const sameTuple = (a, b) => TUPLE.every((k) => String((a || {})[k] || '') === String((b || {})[k] || ''));
const describe = (s) => (s ? `${s.id} (${s.app}, ${s.mode}, on ${s.host})` : 'none');

module.exports = { surfaceFile, validateSurface, loadSurface, tupleOf, sameTuple, describe, TUPLE };
