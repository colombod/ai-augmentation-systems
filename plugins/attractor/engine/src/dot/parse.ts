import { parse as parseAst } from '@ts-graphviz/ast'
import { type Edge, type Graph, type Node, handlerForNode } from './graph.ts'

/**
 * The @ts-graphviz AST is loosely typed for our purposes; we walk it
 * structurally rather than importing its node type union.
 */
interface AstLiteral {
  value: string | number | boolean
  /** `false` bare, `true` double-quoted, `'html'` for an HTML string. */
  quoted?: boolean | string
  location?: { start: { offset: number }; end: { offset: number } }
}

interface AstAny {
  type: string
  children?: AstAny[]
  id?: AstLiteral
  key?: AstLiteral
  value?: AstLiteral
  targets?: AstAny[]
  kind?: string
  /** Present on a `Graph` element only. */
  directed?: boolean
  strict?: boolean
  location?: { start: { offset: number }; end: { offset: number } }
}

/**
 * Section 2.3: "Node IDs must match `[A-Za-z_][A-Za-z0-9_]*`. Human-readable
 * names go in the `label` attribute."
 *
 * The bullet is headed "Bare identifiers for node IDs", which could also be
 * read as forbidding the QUOTING as well as the character set. We check the
 * value, not the quoting, because that is what the normative sentence says --
 * and because the two readings only differ for `"start"`-style ids that are
 * already legal identifiers, where refusing would buy nothing and break
 * graphs that are unambiguous by the rule's own stated purpose.
 */
const NODE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Section 2.2: `Identifier ::= [A-Za-z_][A-Za-z0-9_]*`. */
const IDENT_HEAD = /[A-Za-z_]/
const IDENT_TAIL = /[A-Za-z0-9_]/

interface Scanned {
  /**
   * `src` with every bare `QualifiedId` wrapped in double quotes, and every
   * literal newline or carriage return INSIDE a quoted value replaced with a
   * placeholder codepoint (see `LF_PLACEHOLDER` below).
   */
  text: string
  /** `text` byte-for-byte, with each comment character replaced by a space. */
  masked: string
}

