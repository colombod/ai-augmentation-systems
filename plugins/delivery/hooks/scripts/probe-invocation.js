#!/usr/bin/env node
// Throwaway spike probe (harden-02, harden-03) — NOT the production recorder.
// Purpose: dump raw hook stdin verbatim so real field names, payload shape, and
// firing behavior can be inspected, instead of assumed from documentation.
//
// Deliberately as simple as possible: no whitelisting, no NDJSON contract, no
// .delivery/ resolution. Those are harden-05's concerns, once this has answered
// what the real payload actually looks like.
//
// Set PROBE_THROW=1 in the environment to test crash isolation (Spike 5): the
// script throws after reading stdin but before writing anything, so a run with
// PROBE_THROW=1 proves whether a hook that errors can still block or degrade the
// tool call it observed.

const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.PROBE_LOG_PATH ||
  path.join(__dirname, '..', '..', '.delivery', 'spike-probe.ndjson');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (err) {
    return '';
  }
}

function main() {
  const raw = readStdin();
  const record = {
    probe_received_at: new Date().toISOString(),
    argv: process.argv.slice(2),
    env_hook_event: process.env.CLAUDE_HOOK_EVENT || null,
    raw_stdin: raw,
  };

  if (process.env.PROBE_THROW === '1') {
    // Deliberate crash, after capturing input, before writing output —
    // isolates "did the hook see the event" from "did the hook survive."
    throw new Error('PROBE_THROW=1: deliberate crash for Spike 5 (crash isolation)');
  }

  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  } catch (err) {
    // Even the probe must not throw on a logging failure — a spike probe that
    // itself blocks the tool call it's observing would corrupt its own result.
  }
}

main();
