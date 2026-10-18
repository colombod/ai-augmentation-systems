// scripts/lib/judge.js — the typed judge: ask a catalogued question about a small state, get a typed answer.
//
// Advisory evidence, never the proof: a gate decides, the judge informs it. Off unless the manifest
// has a `judge` block naming a provider AND the key variable it names is set in the environment.
// The state sent is the question's declared fields only; a declared field that looks like a secret,
// token, credential, id, email, URL or path (or matches the leak guard's denylist) refuses the call
// locally. Calls time out (2 s default) and fail open: ask() never throws and never logs the key or
// the state; each call is one advisory line in .delivery/judge/<date>.ndjson with a sha256 of the
// state sent, not the state itself.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const CATALOGUE_FILE = path.join(__dirname, '..', '..', 'judge', 'questions.json');
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULTS = { provider: 'none', model: 'jev-latest', key_env: 'TYPESAFE_API_KEY', block_threshold: 0.8, warn_threshold: 0.5 };
const PROVIDERS = new Set(['typesafe', 'none']);
const KNOWN_KEYS = new Set([...Object.keys(DEFAULTS), 'endpoint']);
const MAX_STATE_CHARS = 16000;

function loadCatalogue(file = CATALOGUE_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// the endpoint override exists for tests and local gateways only: loopback, or the provider's own host
function endpointOk(u) {
  try {
    const x = new URL(u);
    if (x.href === TYPESAFE_URL) return true;
    return (x.protocol === 'http:' || x.protocol === 'https:') && ['127.0.0.1', 'localhost', '[::1]'].includes(x.hostname);
  } catch (err) { return false; }
}

// { problems, warnings } for a manifest's `judge` block (undefined is fine: the judge is off)
function configProblems(j) {
  const problems = [];
  const warnings = [];
  if (j === undefined || j === null) return { problems, warnings };
  if (typeof j !== 'object' || Array.isArray(j)) return { problems: ['team.json: "judge" must be an object'], warnings };
  for (const k of Object.keys(j)) if (!KNOWN_KEYS.has(k)) warnings.push(`team.json: judge key "${k}" is not known and is ignored`);
  if (j.provider !== undefined && !PROVIDERS.has(j.provider)) problems.push(`team.json: judge provider "${j.provider}", expected one of ${[...PROVIDERS].join(', ')}`);
  if (j.model !== undefined && (typeof j.model !== 'string' || !j.model.trim())) problems.push('team.json: judge model must be a non-empty string');
  if (j.key_env !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(String(j.key_env))) problems.push('team.json: judge key_env must name an environment variable (A-Z, 0-9, _)');
  for (const k of ['block_threshold', 'warn_threshold']) {
    if (j[k] !== undefined && !(typeof j[k] === 'number' && j[k] >= 0 && j[k] <= 1)) problems.push(`team.json: judge ${k} must be a number from 0 to 1`);
  }
  const b = j.block_threshold === undefined ? DEFAULTS.block_threshold : j.block_threshold;
  const w = j.warn_threshold === undefined ? DEFAULTS.warn_threshold : j.warn_threshold;
  if (typeof b === 'number' && typeof w === 'number' && w > b) problems.push('team.json: judge warn_threshold must not exceed block_threshold');
  if (j.endpoint !== undefined && !endpointOk(j.endpoint)) problems.push('team.json: judge endpoint must be the provider\'s own URL or a loopback address');
  return { problems, warnings };
}

// The effective configuration. enabled only when the block is present and valid, the provider is not
// none, and the key variable is set. The key itself is never part of the result.
function judgeConfig(team, env = process.env) {
  const j = team && team.judge;
  const cfg = { ...DEFAULTS, ...(j && typeof j === 'object' && !Array.isArray(j) ? j : {}) };
  cfg.endpoint = cfg.endpoint || TYPESAFE_URL;
  let reason = null;
  if (!j) reason = 'judge_not_configured';
  else if (configProblems(j).problems.length) reason = 'judge_config_invalid';
  else if (cfg.provider === 'none') reason = 'provider_none';
  else if (!env[cfg.key_env]) reason = 'no_key';
  return { ...cfg, enabled: !reason, reason };
}

// ---- the state filter ----
const CHECKS = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['token', /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*)/],
  ['token', /\bbearer\s+[\w.~+/-]{12,}/i],
  ['credential', /\b(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*\S{4,}/i],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['url', /\b[a-z][a-z0-9+.-]*:\/\/\S+/i],
  ['id', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['path', /(?:^|[\s"'(=:])(?:~[\\/]\S|\/(?:[\w.@-]+\/)+[\w.@-]*|[A-Za-z]:\\\S)/],
];
// a long opaque run with letters and digits is a key, a hash or a token
const OPAQUE = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

function stringsOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.push(k); stringsOf(x, out); });
  else if (v !== undefined && v !== null) out.push(String(v));
  return out;
}

function secretKind(value, denylist) {
  for (const s of stringsOf(value)) {
    for (const [kind, re] of CHECKS) if (re.test(s)) return kind;
    for (const m of s.match(OPAQUE) || []) if (/\d/.test(m) && /[A-Za-z]/.test(m)) return 'opaque';
    const low = s.toLowerCase();
    if ((denylist || []).some((d) => d && low.includes(String(d).toLowerCase()))) return 'denylist';
  }
  return null;
}

// { state, dropped, filtered, missing }: only declared fields pass; a declared field that looks
// sensitive is withheld and named (field and kind, never the value).
function filterState(question, state, { denylist } = {}) {
  const declared = (question && question.state) || [];
  const src = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const out = {};
  const filtered = [];
  for (const f of declared) {
    if (src[f] === undefined) continue;
    const kind = secretKind(src[f], denylist);
    if (kind) filtered.push({ field: f, kind });
    else out[f] = src[f];
  }
  return {
    state: out,
    dropped: Object.keys(src).filter((k) => !declared.includes(k)),
    filtered,
    missing: declared.filter((f) => out[f] === undefined),
  };
}

function loadDenylist(projectRoot) {
  if (!projectRoot) return [];
  try {
    return fs.readFileSync(path.join(projectRoot, '.delivery', 'team', 'denylist.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch (err) { return []; }
}

// ---- providers ----
function post(url, body, headers, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let req;
    const timer = setTimeout(() => { finish({ failure: 'timeout' }); try { req.destroy(); } catch (e) { /* gone */ } }, timeoutMs);
    try {
      const u = new URL(url);
      req = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (text.length < 1e6) text += c; });
        res.on('end', () => finish({ status: res.statusCode, text }));
        res.on('error', () => finish({ failure: 'network' }));
      });
      req.on('error', () => finish({ failure: 'network' }));
      req.end(body);
    } catch (err) { finish({ failure: 'network' }); }
  });
}

