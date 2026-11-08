// scripts/lib/first-turn.js — what a role session does first, every time it is started or woken.
//
// hjx.1.6.12 (dec-chief-of-staff-000383): after a restart every role session came up and sat idle with
// ready work. Its start told a role holding nothing to "say what you could take", and each wake named
// only the one stall that caused it, so no path told a role to read its whole backlog and take the next
// item. One text, used by the session start (hooks/scripts/role-context.js) and by every watchdog wake
// (lib/watchdog.js wakePrompt), so the two can never drift apart again.
const FIRST_TURN = 'Read your work before anything else: your own in-progress beads (bd list --assignee "$BEADS_ACTOR" --status in_progress) and their notes, then bd ready, then the messages waiting for you.'
  + ' Continue what you hold. Holding nothing, take the next ready item your brief gives your role now (a builder claims it: bd update <id> --claim; the Delivery Manager assigns it to a live builder),'
  + ' or add a bead note that starts "Blocked:" with the reason and who can unblock it. Ready work with nothing in progress is never a resting state.';

// a role that holds work continues it, and still looks at what else is waiting for it
const HELD_TURN = 'Then read bd ready and the messages waiting for you.';

module.exports = { FIRST_TURN, HELD_TURN };