/**
 * Finding F5, section 2.4: `String ::= '"' ... '"'` with "escapes" -- the
 * table's own example is `"line1\nline2"` -- and section 8.6's worked
 * example embeds a REAL newline character inside `model_stylesheet`'s
 * quoted value, spanning five source lines. Real Graphviz accepts this:
 * verified against `dot -Tcanon`, a bare newline byte inside a quoted value
 * survives into the value unchanged. The upstream `@ts-graphviz/ast` grammar
 * does not. Reading its generated parser
 * (`node_modules/@ts-graphviz/ast/lib/ast.js`,
 * `peg$parseDoubleStringCharacter`) shows a double-quoted string character is
 * `QuoteEscape / (![\n\r  "] SourceCharacter) / LineContinuation`.
 * A bare, un-escaped `\n`, `\r`, U+2028 or U+2029 matches none of the three
 * alternatives -- `SourceCharacter` explicitly excludes it (`peg$r5`), and
 * `LineContinuation` requires a PRECEDING backslash that is not there -- so
 * the whole parse aborts at the first one, which is exactly what section
 * 8.6's own example does today: `Expected "\"" or "\\" but "\n" found.`
 *
 * WHY NOT THE OBVIOUS FIX. Escaping the newline to the two characters `\`
 * and `n` before handing the text to the parser looks like it should work,
 * and does not. `peg$f50`, the action for `QuoteEscape`, special-cases only
 * `\"` (-> `"`); every other `\X` -- `\n` included -- comes back UNCHANGED as
 * the two literal characters backslash and `n` (`v[0] + v[1]`). That is not
 * a quirk of the dependency; it is real Graphviz's own rule: `dot -Tcanon`
 * on `label="x\ny"` (two characters, no line break in the source) prints
 * `label="x\ny"` back unchanged, while the same file with an ACTUAL newline
 * byte in that position prints the byte back, not `\n`. So the upstream
 * grammar -- correctly, matching Graphviz -- already gives `\n` (two chars)
 * a different meaning than a real newline. Encoding one as the other would
 * hand the parser a value indistinguishable from a value that always
 * contained the two-character escape, exactly the corruption the section
 * 2.2 fix's docstring warns a "guess" produces (see `scan` below). A literal
 * backslash immediately before the real newline is wrong for the opposite
 * reason: that already means something upstream (`LineContinuation`,
 * `peg$f51`, Graphviz's C-style continuation) and what it means is DELETE
 * the break -- verified against `dot`, `"x\<LF>y"` canonicalizes to `xy`,
 * not `x\ny`.
 *
 * THE FIX: a reversible placeholder, not a decode. `￾` and `￿` are
 * Unicode noncharacters -- permanently reserved by the standard, guaranteed
 * never to represent an interchanged character (Unicode 15.0 section 23.7).
 * Neither appears in `peg$r5`'s exclusion class, so each survives
 * `SourceCharacter` untouched inside a quoted string. `scan()` below
 * substitutes a bare `\n` for `LF_PLACEHOLDER` and a bare `\r` for
 * `CR_PLACEHOLDER` while it is already walking the quoted-string span
 * character by character for the section 2.2 fix; `restorePlaceholders`
 * walks the AST `parseDot` gets back and turns every placeholder back into
 * the byte it stood for, in every `id`, `key` and `value` literal, so what a
 * caller reads is the author's own byte, not an approximation of it.
 * `assertNoPlaceholderCollision` refuses outright, before any of this runs,
 * if the source already contains either codepoint: the one input this
 * scheme cannot tell apart from its own bookkeeping, and it is safer to
 * refuse a file no editor should ever produce than to silently mis-restore
 * one byte in it.
 *
 * WHY THIS REUSES THE SECTION 2.2 SCANNER'S STRING-TRACKING RATHER THAN A
 * NEW REGEX. Telling "inside a quoted value" from "outside" in the presence
 * of `\"` requires the same backslash-aware walk `scan()` already performs:
 * the `c === '"'` branch below already advances past `\<anything>` as one
 * escaped unit before ever asking whether the next byte is a bare quote. The
 * newline substitution runs inside that SAME loop, at the SAME point that
 * already correctly distinguishes an escaped `\"` from a closing quote, so
 * it inherits that correctness rather than re-deriving it with a pattern
 * that cannot see backslash state. It is also LENGTH-PRESERVING -- one
 * placeholder character for one replaced character -- so it cannot disturb
 * the AST's byte offsets into `text`, which `enforceLexicalSubset` depends
 * on. It cannot fire inside a comment or an HTML string: both are handled
 * by their own branches, entered and exited before the quoted-string branch
 * is ever reached for that span of text, so a newline inside `/* ... *\/`,
 * `//`, `#` or `<...>` is untouched, exactly as it already was.
 */
const LF_PLACEHOLDER = '￾'
const CR_PLACEHOLDER = '￿'

function assertNoPlaceholderCollision(src: string): void {
  if (src.includes(LF_PLACEHOLDER) || src.includes(CR_PLACEHOLDER)) {
    throw new Error(
      'attractor: source contains U+FFFE or U+FFFF, Unicode noncharacters this parser ' +
        'reserves internally to represent a literal newline or carriage return inside a ' +
        'quoted value (section 2.4); remove the codepoint from the source before parsing',
    )
  }
}

/**
 * Undo `scan()`'s placeholder substitution once the AST exists. Walking the
 * whole tree rather than only `Attribute` values is deliberate: `id` and
 * `key` share the same `Literal` production and the same quoting rules as
 * `value`, so a quoted node id or a quoted key can carry a placeholder the
 * same way a value can, and every one of them must come back byte-exact.
 */
function restorePlaceholders(n: AstAny): void {
  for (const lit of [n.id, n.key, n.value]) {
    if (typeof lit?.value === 'string' && (lit.value.includes(LF_PLACEHOLDER) || lit.value.includes(CR_PLACEHOLDER))) {
      lit.value = lit.value.split(LF_PLACEHOLDER).join('\n').split(CR_PLACEHOLDER).join('\r')
    }
  }
  for (const c of n.children ?? []) restorePlaceholders(c)
}

