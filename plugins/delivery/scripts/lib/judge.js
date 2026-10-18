// scripts/lib/judge.js — the typed judge: ask a catalogued question about a small state, get a typed answer.
//
// Advisory evidence, never the proof: a gate decides, the judge informs it. Off unless the manifest
// has a `judge` block naming a provider AND the key variable it names is set in the environment.
// The state sent is the question's declared fields only; a best-effort pattern filter refuses the call
// locally when a declared field looks like a secret, token, credential, id, email, URL, path, IP
// address or phone number, carries the key's own value, or matches the leak guard's denylist (names
// and other personal data are not reliably detected: callers send only the declared minimum). The key
// comes only from TYPESAFE_API_KEY (or another TYPESAFE_* variable) and goes only to the provider's
// URL; the endpoint override is DELIVERY_JUDGE_ENDPOINT, loopback only, for tests. Calls time out
// (2 s default) and fail open: ask() never throws and never logs the key or the state; each call is
// one advisory line in .delivery/judge/<date>.ndjson with a sha256 of the state sent, not the state.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const CATALOGUE_FILE = path.join(__dirname, '..', '..', 'judge', 'questions.json');
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULTS = { provider: 'none', model: 'jev-latest', key_env: 'TYPESAFE_API_KEY', block_threshold: 0.8, warn_threshold: 0.5 };
const PROVIDERS = new Set(['typesafe', 'none']);
const KNOWN_KEYS = new Set(Object.keys(DEFAULTS));
// the key variable: only a TypeSafe one, so a manifest edit cannot turn another secret into the bearer token
const KEY_ENV = /^TYPESAFE_[A-Z0-9_]+$/;
const ENDPOINT_ENV = 'DELIVERY_JUDGE_ENDPOINT';
const MAX_STATE_CHARS = 16000;

