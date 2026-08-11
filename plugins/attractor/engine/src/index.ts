// Library entry point. Re-exports only -- no logic lives here.
//
// This is the one stable module boundary anything outside engine/src/'s own
// directory tree should import against, rather than reaching into core/,
// dot/, handlers/, backend/, or run/ by relative path. See ADR-016
// (.delivery/decisions/ADR-016-ts-library-packaging.md) for why this exists
// and why it stays source-only (no build step) and private (no npm publish).

export { Engine, defaultHandlers, type EngineOptions, type RunResult } from './core/engine.ts'
export { Context, isEngineManagedKey } from './core/context.ts'
export { Status, isTerminalFailure, type Outcome } from './core/outcome.ts'
export { lint, hasErrors, Severity, type Diagnostic } from './dot/lint.ts'
export { parseDot } from './dot/parse.ts'
export { Handler, type HandlerKind, type Graph, type Node, type Edge } from './dot/graph.ts'
export { EventLog, type RunEvent } from './run/events.ts'
export type { Backend, Handler as HandlerImpl, HandlerCtx } from './handlers/types.ts'
export { ClaudeCodeBackend, type ClaudeBackendOptions } from './backend/claude.ts'
export { StubBackend } from './handlers/stub.ts'
export {
  type Channel,
  type HumanGateContext,
  type ChannelAnswer,
  type ChannelRunContext,
} from './channels/types.ts'
export { defaultChannels } from './channels/defaults.ts'
export { CommandChannel } from './channels/command.ts'
export { HumanGateHandler } from './handlers/human.ts'