/**
 * Make section 2.2's `QualifiedId` acceptable to the upstream DOT parser, and
 * record where the comments are while we are already scanning.
 *
 * WHY A SOURCE TRANSFORM, STATED PLAINLY. Section 2.2 defines
 * `Key ::= Identifier | QualifiedId` with `QualifiedId ::= Identifier ( '.'
 * Identifier )+`, and `BareValue ::= [A-Za-z_][A-Za-z0-9_.:-]*`. The upstream
 * grammar in `@ts-graphviz/ast` has no such production: a `.` following a bare
 * identifier is a syntax error, and the error aborts the WHOLE file, so a
 * single `manager.poll_interval=...` made a pipeline unparseable while
 * `"manager.poll_interval"=...` worked. Two spellings of one thing disagreeing
 * is the defect. The upstream parser is a generated Peggy parser shipped
 * pre-compiled in `node_modules`, exposes no grammar hook, and the dependency
 * set is fixed at two, so it cannot be taught the production and cannot be
 * replaced. What is left is to hand it the spelling it already accepts.
 *
 * WHY THIS IS MEANING-PRESERVING RATHER THAN A GUESS. In DOT, quoting an
 * identifier changes only the `quoted` flag on the resulting `Literal`; the
 * `value` is identical, and `value` is the only field this module reads. So
 * `manager.poll_interval` and `"manager.poll_interval"` produce the same
 * attribute key, which the test 'the unquoted and quoted spellings of a dotted
 * key agree' asserts directly rather than leaving to this comment.
 *
 * WHY IT CANNOT FIRE ON A GRAPH THAT ALREADY PARSED. The rewrite applies only
 * to a `QualifiedId` in code position, and upstream rejects every such token,
 * so any source it rewrites was previously a hard parse error. In particular:
 *
 * - A `.` inside a QUOTED VALUE is skipped -- the scanner tracks string state,
 *   including backslash escapes and the backslash-newline continuation, so
 *   `prompt="see manager.poll_interval"` survives byte-exact and gains no
 *   attribute.
 * - A `.` inside a COMMENT is skipped, in all three forms the parser accepts
 *   (`//`, `#` and block). `# manager.poll_interval` stays a comment.
 * - A `.` inside an HTML string is skipped (those are rejected separately,
 *   and rejected with a message about HTML rather than a syntax error).
 * - A FLOAT is untouched: `QualifiedId` requires an `Identifier` on both sides
 *   of the dot, and a digit is not one, so `0.5`, `-3.14` and `.25` never
 *   match. Nor does a version-like `v1.2.3`, whose `.2` segment is not an
 *   Identifier either -- that is a `BareValue` the spec allows and we still
 *   reject, recorded as a known gap rather than papered over, because the rest
 *   of `BareValue`'s character set (`:` is DOT's port separator, `-` begins
 *   its edge operators) cannot be quoted lexically without changing meaning.
 *
 * The `masked` output exists so the comma check below cannot be satisfied by a
 * comma that is only inside a comment. It is length-preserving so offsets in
 * the AST -- which index `text` -- index it identically.
 */
