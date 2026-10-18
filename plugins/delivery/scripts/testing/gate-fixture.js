// scripts/testing/gate-fixture.js — a project with one Vault story, its surface and an in-memory bd,
// for the gate tests. Never used in production.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SURFACES = {
  owner_record: 'dec-chief-of-staff-12',
  surfaces: [
    { id: 'S1', host: 'chatgpt.com', app: 'ChatGPT web', mode: 'plain chat', install_artifact: 'connector from the shipped plugin', scriptable: false, size_budgets: { tool_list_max: 20 } },
    { id: 'S2', host: 'chatgpt.com', app: 'ChatGPT web', mode: 'codex', install_artifact: 'connector from the shipped plugin', scriptable: true, size_budgets: { tool_list_max: 20 } },
  ],
};

// vault-0n9.3, the chat-drop import (#478), written the way the ready gate asks
const STORY = `---
id: vault-0n9-3
title: Import a collection by dropping a CSV in the chat
phase: 1
surface: S1
epic: collection
size: M
---

## Owner's ask

> "drop the CSV in the chat" (dec-chief-of-staff-12)

## Goal

A player imports their collection without leaving the chat.

## Acceptance criteria

1. A player in ChatGPT plain chat drops a collection CSV and sees the import summary with the card count.
   - Probe: the chat shows the summary and the server log shows the file argument; where: S1; by: reality-check
2. A player who drops a CSV with an unknown column sees which column was skipped.
   - Probe: the chat names the skipped column; where: S1; by: reality-check

## Measurement plan

| Criterion | Signal | Threshold | Where | When | Who |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | server logs the file argument and client surface per call | 1 of 1 runs receives the file | S1 | pre-merge on preview | delivery-lead |

## Shippable unit

After this story a player can bring their whole collection into the chat and ask about it.
`;

function makeProject({ story = STORY, surfaces = SURFACES, file = 'vault-0n9-3.md' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  for (const f of ['team.json', 'hosts.json']) fs.copyFileSync(path.join(__dirname, 'manifest', f), path.join(root, '.delivery', 'team', f));
  fs.mkdirSync(path.join(root, '.delivery', 'initiatives', 'vault'), { recursive: true });
  if (surfaces) fs.writeFileSync(path.join(root, '.delivery', 'initiatives', 'vault', 'surface.json'), JSON.stringify(surfaces));
  fs.mkdirSync(path.join(root, '.delivery', 'stories'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'stories', file), story);
  return root;
}

function storyBead(over = {}) {
  return { id: 'ex-vault-0n9-3', title: 'Import a collection', status: 'in_progress', assignee: 'dev@pc/builder-1', parent: 'ex-vault-ph1', labels: ['roadmap', 'phase-1', 'story'],
    ...over, metadata: { roadmap_ref: 'vault/roadmap.md@abc1234 phase 1', story_file: 'vault-0n9-3.md', surface: 'S1', area: 'collection', ...(over.metadata || {}) } };
}

// show / update / list over an object of beads, the shape scripts/lib/bd.js returns
function memBd(list) {
  const beads = new Map(list.map((b) => [b.id, JSON.parse(JSON.stringify(b))]));
  return {
    beads,
    show: (id) => (beads.has(id) ? JSON.parse(JSON.stringify(beads.get(id))) : null),
    list: ({ label } = {}) => [...beads.values()].filter((b) => !label || (b.labels || []).includes(label)).map((b) => JSON.parse(JSON.stringify(b))),
    update: (id, { addLabels = [], removeLabels = [], metadata } = {}) => {
      const b = beads.get(id);
      b.labels = [...new Set([...(b.labels || []).filter((l) => !removeLabels.includes(l)), ...addLabels])];
      if (metadata) b.metadata = metadata;
    },
  };
}

module.exports = { SURFACES, STORY, makeProject, storyBead, memBd };
