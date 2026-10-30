---
description: Lean on Microsoft Amplifier first on a machine where it is installed. Use before you change anything about the machine's own setup — its services, amplifier-work-tracker, its Dolt server and the logins they use, installed tools — and whenever a command fails on that setup (for example Error 1045 from Dolt, a work-tracker doctor failure, a dead service). Hands the problem to one `amplifier run` call with the facts and a check that proves it is fixed, instead of improvising administration or reading credentials.
argument-hint: "[the problem, in one line]"
---

# Lean on Amplifier first

> **Context integrity.** This skill's full text must be in context while you execute
> it. Compaction keeps only a budgeted slice of invoked skills, and a long pipeline
> session exceeds that budget — so if this text was compacted away, or this session
> resumed mid-phase, re-invoke the skill with the Skill tool before acting. A phase
> run from a summary of its skill is how a Narrated artifact happens.

Where Microsoft Amplifier is installed, it owns that machine's own setup: the
amplifier-work-tracker service, the Dolt server it supervises, and the logins they use. A Claude
session that repairs those by hand edits services and reads credential files it should never touch,
and Claude Code refuses it. Amplifier is the one that set the machine up, so it is the one that
fixes it. Your part is to ask it well and check the answer.

## 1. Find it

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/amplifier.js detect`. Exit 3 means Amplifier is not
installed here: stop using this skill and carry on as you would anywhere else. Otherwise it prints
the Amplifier version and, when amplifier-work-tracker is installed, its service state and whether
`amplifier-work-tracker doctor --quick` passes. Quote those lines; they are the facts you hand on.

## 2. Ask it once, with everything it needs

One call, from the directory the problem is in:

```
amplifier run "<the request>"
```

The request is self-contained, because Amplifier has none of your context:

1. **What is wrong**, in one sentence, and the exact error text you saw (command and output).
2. **The facts you already have**: the `detect` lines, the paths and services involved, what you
   ran. Names of files that hold a secret, never their contents.
3. **What it should do**: diagnose, then fix its own setup, then run the check below and show it
   passing. If the owner only asked for a diagnosis, say "diagnose and propose; change nothing".
4. **The check that proves it is fixed**, for example `amplifier-work-tracker doctor --quick`
   exits 0, or the command that failed now succeeds.
5. **The limits**: never print a secret; touch only what the problem needs.

## 3. Check the answer yourself

Do not take the report on trust. Re-run the check from step 2 and quote its output. Record what
Amplifier said it changed (files, services, restarts) where the work is tracked (the bead's notes,
or your reply to the person you work for), with the check's output.

## 4. If the call is refused

Claude Code may refuse to start an Amplifier agent: `amplifier run` has no approval mode of its
own, so starting it counts as starting an agent with no limits. A refusal is the machine owner's
call, not an obstacle. Do not retry it, rephrase it, wrap it in a script, or do Amplifier's job
yourself instead. Say once, plainly, what you would have asked Amplifier, and that the owner allows
it for good with one permission rule, `Bash(amplifier run:*)`, in their Claude Code settings on
this machine (`~/.claude/settings.json`, `permissions.allow`). Then carry on with what does not
depend on it.

## Never

- Read a credential file or a password variable, or print one, to get past a login error.
- Edit, restart or reconfigure the work-tracker service or its Dolt server yourself when Amplifier
  is installed.
- Ask the owner for a password: the machine that set a login up holds it.
