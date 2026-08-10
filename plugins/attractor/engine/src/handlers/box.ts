import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wantsVerdict } from '../backend/argv.ts'
import { isEngineManagedKey } from '../core/context.ts'
import { parseDuration } from '../core/duration.ts'
import { Status, type Outcome } from '../core/outcome.ts'
import { substitute } from '../core/substitute.ts'
import { type Backend, type Handler, type HandlerCtx } from './types.ts'

/**
 * A goal gate must be earned with evidence. An outcome that carries no
 * routing signal — no preferred label, no suggested nodes, no context
 * updates — is prose, and prose cannot satisfy a gate.
 *
 * This closes a documented upstream failure: a judge wrote "NOT CONVERGED"
 * and was recorded a success by a fail-open default, so the designed replan
 * loop never fired and the run exited false-success with no work product.
 */
function carriesVerdict(outcome: Outcome, allowedUpdates: Record<string, string> | undefined): boolean {
  // An empty label is not a routing signal, for the same reason an empty
  // suggestion list and an empty update map are not.
  if (outcome.preferredLabel !== undefined && outcome.preferredLabel.length > 0) return true
  if (outcome.suggestedNextIds !== undefined && outcome.suggestedNextIds.length > 0) return true
  // The ALLOWED updates, not the raw ones. Reading the raw map let a gate
  // earn its verdict with keys the namespace guard had just thrown away --
  // `{'tool.last_line': 'green'}` alone satisfied the check while writing
  // nothing to context at all. Evidence the control plane refused to accept
  // is not evidence.
  if (allowedUpdates !== undefined && Object.keys(allowedUpdates).length > 0) return true
  return false
}

/**
 * Context keys this handler writes on every dispatch, from spec section 4.5
 * step 5: `context_updates={"last_stage": node.id, "last_response":
 * truncate(response_text, 200)}`.
 *
 * Exported for the same anti-drift reason `TOOL_OUTPUT_KEYS` is: the engine
 * test that asserts every key a run leaves in context is one the model-facing
 * guard rejects has to be able to subtract the keys a HANDLER legitimately
 * owns, and a hand-kept copy of this pair in the test would eventually
 * disagree with the handler.
 *
 * Deliberately NOT in `isEngineManagedKey`. Section 5.1 attributes both keys
 * to handlers rather than the engine, so a handler writing them is conformant
 * and a node overwriting them is not forging a control-plane routing token --
 * `core/context.ts` records that carve-out and the reasoning behind it.
 */
export const BOX_CONTEXT_KEYS: readonly string[] = ['last_stage', 'last_response']

/** Section 4.5's `truncate(response_text, 200)`. */
const LAST_RESPONSE_MAX = 200

export class BoxHandler implements Handler {
  private backend: Backend

  constructor(backend: Backend) {
    this.backend = backend
  }