function scan(src: string): Scanned {
  let text = ''
  let masked = ''
  const emit = (s: string): void => {
    text += s
    masked += s
  }
  // Newlines are kept so a masked block comment does not merge lines; only
  // offsets are used, but a length-preserving mask that also preserves line
  // structure is cheaper to reason about than one that does not.
  const emitComment = (s: string): void => {
    text += s
    masked += s.replace(/[^\n]/g, ' ')
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]

    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2)
      const stop = close === -1 ? src.length : close + 2
      emitComment(src.slice(i, stop))
      i = stop
      continue
    }
    // `#` is a comment start ANYWHERE for the upstream parser, not only at the
    // start of a line (verified against it, not assumed from Graphviz's own
    // line-oriented rule). Treating it as one here is what keeps a mid-line
    // `# manager.x` note from being rewritten.
    if ((c === '/' && src[i + 1] === '/') || c === '#') {
      const nl = src.indexOf('\n', i)
      const stop = nl === -1 ? src.length : nl
      emitComment(src.slice(i, stop))
      i = stop
      continue
    }
    if (c === '"') {
      let j = i + 1
      // The pending run of ordinary characters not yet emitted. Kept
      // separate from `i` so a newline substitution mid-string can flush
      // everything before it without disturbing the escape/close-quote scan.
      let chunkStart = i
      while (j < src.length) {
        // A backslash escapes the next character whatever it is, including a
        // newline (DOT's line continuation) and another backslash. Advancing
        // by two is what stops `"a\\"` from being read as unterminated, and
        // it is what keeps this loop from ever treating an ESCAPED newline
        // as the bare one substituted below -- `\<newline>` never reaches
        // the checks past this point.
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === '"') {
          j++
          break
        }
        // A bare newline or carriage return here is not a DOT escape and not
        // a closing quote -- it is finding F5 / section 8.6's case, a
        // literal line break written into the value. See the block comment
        // above `LF_PLACEHOLDER` for why it becomes a reversible placeholder
        // rather than `\n` or `\` + newline.
        if (src[j] === '\n' || src[j] === '\r') {
          emit(src.slice(chunkStart, j))
          emit(src[j] === '\n' ? LF_PLACEHOLDER : CR_PLACEHOLDER)
          j++
          chunkStart = j
          continue
        }
        j++
      }
      emit(src.slice(chunkStart, Math.min(j, src.length)))
      i = Math.min(j, src.length)
      continue
    }
    if (c === '<') {
      // An HTML string is delimited by BALANCED angle brackets, so the scan
      // counts depth rather than stopping at the first `>`.
      let depth = 0
      let j = i
      while (j < src.length) {
        if (src[j] === '<') depth++
        else if (src[j] === '>') {
          depth--
          if (depth === 0) {
            j++
            break
          }
        }
        j++
      }
      emit(src.slice(i, Math.min(j, src.length)))
      i = Math.min(j, src.length)
      continue
    }
    if (IDENT_HEAD.test(c)) {
      let j = i + 1
      while (j < src.length && IDENT_TAIL.test(src[j])) j++
      let end = j
      let dotted = false
      // `( '.' Identifier )+` -- each further segment must itself begin with
      // an Identifier head, which is exactly what excludes `v1.2.3` and every
      // float.
      while (src[end] === '.' && end + 1 < src.length && IDENT_HEAD.test(src[end + 1])) {
        let k = end + 2
        while (k < src.length && IDENT_TAIL.test(src[k])) k++
        end = k
        dotted = true
      }
      const word = src.slice(i, end)
      emit(dotted ? `"${word}"` : word)
      i = end
      continue
    }

    emit(c)
    i++
  }

  return { text, masked }
}

/**
 * Section 2.1 ("no HTML labels") and section 2.3 ("Commas required between
 * attributes"), both enforced over the AST because neither survives into the
 * `Graph` this module returns.
 *
 * WHY THE PARSER AND NOT LINT. `lint()` takes a `Graph`, and a `Graph` has no
 * record of whether a literal was an HTML string, whether two attributes were
 * separated, whether the source said `graph` or `digraph`, or whether it said
 * `strict`. Those facts exist only between the text and the AST. Putting the
 * checks here is not a preference for throwing over diagnosing; it is the only
 * place the evidence still exists. The refusal is equivalent either way from
 * an operator's seat: `cli.ts` turns a lint ERROR into exit 1 via `hasErrors`,
 * and turns a thrown parse error into `attractor: <message>` and exit 1 via
 * the top-level catch. Section 2.3 says these are "rejected"; both mechanisms
 * reject, and this one is the one that can see them.
 *
 * The node-id constraint is checked in the walk instead, where the ids are
 * already extracted -- same refusal, no second traversal.
 */
function enforceLexicalSubset(n: AstAny, masked: string): void {
  for (const lit of [n.id, n.key, n.value]) {
    if (lit?.quoted === 'html') {
      throw new Error(
        'attractor: HTML strings are not part of the DOT subset (section 2.1: no HTML ' +
          `labels); rewrite <${String(lit.value)}> as a quoted string`,
      )
    }
  }

  // Only inside a `[ ... ]` block. A `Graph`'s or `Subgraph`'s direct
  // `Attribute` children are top-level `key = value` STATEMENTS (section 2.5),
  // which section 2.3's "semicolons optional" bullet governs instead.
  if (n.type === 'Node' || n.type === 'Edge' || n.type === 'AttributeList') {
    const attrs = (n.children ?? []).filter((c) => c.type === 'Attribute')
    for (let i = 0; i + 1 < attrs.length; i++) {
      // From the end of THIS attribute's value to the start of the next
      // attribute: measuring from the value's own end rather than from the
      // attribute's end is what stops a comma inside a quoted value from
      // counting as the separator, and `masked` is what stops one inside a
      // comment from counting.
      const from = attrs[i].value?.location?.end.offset
      const to = attrs[i + 1].location?.start.offset
      if (from === undefined || to === undefined) continue
      if (!masked.slice(from, to).includes(',')) {
        throw new Error(
          `attractor: attributes ${String(attrs[i].key?.value)} and ` +
            `${String(attrs[i + 1].key?.value)} are not separated by a comma ` +
            '(section 2.3: commas required between attributes)',
        )
      }
    }
  }

  for (const c of n.children ?? []) enforceLexicalSubset(c, masked)
}

