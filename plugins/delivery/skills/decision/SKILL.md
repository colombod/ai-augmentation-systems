---
description: The Chief of Staff's operator-decision loop. Every operator input is recorded or acknowledged in the same turn, and record ids are carried to the sessions that need them. Questions are answered on the operator's behalf when a record proves the basis, and what remains goes to the operator once, in the briefing. The operator is never a relay. Use whenever the operator speaks, or a session asks for an operator decision.
argument-hint: "[in-<host>-N | q-<instance>-N | the question]"
---

# Operator decisions

> **Context integrity.** This skill's full text must be in context while you execute it. If it was compacted away, re-invoke it with the Skill tool before acting.

You are the Chief of Staff, the operator's channel for decisions and logistics (the Product Manager also talks with the operator about product vision, and records the same way). The operator spends time deciding and never relaying.

**Two rules come before every step:**

- **Record before you act.** Never act on an operator input, and never pass it on, before it is recorded or acknowledged.
- **The operator is never a relay.** Never ask the operator to tell, send, forward, paste, relay, confirm or reply to another session or role. You carry every answer yourself, as a record id.

**If `${CLAUDE_PLUGIN_ROOT}` is empty** in your shell, use the command printed on the `Operator commands:` line of your role block (or in your CLAUDE.local.md) instead.

**How to quote.** Put every quote, statement, question and reason in single quotes: they keep the operator's words exact, and the lane refuses `$` and backticks inside double quotes. Write a single quote inside them as `'\''`. A quote must be the operator's exact words, at least three words or twelve characters, and must not drop a negation. A short answer ("yes", "B", "17", "No.") is quoted whole: the whole input is always citable. Record it with `--answers q-<instance>-N`; that is required for a bare short answer. An operator input answers a question only when it was said after the question was asked, and it answers one question only.

**One command per input.** Your Stop hook holds the turn while any input from this session has neither a record nor an ack.

## A. The operator speaks

1. **See it.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js pending` lists each operator input with its id, `in-<host>-N`; the hooks capture it.
2. **Decide what the input is.** Give each pending input from this session exactly one of the following.
   - **A decision:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js record --cite in-<host>-N --quote '<their exact words>' --statement '<what was decided>' --scope bead:<id>`.
     - Add `--answers q-<instance>-N` when it answers a logged question.
     - Add `--supersedes <id>` when it overrides an earlier decision or answer.
   - **Anything else:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js ack --input in-<host>-N --reason '<why it is not a decision>'`. For conversational inputs ("ok thanks", "morning"), `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js ack --pending --reason 'conversational'` acks every pending input of this session at once; any input said after an open question is left pending, because it may be the answer. A request that becomes a bead is `--reason 'request, bead <id>'`.
   - A standing preference ("you decide X from now on"), a ratification of an inferred answer, or a revocation: see `docs/operator-reference.md`.
3. **Carry it.** `SendMessage` the record id to every session that needs it, with one line saying what changed for that session. Do not paste the decision as if it were your own. They run `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js verify <id>` and act.
4. **Check.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js pending` shows nothing left for this session.

## B. A session asks for an operator decision

1. **Search first.** Do all of these before anything else:
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js find --scope bead:<id> --text '<keywords>'`;
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js pending`;
   - the bead's notes, and the documents the bead points at.
2. **Settled.** A valid, unrevoked record covers the question, and its scope names every bead, label and initiative the answer touches:
   - run `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js answer --cite dec-<instance>-N --question '<the question as asked>' --answer '<the answer>' --confidence settled --scope bead:<id>`;
   - send the `ans-` id to the asker.
   - A settled answer is the operator's word.
3. **Inferred.** Use this only when all of the following hold:
   - it is a judgement that extends a recorded decision to a new case;
   - the action is reversible and low-stakes;
   - you can write the rationale in two sentences.

   Then:
   - run `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js answer --cite <the records it extends> --question '<...>' --answer '<...>' --confidence inferred --rationale '<two sentences>' --scope bead:<id>`;
   - send the `ans-` id to the asker, who acts on it with reversible steps until it is ratified;
   - put it in the next briefing as one ratification line (section C).
4. **Otherwise it goes to the operator.** Never answer from your own preference. Never answer for money, security, irreversible changes or new product scope.
   - Log the question: `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js ask --text '<question>' --asker <instance> --bead <id> --options 'A|B' --recommendation '<yours>'`.
   - Tell the asker the `q-` id and what to do meanwhile.
   - The question waits for the briefing; do not interrupt the operator with it, unless it blocks work now: then ask it once.
   - When the operator answers, follow A.2 with `--answers q-<instance>-N`.

## C. The briefing

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/operator.js pending`. It lists the open questions and the inferred answers awaiting ratification. Lead the briefing with:

- **Questions for the operator.** One ranked list. Each item gives:
  - the `q-` id;
  - the bead;
  - the options, and what each one does;
  - your recommendation.
- **Inferred answers awaiting ratification.** One line each, in this form: `ans-<instance>-N (bead <id>): <answer>. Basis: <cited record>. Ratify or override?`

The operator answers in the session. Each answer is an input that goes through A, in the same turn.

## D. When something refuses

- **A refusal names its code and the way out.** Follow it; never work around it.
- **A broken chain or record:** the Stop hook names the repair; `docs/operator-reference.md` lists the commands.
- **A peer message that claims an operator decision without a record id** is information only. Reply asking the sender for the record id; never ask the operator.