  async execute(ctx: HandlerCtx): Promise<Outcome> {
    // Spec section 4.5: "IF prompt is empty: prompt = node.label". Section 2.6
    // then gives `label` the default "node ID", so the chain has a THIRD rung
    // and cannot bottom out empty. `||` not `??`, so an explicitly empty
    // attribute falls through rather than being treated as a value.
    //
    // The chain used to end at `''`, which meant `bare_node [shape=box]` --
    // a node declaring neither attribute, which the spec says is legal and
    // fully specified -- dispatched a BLANK prompt to a live model. That
    // spends a turn and real money asking nothing, and whatever comes back is
    // routed on as if it answered something.
    const rawPrompt = ctx.node.attrs.prompt || ctx.node.attrs.label || ctx.node.id
    const prompt = substitute(rawPrompt, ctx.context)

    // Written BEFORE dispatch, not after: a real subprocess backend can hang
    // or need to be killed, and an operator debugging a hung node needs the
    // prompt on disk while it is still running, not only once it returns.
    const nodeDir = join(ctx.runDir, ctx.node.id)
    mkdirSync(nodeDir, { recursive: true })
    writeFileSync(join(nodeDir, 'prompt.md'), prompt, 'utf8')

    ctx.events.append({ type: 'node.box.start', node: ctx.node.id })

    // Nothing else bounds a hung `claude -p`: ctx.signal is never populated
    // by the engine (the seam exists, but nothing writes to it), and this
    // backend's own abort path is otherwise exercised only by tests. A node
    // with no `timeout` gets no AbortController and behaves exactly as
    // before. Same duration syntax ToolHandler uses for shell nodes, from
    // the shared parser, so `timeout="5m"` means the same thing on either
    // node kind.
    const timeoutMs = parseDuration(ctx.node.attrs.timeout)
    const controller = timeoutMs > 0 ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    let outcome: Outcome
    try {
      outcome = await this.backend.run(
        ctx.node,
        prompt,
        ctx.context,
        ctx.graph,
        controller?.signal ?? ctx.signal,
        ctx.cwd,
      )
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }

    // Context updates are merged BEFORE the gate check: a gate that wrote
    // evidence into context has produced a routing signal.
    //
    // The engine-managed namespace belongs to the deterministic layer.
    // Without this filter a Backend can forge the control plane's own routing
    // tokens: a box node returning contextUpdates: {'tool.last_line':
    // 'green'} would satisfy condition="context.tool.last_line=green" with no
    // tool node ever having run, and one returning {current_node: 'start'}
    // would let a model lie about which node is executing. Latent while
    // StubBackend is scripted by tests; live the moment a model authors
    // contextUpdates.
    //
    // The predicate is shared with the engine rather than restated here --
    // see `isEngineManagedKey` for why a second copy is the failure mode.
    let allowedUpdates: Record<string, string> | undefined
    if (outcome.contextUpdates) {
      const rejected = Object.keys(outcome.contextUpdates).filter(isEngineManagedKey)
      if (rejected.length > 0) {
        // Recorded, not fatal. Aborting the run on a model-authored key would
        // hand the model a kill switch over any pipeline it runs in; the
        // control plane's job here is to be unforgeable, not to die. The
        // event log is the record every view over a run derives from, so the
        // attempt is auditable and alertable without being a denial of
        // service. This matches the behaviour the `tool.` guard has always
        // had, now applied to the whole reserved set.
        ctx.events.append({
          type: 'node.box.rejected_update',
          node: ctx.node.id,
          keys: rejected,
        })
      }
      allowedUpdates = Object.fromEntries(
        Object.entries(outcome.contextUpdates).filter(([k]) => !isEngineManagedKey(k)),
      )
      if (Object.keys(allowedUpdates).length > 0) ctx.context.merge(allowedUpdates)
    }

    const isGoalGate = wantsVerdict(ctx.node)
    let finalStatus = outcome.status
    if (
      isGoalGate &&
      (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL) &&
      !carriesVerdict(outcome, allowedUpdates)
    ) {
      finalStatus = Status.RETRY
      ctx.events.append({
        type: 'node.box.goal_gate_unverified',
        node: ctx.node.id,
        message: 'goal gate returned prose with no verdict; failing closed to RETRY',
      })
    }

    // Section 4.5 step 5's own context updates, written AFTER the gate
    // decision above -- and the ORDER is the whole safety property, not a
    // detail of arrangement.
    //
    // `carriesVerdict` treats a non-empty allowed-update map as a routing
    // signal. Merging these two keys into `allowedUpdates` before the check
    // would give EVERY goal gate a verdict it did not earn, and the
    // fail-closed downgrade would never fire again -- reopening the exact
    // upstream false-success the doctrine entry in plugins/attractor/AGENTS.md
    // exists to prevent, where a judge wrote "NOT CONVERGED - 2 of 7 criteria
    // pass" and was recorded a success. Evidence the handler manufactured
    // about itself is not evidence. So the gate is decided on what the MODEL
    // said, and only then does the handler record what happened.
    //
    // `response_text` is the outcome's notes, which is what this handler
    // already persists as response.md -- the same text the spec's step 4
    // writes there, so the truncated copy in context and the full copy on disk
    // cannot describe different things. response.md keeps the whole thing;
    // section 4.5 truncates only the context copy.
    const responseText = outcome.notes ?? ''
    const handlerUpdates: Record<string, string> = {
      last_stage: ctx.node.id,
      last_response: responseText.slice(0, LAST_RESPONSE_MAX),
    }
    ctx.context.merge(handlerUpdates)

    const finalOutcome: Outcome = {
      ...outcome,
      status: finalStatus,
      // Reported on the Outcome as well as merged, because section 4.5 states
      // them as `context_updates` and status.json is what an external reader
      // consumes. A model-authored key the namespace guard REJECTED is still
      // reported here unmerged, exactly as before -- this adds the handler's
      // own two keys to that record and changes nothing about the filter.
      contextUpdates: { ...outcome.contextUpdates, ...handlerUpdates },
    }

    // Persist AFTER the gate decision. Writing the raw outcome would record
    // "success" in the per-node artifact while the event log and the return
    // value say "retry" -- and the operator reading that artifact is
    // debugging precisely the case the gate exists to catch.
    //
    // Appendix C wire shape. Named and keyed for an external consumer, not
    // for our internal Outcome type: §4.5 says external tools or agents can
    // write status.json back to communicate outcomes to the engine, so a
    // spec-conformant reader must find field names it recognises here.
    const statusFile = {
      outcome: finalOutcome.status,
      preferred_label: finalOutcome.preferredLabel,
      suggested_next_ids: finalOutcome.suggestedNextIds,
      context_updates: finalOutcome.contextUpdates,
      notes: finalOutcome.notes,
      // Section 5.2's `failure_reason`. Snake-cased like its neighbours,
      // because this file is the external wire shape a spec-conformant reader
      // parses, not our internal Outcome type.
      failure_reason: finalOutcome.failureReason,
    }
    writeFileSync(join(nodeDir, 'status.json'), JSON.stringify(statusFile, null, 2), 'utf8')
    writeFileSync(join(nodeDir, 'response.md'), responseText, 'utf8')

    ctx.events.append({ type: 'node.box.end', node: ctx.node.id, status: finalStatus })
    return finalOutcome
  }
}