// A provider: ask({ id, question, state, cfg, key, timeoutMs }) -> { answer, p?, confidence?, probabilities?, model, usage } | { error, reason, status? }
const providerImpls = {
  none: { async ask() { return { error: true, reason: 'provider_none' }; } },
  typesafe: {
    async ask({ id, question, state, cfg, key, timeoutMs }) {
      const q = question.type === 'choice'
        ? { type: 'choice', instructions: question.instructions, criteria: question.criteria }
        : { type: 'noul', instructions: question.instructions };
      const r = await post(cfg.endpoint, JSON.stringify({ model: cfg.model, state, questions: { [id]: q } }), { Authorization: `Bearer ${key}` }, timeoutMs);
      if (r.failure) return { error: true, reason: r.failure };
      if (r.status !== 200) return { error: true, reason: `http_${r.status}`, status: r.status };
      let json;
      try { json = JSON.parse(r.text); } catch (err) { return { error: true, reason: 'bad_response' }; }
      const a = json && json.answers && json.answers[id];
      const usage = (json && json.usage) || {};
      const model = (json && json.model) || null;
      if (a && a.type === 'noul' && typeof a.noul === 'number') return { answer: a.noul >= 0.5 ? 'yes' : 'no', p: a.noul, model, usage };
      if (a && a.type === 'choice' && typeof a.choice === 'string') return { answer: a.choice, confidence: a.confidence, probabilities: a.probabilities, model, usage };
      return { error: true, reason: 'bad_response' };
    },
  },
};

// ---- the log ----
function logDirOf(projectRoot) { return projectRoot ? path.join(projectRoot, '.delivery', 'judge') : null; }
const today = (now) => (now || new Date().toISOString()).slice(0, 10);

function writeLog(dir, entry) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ig = path.join(dir, '.gitignore');
    if (!fs.existsSync(ig)) fs.writeFileSync(ig, '*\n');
    fs.appendFileSync(path.join(dir, `${today(entry.time)}.ndjson`), `${JSON.stringify(entry)}\n`);
  } catch (err) { /* the log is best effort */ }
}

function readLog(dir) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).sort(); } catch (err) { return out; }
  for (const f of files) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch (err) { /* a torn line is skipped */ }
    }
  }
  return out;
}