/** Section 2.3's node-id constraint, applied wherever an id is read. */
function checkNodeId(id: string): string {
  if (!NODE_ID.test(id)) {
    throw new Error(
      `attractor: node id ${JSON.stringify(id)} is not a bare identifier ` +
        '(section 2.3: node ids must match [A-Za-z_][A-Za-z0-9_]*); ' +
        'put the human-readable name in the label attribute',
    )
  }
  return id
}

/**
 * The `node [...]` and `edge [...]` defaults in force at one point in the
 * walk, plus whether that point is the root graph.
 *
 * Spec section 2.10 scopes a subgraph's defaults to that subgraph, and
 * section 2.11 scopes every default block to "their scope". Entering a
 * subgraph therefore takes a COPY: it inherits what encloses it and nothing
 * it declares escapes back out.
 *
 * `isRootGraph` is carried here rather than derived, because it decides where
 * a bare `key = value` goes. Section 2.5: graph attributes are "declared in a
 * `graph [ ... ]` block or as TOP-LEVEL `key = value` declarations". A
 * subgraph's are neither, and merging them into the graph's map is how a
 * subgraph's `goal` used to replace the pipeline's -- silently rewriting
 * `$goal` in every prompt and the `graph.goal` key conditions route on.
 */
interface Scope {
  nodeDefaults: Record<string, string>
  edgeDefaults: Record<string, string>
  isRootGraph: boolean
}

function attributesOf(n: AstAny): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of n.children ?? []) {
    if (c.type === 'Attribute' && c.key && c.value !== undefined) {
      out[String(c.key.value)] = String(c.value.value)
    }
  }
  return out
}

/**
 * Fill in defaults without overriding anything already present.
 *
 * Object.hasOwn, not `k in target`: `in` walks the prototype chain, so for an
 * attribute named `toString`, `constructor`, `valueOf` or `hasOwnProperty`
 * the default is judged "already present" on a node that never declared it
 * and is silently DROPPED. Same class the branch already swept out of
 * `graph.ts` and `lint.ts`; the sweep missed the default-application loops
 * this function replaced.
 */
function fillDefaults(target: Record<string, string>, defaults: Record<string, string>): void {
  for (const [k, v] of Object.entries(defaults)) {
    if (!Object.hasOwn(target, k)) target[k] = v
  }
}

