#!/usr/bin/env node
// mcp-spike.js -- spike 1 of the feature-map roadmap. NOT shipped code.
//
// Question: does a role session load an MCP server the delivery plugin ships (stdio, no
// dependencies), under what tool name does the session see it, and does the server receive the
// role's environment (DELIVERY_PROJECT_ROOT, DELIVERY_ROLE_DIR from .claude/settings.local.json)?
// The answer decides ADR-017 and assumptions A-1 and A-16.
//
// One tool, show_shipped, that answers with what the server can observe about itself, so a
// transcript shows the real call and the real environment rather than map data.
'use strict';
const readline = require('readline');

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const TOOL = {
  name: 'show_shipped',
  description: 'Spike: report the environment this map server was started with (no map data yet).',
  inputSchema: { type: 'object', properties: { at: { type: 'string', description: 'a 40-hex commit' } } },
};

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch (err) { return; }
  if (req.id === undefined) return; // a notification needs no answer
  if (req.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: req.params && req.params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'delivery-map-spike', version: '0.0.1' } } });
  }
  if (req.method === 'tools/list') return send({ jsonrpc: '2.0', id: req.id, result: { tools: [TOOL] } });
  if (req.method === 'tools/call') {
    const seen = {
      cwd: process.cwd(),
      DELIVERY_PROJECT_ROOT: process.env.DELIVERY_PROJECT_ROOT || null,
      DELIVERY_ROLE_DIR: process.env.DELIVERY_ROLE_DIR || null,
      DELIVERY_ROLE: process.env.DELIVERY_ROLE || null,
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || null,
      node: process.version,
      at: (req.params && req.params.arguments && req.params.arguments.at) || null,
    };
    return send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: JSON.stringify(seen) }] } });
  }
  send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `no method ${req.method}` } });
});
