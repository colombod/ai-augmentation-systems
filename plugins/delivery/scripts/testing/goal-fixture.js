// scripts/testing/goal-fixture.js — a project with the Chief of Staff's transcript and real operator
// records, so a goal field can be set the only way it can: the owner's Yes in the question box. Tests only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Goal = require('../lib/goal.js');
const log = require('../lib/operator-log.js');
const R = require('../lib/operator-records.js');

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const SID = 's1';
const COS = { instance: 'chief-of-staff', role: 'chief-of-staff', session_id: SID, host: 'pc' };

// A project and the Chief of Staff's session transcript. Owner inputs are captured the way the hooks
// capture them (operator-log syncTranscript), timestamped a minute after now so that a question
// recorded now comes before them, one second apart.
function goalProject({ freeText = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-'));
  fs.mkdirSync(path.join(root, '.delivery', 'team'), { recursive: true });
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'team.json'), JSON.stringify({ project: 'x', prefix: 'x', bd_host: 'pc', roles: [
    { id: 'chief-of-staff', brief: 'delivery/chief-of-staff', host: 'pc', model: 'opus' }, { id: 'product-manager', brief: 'delivery/product-manager', host: 'pc', model: 'opus' }],
    ...(freeText ? { goal: { free_text: true } } : {}) }));
  fs.writeFileSync(path.join(root, '.delivery', 'team', 'hosts.json'), JSON.stringify({ hosts: { pc: { kind: 'pc' } } }));
  const tr = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'goal-tr-')), 't.jsonl');
  fs.writeFileSync(tr, '');
  const t0 = Date.now() + 60e3;
  let k = 0;
  const ts = (laterMin = 0) => new Date(t0 + (k++) * 1000 + laterMin * 60e3).toISOString();
  const push = (r) => fs.appendFileSync(tr, `${JSON.stringify({ sessionId: SID, ...r })}\n`);
  const sync = () => {
    log.syncTranscript({ projectRoot: root, transcriptPath: tr, sessionId: SID, instance: 'chief-of-staff', role: 'chief-of-staff', host: 'pc', now: new Date() });
    const all = log.listInputs(root, { source: 'human' });
    return all[all.length - 1].id;
  };
  const say = (text, { laterMin } = {}) => { push({ type: 'user', origin: { kind: 'human' }, promptId: `p${k}`, uuid: `u${k}`, timestamp: ts(laterMin), message: { role: 'user', content: text } }); return sync(); };
  const cos = (text) => push({ type: 'assistant', uuid: `a${k}`, timestamp: ts(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
  // the harness's AskUserQuestion: the tool_use, then its tool_result with the owner's selection
  const askUser = (question, answer, { laterMin, options = ['Yes', 'No'], multiSelect = false } = {}) => {
    const n = k;
    const questions = [{ question, header: 'Goal change', multiSelect, options: options.map((label) => ({ label, description: label })) }];
    push({ type: 'assistant', uuid: `ask${n}`, timestamp: ts(), message: { role: 'assistant', content: [{ type: 'tool_use', id: `tu${n}`, name: 'AskUserQuestion', input: { questions } }] } });
    push({ type: 'user', uuid: `res${n}`, promptId: `pr${n}`, timestamp: ts(laterMin), sourceToolAssistantUUID: `ask${n}`, toolUseResult: { questions, answers: { [question]: answer } },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu${n}`, content: `The user answered: "${question}"="${answer}".` }] } });
    return sync();
  };
  const ask = (field, value, { text } = {}) => {
    const t = text || Goal.questionText(field, value);
    return { q: R.recordQuestion({ projectRoot: root, text: t, asker: { instance: 'chief-of-staff' }, options: ['Yes', 'No'], by: COS }).id, text: t };
  };
  const decide = (input, quote, label, answers) => R.recordDecision({ projectRoot: root, cite: input, quote, statement: 'owner decision',
    scope: { beads: [], labels: label ? [label] : [], initiatives: [] }, by: COS, ...(answers ? { answers } : {}) }).id;
  // the two proofs that the owner saw the question: AskUserQuestion, or typed after the CoS's message
  const confirmAsk = (field, value, { answer = 'Yes', laterMin, options, multiSelect } = {}) => { const { q, text } = ask(field, value); return decide(askUser(text, answer, { laterMin, options, multiSelect }), answer, `goal:${field}=${value}`, [q]); };
  const confirmTyped = (field, value, { reply = 'yes', shown, laterMin } = {}) => {
    const { q, text } = ask(field, value);
    cos(shown === undefined ? `One decision for you. ${text}` : shown);
    return decide(say(reply, { laterMin }), reply, `goal:${field}=${value}`, [q]);
  };
  return { root, say, cos, askUser, ask, decide, confirmAsk, confirmTyped };
}
// set a field on the owner's Yes in the box, as goal.js set does
const ownerSets = (t, field, value) => Goal.set({ root: t.root, who: { root: t.root, roleId: 'chief-of-staff', instance: 'chief-of-staff' }, field, value: String(value), record: t.confirmAsk(field, String(value)) });

module.exports = { goalProject, ownerSets, COS, SID };