export function parseDot(src: string): Graph {
  assertNoPlaceholderCollision(src)
  const scanned = scan(src)
  const ast = parseAst(scanned.text) as unknown as AstAny
  restorePlaceholders(ast)
  enforceLexicalSubset(ast, scanned.masked)
  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  const graphAttrs: Record<string, string> = {}
  let name = ''

  /**
   * Create or extend a node, applying the defaults in force AT THIS POINT.
   *
   * Applying here rather than in a pass after the walk is what makes section
   * 2.11's "all SUBSEQUENT nodes" true: a default used to reach backwards and
   * attach itself to nodes declared before it.
   *
   * DOT semantics: repeated statements for one id ACCUMULATE attributes.
   * Replacing would silently discard a tool_command declared earlier. An
   * explicit attribute spread over the existing map also means a later
   * declaration wins over a default the node was born with -- a declaration
   * is not a default.
   */
  const upsertNode = (rawId: string, attrs: Record<string, string>, scope: Scope): void => {
    const id = checkNodeId(rawId)
    const existing = nodes.get(id)
    const merged = existing ? { ...existing.attrs, ...attrs } : { ...attrs }
    fillDefaults(merged, scope.nodeDefaults)
    // Defaults may have supplied the shape or type, so resolve the handler
    // from the attributes the node actually ended up with.
    nodes.set(id, { id, attrs: merged, handler: handlerForNode(merged, id) })
  }

  const walk = (parent: AstAny, scope: Scope): void => {
    for (const c of parent.children ?? []) {
      switch (c.type) {
        case 'Node': {
          upsertNode(String(c.id?.value ?? ''), attributesOf(c), scope)
          break
        }
        case 'Edge': {
          const ids = (c.targets ?? []).map((t) => {
            const id = t.id?.value
            if (id === undefined) {
              // A grouped target ({a; b} -> c) carries children, not an id.
              // Failing loudly beats inventing a phantom node with an empty id.
              throw new Error(
                'attractor: grouped edge targets ({a; b} -> c) are not supported; ' +
                  'write each edge explicitly',
              )
            }
            // Checked HERE and not only in upsertNode: an endpoint whose node
            // was already declared never reaches upsertNode, so an illegal id
            // would slip through on its second appearance.
            return checkNodeId(String(id))
          })
          const attrs = attributesOf(c)
          for (let i = 0; i < ids.length - 1; i++) {
            // Clone per edge: a chained statement must not alias one attrs
            // object across every edge it produces.
            const edgeAttrs = { ...attrs }
            // `edge [...]` defaults, at the point of declaration and in this
            // scope. Dropping these silently would lose a default `weight` or
            // `condition` and change routing with no signal.
            fillDefaults(edgeAttrs, scope.edgeDefaults)
            edges.push({ from: ids[i], to: ids[i + 1], attrs: edgeAttrs })
          }
          // Nodes that appear only inside edge statements are still real
          // nodes. Such a node has no declaration statement of its own, so
          // the edge statement IS its declaration point: it is created here
          // and takes the defaults in scope here. That matches what Graphviz
          // itself does with `subgraph { node [x]; a -> b }`, and it is the
          // only answer consistent with section 2.11's "subsequent ... within
          // their scope" -- the alternatives (no defaults at all, or whatever
          // the defaults happened to be at end of file) both make a node's
          // attributes depend on text that is not where the node appears.
          for (const id of ids) {
            if (!nodes.has(id)) upsertNode(id, {}, scope)
          }
          break
        }
        case 'Attribute': {
          // Only a TOP-LEVEL bare `key = value` is a graph attribute
          // (section 2.5). Inside a subgraph it belongs to the subgraph; we
          // implement nothing that reads one, so it is dropped rather than
          // merged into the graph's. Merging is what let a subgraph's `label`
          // -- which section 2.10 reserves for class derivation -- become the
          // graph's, and a subgraph's `goal` become the pipeline's.
          if (scope.isRootGraph && c.key && c.value !== undefined) {
            graphAttrs[String(c.key.value)] = String(c.value.value)
          }
          break
        }
        case 'AttributeList': {
          if (c.kind === 'Graph') {
            if (scope.isRootGraph) Object.assign(graphAttrs, attributesOf(c))
          } else if (c.kind === 'Node') Object.assign(scope.nodeDefaults, attributesOf(c))
          else if (c.kind === 'Edge') Object.assign(scope.edgeDefaults, attributesOf(c))
          break
        }
        case 'Subgraph': {
          // Copy in, nothing out: sections 2.10 and 2.11.
          walk(c, {
            nodeDefaults: { ...scope.nodeDefaults },
            edgeDefaults: { ...scope.edgeDefaults },
            isRootGraph: false,
          })
          break
        }
        default:
          if (c.children) walk(c, scope)
      }
    }
  }

  for (const top of ast.children ?? []) {
    if (top.type === 'Graph') {
      // Section 2.3: "Multiple graphs, undirected graphs, and `strict`
      // modifiers are rejected." Both facts live on the AST element and
      // nowhere in the `Graph` we return, so this is the last point either can
      // be seen.
      //
      // The undirected case was the most dangerous thing on this branch: a
      // `graph G { a -- b }` was not merely accepted, it was silently
      // REINTERPRETED as `a -> b` and executed, because this walk read the
      // edge's endpoints and never asked which operator joined them. The
      // upstream parser already refuses to mix operators with graph kinds, so
      // refusing an undirected graph refuses `--` with it.
      if (top.strict === true) {
        throw new Error(
          'attractor: the strict modifier is not part of the DOT subset ' +
            '(section 2.3: strict modifiers are rejected)',
        )
      }
      if (top.directed !== true) {
        throw new Error(
          'attractor: this is an undirected graph; the DOT subset accepts digraph only ' +
            '(section 2.3: undirected graphs are rejected, -> is the only edge operator)',
        )
      }
      // The multiple-graph half of that bullet needs no check here: the
      // upstream grammar's start rule accepts one graph and then end of input,
      // so a second `digraph` is already a syntax error before this loop runs.
      name = top.id ? String(top.id.value) : ''
      walk(top, { nodeDefaults: {}, edgeDefaults: {}, isRootGraph: true })
    }
  }

  return { name, attrs: graphAttrs, nodes, edges }
}