// ---- ask ----
// opts: { config (judgeConfig result) | team, env, timeoutMs, projectRoot, logDir, gate, logExtra, catalogue, denylist }
async function ask(questionId, state, opts = {}) {
  let base = { question: questionId, version: null };
  try {
    const env = opts.env || process.env;
    const cfg = opts.config || judgeConfig(opts.team, env);
    const cat = opts.catalogue || loadCatalogue();
    const question = cat.questions && Object.prototype.hasOwnProperty.call(cat.questions, questionId) ? cat.questions[questionId] : null;
    if (!question) return { ...base, skipped: true, reason: 'unknown_question' };
    base = { question: questionId, version: question.version || null };
    if (!cfg.enabled) return { ...base, skipped: true, reason: cfg.reason || 'judge_off' };
    const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 2000;
    const f = filterState(question, state, { denylist: opts.denylist || loadDenylist(opts.projectRoot) });
    const sent = JSON.stringify(f.state);
    const entry = {
      time: new Date().toISOString(), advisory: true, question: questionId, version: base.version, catalogue: cat.version || null,
      gate: opts.gate || 'cli', provider: cfg.provider, state_sha256: crypto.createHash('sha256').update(sent).digest('hex'),
      dropped: f.dropped, filtered: f.filtered, ...(opts.logExtra || {}),
    };
    const dir = opts.logDir || logDirOf(opts.projectRoot);
    const extra = { ...(f.filtered.length ? { filtered: f.filtered } : {}), ...(f.dropped.length ? { dropped: f.dropped } : {}) };
    let local = null;
    if (f.filtered.length) local = 'state_filtered';
    else if (f.missing.length) local = 'state_incomplete';
    else if (sent.length > MAX_STATE_CHARS) local = 'state_too_large';
    if (local) {
      writeLog(dir, { ...entry, outcome: 'skipped', reason: local, missing: f.missing });
      return { ...base, skipped: true, reason: local, ...extra, ...(f.missing.length ? { missing: f.missing } : {}) };
    }
    const impl = providerImpls[cfg.provider];
    const t0 = process.hrtime.bigint();
    const r = impl ? await impl.ask({ id: questionId, question, state: f.state, cfg, key: env[cfg.key_env], timeoutMs }) : { error: true, reason: 'unknown_provider' };
    const latencyMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;
    if (r.error) {
      writeLog(dir, { ...entry, outcome: 'error', reason: r.reason, latency_ms: latencyMs });
      return { ...base, error: true, reason: r.reason, latencyMs, ...extra };
    }
    const usage = r.usage || {};
    const typed = { ...base, type: question.type, model: r.model, answer: r.answer,
      ...(r.p !== undefined ? { p: r.p } : { confidence: r.confidence, probabilities: r.probabilities }),
      latencyMs, inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, ...extra };
    writeLog(dir, { ...entry, outcome: 'answer', model: r.model, answer: r.answer, p: r.p, confidence: r.confidence, probabilities: r.probabilities,
      latency_ms: latencyMs, input_tokens: typed.inputTokens, output_tokens: typed.outputTokens });
    return typed;
  } catch (err) {
    return { ...base, error: true, reason: 'internal' };
  }
}

// ---- stats (R-40, first part: volume, latency, cost, share at the thresholds) ----
function pct(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : null; }

function stats(entries, { block = DEFAULTS.block_threshold, warn = DEFAULTS.warn_threshold } = {}) {
  const by = {};
  for (const e of entries) {
    if (!e || !e.question) continue;
    const s = by[e.question] || (by[e.question] = { calls: 0, answered: 0, skipped: 0, errors: 0, reasons: {}, latency: [], input_tokens: 0, output_tokens: 0, at_block: 0, at_warn: 0 });
    s.calls++;
    if (e.outcome === 'answer') {
      s.answered++;
      if (typeof e.latency_ms === 'number') s.latency.push(e.latency_ms);
      s.input_tokens += Number(e.input_tokens) || 0;
      s.output_tokens += Number(e.output_tokens) || 0;
      const score = typeof e.p === 'number' ? e.p : e.confidence;
      if (typeof score === 'number' && score >= block) s.at_block++;
      if (typeof score === 'number' && score >= warn) s.at_warn++;
    } else {
      s[e.outcome === 'skipped' ? 'skipped' : 'errors']++;
      s.reasons[e.reason || 'unknown'] = (s.reasons[e.reason || 'unknown'] || 0) + 1;
    }
  }
  const out = {};
  for (const [q, s] of Object.entries(by)) {
    const lat = s.latency.sort((a, b) => a - b);
    out[q] = { calls: s.calls, answered: s.answered, skipped: s.skipped, errors: s.errors, reasons: s.reasons,
      latency_p50_ms: pct(lat, 0.5), latency_p95_ms: pct(lat, 0.95), input_tokens: s.input_tokens, output_tokens: s.output_tokens,
      share_at_block: s.answered ? s.at_block / s.answered : null, share_at_warn: s.answered ? s.at_warn / s.answered : null };
  }
  return out;
}

module.exports = { ask, judgeConfig, configProblems, filterState, loadCatalogue, loadDenylist, readLog, writeLog, logDirOf, stats, providerImpls, CATALOGUE_FILE, TYPESAFE_URL, DEFAULTS };