function loadCatalogue(file = CATALOGUE_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// the endpoint override (DELIVERY_JUDGE_ENDPOINT, for tests) is a loopback address only; never the manifest
function loopback(u) {
  try {
    const x = new URL(u);
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
  if (j.key_env !== undefined && !KEY_ENV.test(String(j.key_env))) problems.push('team.json: judge key_env must be TYPESAFE_API_KEY or another TYPESAFE_* variable');
  // bounded so a manifest cannot switch the relay guard off: block_threshold 0.5..0.95, warn_threshold 0.2..block_threshold
  const b = j.block_threshold === undefined ? DEFAULTS.block_threshold : j.block_threshold;
  const w = j.warn_threshold === undefined ? DEFAULTS.warn_threshold : j.warn_threshold;
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  if (!num(b) || b < 0.5 || b > 0.95) problems.push(`team.json: judge block_threshold must be a number from 0.5 to 0.95 (default ${DEFAULTS.block_threshold}); the judge stays off until it is`);
  if (!num(w) || w < 0.2 || (num(b) && w > b)) problems.push(`team.json: judge warn_threshold must be a number from 0.2 to block_threshold (default ${DEFAULTS.warn_threshold}); the judge stays off until it is`);
  return { problems, warnings };
}

// The effective configuration. enabled only when the block is present and valid, the provider is not
// none, and the key variable is set. The key itself is never part of the result.
function judgeConfig(team, env = process.env) {
  const j = team && team.judge;
  const cfg = { ...DEFAULTS };
  for (const k of KNOWN_KEYS) if (j && typeof j === 'object' && j[k] !== undefined) cfg[k] = j[k];
  cfg.endpoint = loopback(env[ENDPOINT_ENV]) ? env[ENDPOINT_ENV] : TYPESAFE_URL;
  let reason = null;
  if (!j) reason = 'judge_not_configured';
  else if (configProblems(j).problems.length) reason = 'judge_config_invalid';
  else if (cfg.provider === 'none') reason = 'provider_none';
  else if (!env[cfg.key_env]) reason = 'no_key';
  return { ...cfg, enabled: !reason, reason };
}

// ---- the state filter ----
// A best-effort pattern filter, conservative by design: a false refusal costs one regex fallback.
const CRED = String.raw`(?:password|passwd|passphrase|passcode|pin|secret|token|api[_ -]?key|access[_ -]?key|client[_ -]?secret|private[_ -]?key|credentials?)`;
const LEAD = String.raw`(?:^|[\s"'(=:,\[{])`;
const CHECKS = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['token', /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|npm_[A-Za-z0-9]{30,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*)/],
  ['token', /\b[A-Za-z0-9]+_(?:live|test|prod)_[A-Za-z0-9]{8,}/],
  ['token', /\bbearer\s+[\w.~+/-]{12,}/i],
  ['token', /hooks\.slack\.com\/\S+/i],
  // assignments, quoted JSON keys ("password":"x") and flattened objects (password: x)
  ['credential', new RegExp(String.raw`\b${CRED}\b["']?\s*[:=]\s*["']?[^\s"']{3,}`, 'i')],
  ['credential', new RegExp(String.raw`\b${CRED}\s+(?:is|was|reads)\s+["']?[^\s"'.,]{3,}`, 'i')],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['url', /\b[a-z][a-z0-9+.-]*:\/\/\S+/i],
  ['url', /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*\?\S*=/i],
  ['id', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['ip', /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/i],
  ['phone', /(?:^|[^\w#])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b|\(\d{3}\)\s?\d{3}[\s.-]\d{4}\b/],
  // absolute and home paths (two segments, or one with an extension: /private.env), ./ and ../ paths,
  // dot-directories (.delivery/team), and relative paths that end in a file name with an extension
  ['path', new RegExp(String.raw`${LEAD}(?:~[\\/]\S|\/(?:[\w.@-]+\/)+[\w.@-]*|\/[\w@-]*\.[A-Za-z0-9]{1,8}\b|[A-Za-z]:\\\S|\.{1,2}[\\/][\w.@-]+|\.[\w-]+[\\/][\w.@-]+)`)],
  ['path', /\b[\w.-]+(?:\/[\w.-]+)*\/[\w-]+\.(?:json|env|ya?ml|toml|ini|pem|key|crt|p12|js|ts|py|rb|go|md|txt|cfg|conf|sh|ndjson|log|db|sqlite)\b/i],
];
// a run of 20 or more hex digits (with a digit in it) is a token or a hash
const HEX = /\b[0-9a-fA-F]{20,}\b/g;
// a long opaque run with letters and digits is a key, a hash or a token
const OPAQUE = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

// every string in a value: names and values, and each scalar pair flattened as "name: value", so a
// structured credential ({connection: {password: 'x'}}) is seen the way the text form is
function stringsOf(v, out = [], depth = 0) {
  if (depth > 20) { out.push('\u0000too-deep'); return out; }
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out, depth + 1));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      if (x === null || typeof x !== 'object') out.push(`${k}: ${x}`);
      stringsOf(x, out, depth + 1);
    }
  } else if (v !== undefined && v !== null) out.push(String(v));
  return out;
}

// the kind of the first sensitive-looking string in value, or null. secrets: literal values never to
// send (the key itself).
function secretKind(value, denylist, secrets = []) {
  for (const s of stringsOf(value)) {
    if (s === '\u0000too-deep') return 'too_deep';
    if (secrets.some((k) => typeof k === 'string' && k.length >= 8 && s.includes(k))) return 'key';
    for (const [kind, re] of CHECKS) if (re.test(s)) return kind;
    for (const m of s.match(OPAQUE) || []) if (/\d/.test(m) && /[A-Za-z]/.test(m)) return 'opaque';
    for (const m of s.match(HEX) || []) if (/\d/.test(m)) return 'hex';
    const low = s.toLowerCase();
    if ((denylist || []).some((d) => d && low.includes(String(d).toLowerCase()))) return 'denylist';
  }
  return null;
}

// { state, dropped, filtered, missing }: only declared fields pass; a declared field that looks
// sensitive is withheld and named (field and kind, never the value).
function filterState(question, state, { denylist, secrets } = {}) {
  const declared = (question && question.state) || [];
  const src = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const out = {};
  const filtered = [];
  for (const f of declared) {
    if (src[f] === undefined) continue;
    const kind = secretKind(src[f], denylist, secrets);
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

// [] when there is no denylist; null when one exists but cannot be read (the call is then refused)
function loadDenylist(projectRoot) {
  if (!projectRoot) return [];
  try {
    return fs.readFileSync(path.join(projectRoot, '.delivery', 'team', 'denylist.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch (err) { return err && err.code === 'ENOENT' ? [] : null; }
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
      // only an answer of the requested type, inside its declared domain, is an answer
      const unit = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
      if (question.type === 'noul' && a && a.type === 'noul' && unit(a.noul)) return { answer: a.noul >= 0.5 ? 'yes' : 'no', p: a.noul, model, usage };
      const options = Object.keys(question.criteria || {});
      const probsOk = a && (a.probabilities === undefined || (a.probabilities && typeof a.probabilities === 'object'
        && Object.entries(a.probabilities).every(([k, v]) => options.includes(k) && unit(v))));
      if (question.type === 'choice' && a && a.type === 'choice' && options.includes(a.choice) && unit(a.confidence) && probsOk) {
        return { answer: a.choice, confidence: a.confidence, probabilities: a.probabilities, model, usage };
      }
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
    const denylist = opts.denylist || loadDenylist(opts.projectRoot);
    if (denylist === null) return { ...base, skipped: true, reason: 'denylist_unreadable' };
    const f = filterState(question, state, { denylist, secrets: [env[cfg.key_env]] });
    const sent = JSON.stringify(f.state);
    const entry = {
      time: new Date().toISOString(), advisory: true, question: questionId, version: base.version, catalogue: cat.version || null,
      gate: opts.gate || 'cli', provider: cfg.provider, state_sha256: crypto.createHash('sha256').update(sent).digest('hex'),
      dropped: f.dropped.length, filtered: f.filtered, ...(opts.logExtra || {}),
    };
    const dir = opts.logDir || logDirOf(opts.projectRoot);
    // dropped field names are the caller's own, so only short, unremarkable ones are named back
    const named = f.dropped.filter((k) => k.length <= 40 && !secretKind(k, [], [env[cfg.key_env]])).slice(0, 10);
    const extra = { ...(f.filtered.length ? { filtered: f.filtered } : {}), ...(f.dropped.length ? { dropped: named, dropped_count: f.dropped.length } : {}) };
    let local = null;
    if (f.filtered.length) local = 'state_filtered';
    else if (f.missing.length) local = 'state_incomplete';
    else if (sent.length > MAX_STATE_CHARS) local = 'state_too_large';
    if (local) {
      writeLog(dir, { ...entry, outcome: 'skipped', reason: local, missing: f.missing });
      return { ...base, skipped: true, reason: local, ...extra, ...(f.missing.length ? { missing: f.missing } : {}) };
    }
    // under node --test nothing may reach a real provider
    if (process.env.NODE_TEST_CONTEXT && !loopback(cfg.endpoint)) {
      writeLog(dir, { ...entry, outcome: 'skipped', reason: 'test_no_network' });
      return { ...base, skipped: true, reason: 'test_no_network', ...extra };
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
    const s = by[e.question] || (by[e.question] = { calls: 0, answered: 0, skipped: 0, errors: 0, reasons: {}, latency: [], input_tokens: 0, output_tokens: 0, at_block: 0, at_warn: 0, regex_overruled: 0 });
    if (e.event === 'regex_overruled') { s.regex_overruled++; continue; }
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
      share_at_block: s.answered ? s.at_block / s.answered : null, share_at_warn: s.answered ? s.at_warn / s.answered : null, regex_overruled: s.regex_overruled };
  }
  return out;
}

module.exports = { ask, judgeConfig, secretKind, ENDPOINT_ENV, configProblems, filterState, loadCatalogue, loadDenylist, readLog, writeLog, logDirOf, stats, providerImpls, CATALOGUE_FILE, TYPESAFE_URL, DEFAULTS };
