#!/usr/bin/env node

// src/cli.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { randomUUID as randomUUID2 } from "node:crypto";
import { basename as basename2, resolve as resolve2 } from "node:path";

// node_modules/@ts-graphviz/common/lib/common.js
var RootModelsContext = Object.seal({
  // NOTE: RootModelsContext is also initialized after the model class is declared in the '@ts-graphviz/core/register-default' module.
  Graph: null,
  Digraph: null,
  Subgraph: null,
  Node: null,
  Edge: null
});

// node_modules/@ts-graphviz/ast/lib/ast.js
var ASTNodeCountExceededError = class extends Error {
  /**
   * Constructor
   * @param nodeCount - The current node count when the limit was exceeded
   * @param maxNodes - The maximum allowed node count
   */
  constructor(nodeCount, maxNodes) {
    super(
      `AST node count (${nodeCount}) exceeds maximum allowed (${maxNodes}). Consider increasing 'maxASTNodes' option or simplifying the input.`
    );
    this.nodeCount = nodeCount;
    this.maxNodes = maxNodes;
    this.name = "ASTNodeCountExceededError";
  }
};
var DEFAULT_MAX_AST_NODES = 1e5;
var Builder = class {
  /**
   * Constructor of Builder
   * @param options - Options to initialize Builder
   */
  constructor(options) {
    this.options = options;
    this.maxNodes = options?.maxASTNodes ?? DEFAULT_MAX_AST_NODES;
  }
  nodeCount = 0;
  maxNodes;
  /**
   * Get the current file range or null
   * @internal
   */
  getLocation() {
    return this.options?.locationFunction?.() ?? null;
  }
  /**
   * Create an {@link ASTNode} of the specified type
   *
   * @param type - Type of the {@link ASTNode}
   * @param props - Properties of the {@link ASTNode}
   * @param children - Children of the {@link ASTNode}
   * @returns An {@link ASTNode}
   * @throws {ASTNodeCountExceededError} if the maximum number of AST nodes is exceeded
   */
  createElement(type, props, children = []) {
    this.nodeCount++;
    if (this.maxNodes > 0 && this.nodeCount > this.maxNodes) {
      throw new ASTNodeCountExceededError(this.nodeCount, this.maxNodes);
    }
    return {
      location: this.getLocation(),
      ...props,
      type,
      children
    };
  }
  /**
   * Reset the node count. Used internally by the parser between parse invocations.
   * @internal
   */
  resetNodeCount() {
    this.nodeCount = 0;
  }
};
function createElementFactory(options) {
  const builder = new Builder(options);
  return builder.createElement.bind(builder);
}
var createElement = createElementFactory();
var peg$SyntaxError = class extends SyntaxError {
  constructor(message, expected, found, location) {
    super(message);
    this.expected = expected;
    this.found = found;
    this.location = location;
    this.name = "SyntaxError";
  }
  format(sources) {
    let str = "Error: " + this.message;
    if (this.location) {
      let src = null;
      const st = sources.find((s2) => s2.source === this.location.source);
      if (st) {
        src = st.text.split(/\r\n|\n|\r/g);
      }
      const s = this.location.start;
      const offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
      const loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
      if (src) {
        const e = this.location.end;
        const filler = "".padEnd(offset_s.line.toString().length, " ");
        const line = src[s.line - 1];
        const last = s.line === e.line ? e.column : line.length + 1;
        const hatLen = last - s.column || 1;
        str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + "".padEnd(s.column - 1, " ") + "".padEnd(hatLen, "^");
      } else {
        str += "\n at " + loc;
      }
    }
    return str;
  }
  static buildMessage(expected, found) {
    function hex(ch) {
      return ch.codePointAt(0).toString(16).toUpperCase();
    }
    const nonPrintable = Object.prototype.hasOwnProperty.call(RegExp.prototype, "unicode") ? new RegExp("[\\p{C}\\p{Mn}\\p{Mc}]", "gu") : null;
    function unicodeEscape(s) {
      if (nonPrintable) {
        return s.replace(nonPrintable, (ch) => "\\u{" + hex(ch) + "}");
      }
      return s;
    }
    function literalEscape(s) {
      return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
    }
    function classEscape(s) {
      return unicodeEscape(s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, (ch) => "\\x0" + hex(ch)).replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => "\\x" + hex(ch)));
    }
    const DESCRIBE_EXPECTATION_FNS = {
      literal(expectation) {
        return '"' + literalEscape(expectation.text) + '"';
      },
      class(expectation) {
        const escapedParts = expectation.parts.map(
          (part) => Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part)
        );
        return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]" + (expectation.unicode ? "u" : "");
      },
      any() {
        return "any character";
      },
      end() {
        return "end of input";
      },
      other(expectation) {
        return expectation.description;
      }
    };
    function describeExpectation(expectation) {
      return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
    }
    function describeExpected(expected2) {
      const descriptions = expected2.map(describeExpectation);
      descriptions.sort();
      if (descriptions.length > 0) {
        let j = 1;
        for (let i = 1; i < descriptions.length; i++) {
          if (descriptions[i - 1] !== descriptions[i]) {
            descriptions[j] = descriptions[i];
            j++;
          }
        }
        descriptions.length = j;
      }
      switch (descriptions.length) {
        case 1:
          return descriptions[0];
        case 2:
          return descriptions[0] + " or " + descriptions[1];
        default:
          return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
      }
    }
    function describeFound(found2) {
      return found2 ? '"' + literalEscape(found2) + '"' : "end of input";
    }
    return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
  }
};
function peg$parse(input, options) {
  options = options !== void 0 ? options : {};
  const peg$FAILED = {};
  const peg$source = options.grammarSource;
  const peg$startRuleFunctions = {
    Dot: peg$parseDot,
    Graph: peg$parseGraph,
    Subgraph: peg$parseSubgraph,
    Node: peg$parseNode,
    Edge: peg$parseEdge,
    AttributeList: peg$parseAttributeList,
    Attribute: peg$parseAttribute,
    ClusterStatements: peg$parseClusterStatements
  };
  let peg$startRuleFunction = peg$parseDot;
  const peg$c0 = "strict";
  const peg$c1 = "graph";
  const peg$c2 = "digraph";
  const peg$c3 = "{";
  const peg$c4 = "}";
  const peg$c6 = "node";
  const peg$c7 = "edge";
  const peg$c8 = "=";
  const peg$c9 = "[";
  const peg$c10 = "]";
  const peg$c11 = "->";
  const peg$c12 = "--";
  const peg$c13 = ":";
  const peg$c14 = "subgraph";
  const peg$c15 = "n";
  const peg$c16 = "ne";
  const peg$c17 = "e";
  const peg$c18 = "se";
  const peg$c19 = "s";
  const peg$c20 = "sw";
  const peg$c21 = "w";
  const peg$c22 = "nw";
  const peg$c23 = '"';
  const peg$c24 = "/*";
  const peg$c25 = "*/";
  const peg$c26 = "//";
  const peg$c27 = "#";
  const peg$c28 = "-";
  const peg$c29 = ".";
  const peg$c30 = "<";
  const peg$c31 = ">";
  const peg$c32 = "\\";
  const peg$c33 = "\n";
  const peg$c34 = "\r\n";
  const peg$r0 = /^[,;]/;
  const peg$r1 = /^[$A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376-\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06E5-\u06E6\u06EE-\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4-\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F-\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC-\u09DD\u09DF-\u09E1\u09F0-\u09F1\u0A05-\u0A0A\u0A0F-\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32-\u0A33\u0A35-\u0A36\u0A38-\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2-\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0-\u0AE1\u0B05-\u0B0C\u0B0F-\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32-\u0B33\u0B35-\u0B39\u0B3D\u0B5C-\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99-\u0B9A\u0B9C\u0B9E-\u0B9F\u0BA3-\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58-\u0C59\u0C60-\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0-\u0CE1\u0CF1-\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32-\u0E33\u0E40-\u0E46\u0E81-\u0E82\u0E84\u0E87-\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA-\u0EAB\u0EAD-\u0EB0\u0EB2-\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065-\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE-\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5-\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A-\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5-\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40-\uFB41\uFB43-\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/;
  const peg$r2 = /^[$0-9A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376-\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u0660-\u0669\u066E-\u066F\u0671-\u06D3\u06D5\u06E5-\u06E6\u06EE-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07C0-\u07EA\u07F4-\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F-\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC-\u09DD\u09DF-\u09E1\u09E6-\u09F1\u0A05-\u0A0A\u0A0F-\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32-\u0A33\u0A35-\u0A36\u0A38-\u0A39\u0A59-\u0A5C\u0A5E\u0A66-\u0A6F\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2-\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0-\u0AE1\u0AE6-\u0AEF\u0B05-\u0B0C\u0B0F-\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32-\u0B33\u0B35-\u0B39\u0B3D\u0B5C-\u0B5D\u0B5F-\u0B61\u0B66-\u0B6F\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99-\u0B9A\u0B9C\u0B9E-\u0B9F\u0BA3-\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0BE6-\u0BEF\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58-\u0C59\u0C60-\u0C61\u0C66-\u0C6F\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0-\u0CE1\u0CE6-\u0CEF\u0CF1-\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60-\u0D61\u0D66-\u0D6F\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32-\u0E33\u0E40-\u0E46\u0E50-\u0E59\u0E81-\u0E82\u0E84\u0E87-\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA-\u0EAB\u0EAD-\u0EB0\u0EB2-\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F20-\u0F29\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F-\u1049\u1050-\u1055\u105A-\u105D\u1061\u1065-\u1066\u106E-\u1070\u1075-\u1081\u108E\u1090-\u1099\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u17E0-\u17E9\u1810-\u1819\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u19D0-\u19D9\u1A00-\u1A16\u1A20-\u1A54\u1A80-\u1A89\u1A90-\u1A99\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B50-\u1B59\u1B83-\u1BA0\u1BAE-\u1BE5\u1C00-\u1C23\u1C40-\u1C49\u1C4D-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5-\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8D0-\uA8D9\uA8F2-\uA8F7\uA8FB\uA900-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF-\uA9D9\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5-\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40-\uFB41\uFB43-\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]/;
  const peg$r3 = /^[0-9]/;
  const peg$r4 = /^[<>]/;
  const peg$r5 = /^[\n\r"\u2028-\u2029]/;
  const peg$r6 = /^[\r\u2028-\u2029]/;
  const peg$r7 = /^[\t-\n\r ]/;
  const peg$r8 = /^[\n\r]/;
  const peg$r9 = /^[ \t]/;
  const peg$e0 = peg$literalExpectation("strict", true);
  const peg$e1 = peg$literalExpectation("graph", true);
  const peg$e2 = peg$literalExpectation("digraph", true);
  const peg$e3 = peg$literalExpectation("{", false);
  const peg$e4 = peg$literalExpectation("}", false);
  const peg$e5 = peg$literalExpectation(";", false);
  const peg$e6 = peg$literalExpectation("node", true);
  const peg$e7 = peg$literalExpectation("edge", true);
  const peg$e8 = peg$literalExpectation("=", false);
  const peg$e9 = peg$classExpectation([",", ";"], false, false, false);
  const peg$e10 = peg$literalExpectation("[", false);
  const peg$e11 = peg$literalExpectation("]", false);
  const peg$e12 = peg$literalExpectation("->", false);
  const peg$e13 = peg$literalExpectation("--", false);
  const peg$e14 = peg$otherExpectation("port");
  const peg$e15 = peg$literalExpectation(":", false);
  const peg$e16 = peg$literalExpectation("subgraph", true);
  const peg$e17 = peg$literalExpectation("n", false);
  const peg$e18 = peg$literalExpectation("ne", false);
  const peg$e19 = peg$literalExpectation("e", false);
  const peg$e20 = peg$literalExpectation("se", false);
  const peg$e21 = peg$literalExpectation("s", false);
  const peg$e22 = peg$literalExpectation("sw", false);
  const peg$e23 = peg$literalExpectation("w", false);
  const peg$e24 = peg$literalExpectation("nw", false);
  const peg$e25 = peg$literalExpectation('"', false);
  const peg$e26 = peg$literalExpectation("/*", false);
  const peg$e27 = peg$literalExpectation("*/", false);
  const peg$e28 = peg$anyExpectation();
  const peg$e29 = peg$literalExpectation("//", false);
  const peg$e30 = peg$literalExpectation("#", false);
  const peg$e31 = peg$otherExpectation("UNICODE_STRING");
  const peg$e32 = peg$classExpectation(["$", ["A", "Z"], "_", ["a", "z"], "\xAA", "\xB5", "\xBA", ["\xC0", "\xD6"], ["\xD8", "\xF6"], ["\xF8", "\u02C1"], ["\u02C6", "\u02D1"], ["\u02E0", "\u02E4"], "\u02EC", "\u02EE", ["\u0370", "\u0374"], ["\u0376", "\u0377"], ["\u037A", "\u037D"], "\u0386", ["\u0388", "\u038A"], "\u038C", ["\u038E", "\u03A1"], ["\u03A3", "\u03F5"], ["\u03F7", "\u0481"], ["\u048A", "\u0527"], ["\u0531", "\u0556"], "\u0559", ["\u0561", "\u0587"], ["\u05D0", "\u05EA"], ["\u05F0", "\u05F2"], ["\u0620", "\u064A"], ["\u066E", "\u066F"], ["\u0671", "\u06D3"], "\u06D5", ["\u06E5", "\u06E6"], ["\u06EE", "\u06EF"], ["\u06FA", "\u06FC"], "\u06FF", "\u0710", ["\u0712", "\u072F"], ["\u074D", "\u07A5"], "\u07B1", ["\u07CA", "\u07EA"], ["\u07F4", "\u07F5"], "\u07FA", ["\u0800", "\u0815"], "\u081A", "\u0824", "\u0828", ["\u0840", "\u0858"], "\u08A0", ["\u08A2", "\u08AC"], ["\u0904", "\u0939"], "\u093D", "\u0950", ["\u0958", "\u0961"], ["\u0971", "\u0977"], ["\u0979", "\u097F"], ["\u0985", "\u098C"], ["\u098F", "\u0990"], ["\u0993", "\u09A8"], ["\u09AA", "\u09B0"], "\u09B2", ["\u09B6", "\u09B9"], "\u09BD", "\u09CE", ["\u09DC", "\u09DD"], ["\u09DF", "\u09E1"], ["\u09F0", "\u09F1"], ["\u0A05", "\u0A0A"], ["\u0A0F", "\u0A10"], ["\u0A13", "\u0A28"], ["\u0A2A", "\u0A30"], ["\u0A32", "\u0A33"], ["\u0A35", "\u0A36"], ["\u0A38", "\u0A39"], ["\u0A59", "\u0A5C"], "\u0A5E", ["\u0A72", "\u0A74"], ["\u0A85", "\u0A8D"], ["\u0A8F", "\u0A91"], ["\u0A93", "\u0AA8"], ["\u0AAA", "\u0AB0"], ["\u0AB2", "\u0AB3"], ["\u0AB5", "\u0AB9"], "\u0ABD", "\u0AD0", ["\u0AE0", "\u0AE1"], ["\u0B05", "\u0B0C"], ["\u0B0F", "\u0B10"], ["\u0B13", "\u0B28"], ["\u0B2A", "\u0B30"], ["\u0B32", "\u0B33"], ["\u0B35", "\u0B39"], "\u0B3D", ["\u0B5C", "\u0B5D"], ["\u0B5F", "\u0B61"], "\u0B71", "\u0B83", ["\u0B85", "\u0B8A"], ["\u0B8E", "\u0B90"], ["\u0B92", "\u0B95"], ["\u0B99", "\u0B9A"], "\u0B9C", ["\u0B9E", "\u0B9F"], ["\u0BA3", "\u0BA4"], ["\u0BA8", "\u0BAA"], ["\u0BAE", "\u0BB9"], "\u0BD0", ["\u0C05", "\u0C0C"], ["\u0C0E", "\u0C10"], ["\u0C12", "\u0C28"], ["\u0C2A", "\u0C33"], ["\u0C35", "\u0C39"], "\u0C3D", ["\u0C58", "\u0C59"], ["\u0C60", "\u0C61"], ["\u0C85", "\u0C8C"], ["\u0C8E", "\u0C90"], ["\u0C92", "\u0CA8"], ["\u0CAA", "\u0CB3"], ["\u0CB5", "\u0CB9"], "\u0CBD", "\u0CDE", ["\u0CE0", "\u0CE1"], ["\u0CF1", "\u0CF2"], ["\u0D05", "\u0D0C"], ["\u0D0E", "\u0D10"], ["\u0D12", "\u0D3A"], "\u0D3D", "\u0D4E", ["\u0D60", "\u0D61"], ["\u0D7A", "\u0D7F"], ["\u0D85", "\u0D96"], ["\u0D9A", "\u0DB1"], ["\u0DB3", "\u0DBB"], "\u0DBD", ["\u0DC0", "\u0DC6"], ["\u0E01", "\u0E30"], ["\u0E32", "\u0E33"], ["\u0E40", "\u0E46"], ["\u0E81", "\u0E82"], "\u0E84", ["\u0E87", "\u0E88"], "\u0E8A", "\u0E8D", ["\u0E94", "\u0E97"], ["\u0E99", "\u0E9F"], ["\u0EA1", "\u0EA3"], "\u0EA5", "\u0EA7", ["\u0EAA", "\u0EAB"], ["\u0EAD", "\u0EB0"], ["\u0EB2", "\u0EB3"], "\u0EBD", ["\u0EC0", "\u0EC4"], "\u0EC6", ["\u0EDC", "\u0EDF"], "\u0F00", ["\u0F40", "\u0F47"], ["\u0F49", "\u0F6C"], ["\u0F88", "\u0F8C"], ["\u1000", "\u102A"], "\u103F", ["\u1050", "\u1055"], ["\u105A", "\u105D"], "\u1061", ["\u1065", "\u1066"], ["\u106E", "\u1070"], ["\u1075", "\u1081"], "\u108E", ["\u10A0", "\u10C5"], "\u10C7", "\u10CD", ["\u10D0", "\u10FA"], ["\u10FC", "\u1248"], ["\u124A", "\u124D"], ["\u1250", "\u1256"], "\u1258", ["\u125A", "\u125D"], ["\u1260", "\u1288"], ["\u128A", "\u128D"], ["\u1290", "\u12B0"], ["\u12B2", "\u12B5"], ["\u12B8", "\u12BE"], "\u12C0", ["\u12C2", "\u12C5"], ["\u12C8", "\u12D6"], ["\u12D8", "\u1310"], ["\u1312", "\u1315"], ["\u1318", "\u135A"], ["\u1380", "\u138F"], ["\u13A0", "\u13F4"], ["\u1401", "\u166C"], ["\u166F", "\u167F"], ["\u1681", "\u169A"], ["\u16A0", "\u16EA"], ["\u16EE", "\u16F0"], ["\u1700", "\u170C"], ["\u170E", "\u1711"], ["\u1720", "\u1731"], ["\u1740", "\u1751"], ["\u1760", "\u176C"], ["\u176E", "\u1770"], ["\u1780", "\u17B3"], "\u17D7", "\u17DC", ["\u1820", "\u1877"], ["\u1880", "\u18A8"], "\u18AA", ["\u18B0", "\u18F5"], ["\u1900", "\u191C"], ["\u1950", "\u196D"], ["\u1970", "\u1974"], ["\u1980", "\u19AB"], ["\u19C1", "\u19C7"], ["\u1A00", "\u1A16"], ["\u1A20", "\u1A54"], "\u1AA7", ["\u1B05", "\u1B33"], ["\u1B45", "\u1B4B"], ["\u1B83", "\u1BA0"], ["\u1BAE", "\u1BAF"], ["\u1BBA", "\u1BE5"], ["\u1C00", "\u1C23"], ["\u1C4D", "\u1C4F"], ["\u1C5A", "\u1C7D"], ["\u1CE9", "\u1CEC"], ["\u1CEE", "\u1CF1"], ["\u1CF5", "\u1CF6"], ["\u1D00", "\u1DBF"], ["\u1E00", "\u1F15"], ["\u1F18", "\u1F1D"], ["\u1F20", "\u1F45"], ["\u1F48", "\u1F4D"], ["\u1F50", "\u1F57"], "\u1F59", "\u1F5B", "\u1F5D", ["\u1F5F", "\u1F7D"], ["\u1F80", "\u1FB4"], ["\u1FB6", "\u1FBC"], "\u1FBE", ["\u1FC2", "\u1FC4"], ["\u1FC6", "\u1FCC"], ["\u1FD0", "\u1FD3"], ["\u1FD6", "\u1FDB"], ["\u1FE0", "\u1FEC"], ["\u1FF2", "\u1FF4"], ["\u1FF6", "\u1FFC"], "\u2071", "\u207F", ["\u2090", "\u209C"], "\u2102", "\u2107", ["\u210A", "\u2113"], "\u2115", ["\u2119", "\u211D"], "\u2124", "\u2126", "\u2128", ["\u212A", "\u212D"], ["\u212F", "\u2139"], ["\u213C", "\u213F"], ["\u2145", "\u2149"], "\u214E", ["\u2160", "\u2188"], ["\u2C00", "\u2C2E"], ["\u2C30", "\u2C5E"], ["\u2C60", "\u2CE4"], ["\u2CEB", "\u2CEE"], ["\u2CF2", "\u2CF3"], ["\u2D00", "\u2D25"], "\u2D27", "\u2D2D", ["\u2D30", "\u2D67"], "\u2D6F", ["\u2D80", "\u2D96"], ["\u2DA0", "\u2DA6"], ["\u2DA8", "\u2DAE"], ["\u2DB0", "\u2DB6"], ["\u2DB8", "\u2DBE"], ["\u2DC0", "\u2DC6"], ["\u2DC8", "\u2DCE"], ["\u2DD0", "\u2DD6"], ["\u2DD8", "\u2DDE"], "\u2E2F", ["\u3005", "\u3007"], ["\u3021", "\u3029"], ["\u3031", "\u3035"], ["\u3038", "\u303C"], ["\u3041", "\u3096"], ["\u309D", "\u309F"], ["\u30A1", "\u30FA"], ["\u30FC", "\u30FF"], ["\u3105", "\u312D"], ["\u3131", "\u318E"], ["\u31A0", "\u31BA"], ["\u31F0", "\u31FF"], ["\u3400", "\u4DB5"], ["\u4E00", "\u9FCC"], ["\uA000", "\uA48C"], ["\uA4D0", "\uA4FD"], ["\uA500", "\uA60C"], ["\uA610", "\uA61F"], ["\uA62A", "\uA62B"], ["\uA640", "\uA66E"], ["\uA67F", "\uA697"], ["\uA6A0", "\uA6EF"], ["\uA717", "\uA71F"], ["\uA722", "\uA788"], ["\uA78B", "\uA78E"], ["\uA790", "\uA793"], ["\uA7A0", "\uA7AA"], ["\uA7F8", "\uA801"], ["\uA803", "\uA805"], ["\uA807", "\uA80A"], ["\uA80C", "\uA822"], ["\uA840", "\uA873"], ["\uA882", "\uA8B3"], ["\uA8F2", "\uA8F7"], "\uA8FB", ["\uA90A", "\uA925"], ["\uA930", "\uA946"], ["\uA960", "\uA97C"], ["\uA984", "\uA9B2"], "\uA9CF", ["\uAA00", "\uAA28"], ["\uAA40", "\uAA42"], ["\uAA44", "\uAA4B"], ["\uAA60", "\uAA76"], "\uAA7A", ["\uAA80", "\uAAAF"], "\uAAB1", ["\uAAB5", "\uAAB6"], ["\uAAB9", "\uAABD"], "\uAAC0", "\uAAC2", ["\uAADB", "\uAADD"], ["\uAAE0", "\uAAEA"], ["\uAAF2", "\uAAF4"], ["\uAB01", "\uAB06"], ["\uAB09", "\uAB0E"], ["\uAB11", "\uAB16"], ["\uAB20", "\uAB26"], ["\uAB28", "\uAB2E"], ["\uABC0", "\uABE2"], ["\uAC00", "\uD7A3"], ["\uD7B0", "\uD7C6"], ["\uD7CB", "\uD7FB"], ["\uF900", "\uFA6D"], ["\uFA70", "\uFAD9"], ["\uFB00", "\uFB06"], ["\uFB13", "\uFB17"], "\uFB1D", ["\uFB1F", "\uFB28"], ["\uFB2A", "\uFB36"], ["\uFB38", "\uFB3C"], "\uFB3E", ["\uFB40", "\uFB41"], ["\uFB43", "\uFB44"], ["\uFB46", "\uFBB1"], ["\uFBD3", "\uFD3D"], ["\uFD50", "\uFD8F"], ["\uFD92", "\uFDC7"], ["\uFDF0", "\uFDFB"], ["\uFE70", "\uFE74"], ["\uFE76", "\uFEFC"], ["\uFF21", "\uFF3A"], ["\uFF41", "\uFF5A"], ["\uFF66", "\uFFBE"], ["\uFFC2", "\uFFC7"], ["\uFFCA", "\uFFCF"], ["\uFFD2", "\uFFD7"], ["\uFFDA", "\uFFDC"]], false, false, false);
  const peg$e33 = peg$classExpectation(["$", ["0", "9"], ["A", "Z"], "_", ["a", "z"], "\xAA", "\xB5", "\xBA", ["\xC0", "\xD6"], ["\xD8", "\xF6"], ["\xF8", "\u02C1"], ["\u02C6", "\u02D1"], ["\u02E0", "\u02E4"], "\u02EC", "\u02EE", ["\u0370", "\u0374"], ["\u0376", "\u0377"], ["\u037A", "\u037D"], "\u0386", ["\u0388", "\u038A"], "\u038C", ["\u038E", "\u03A1"], ["\u03A3", "\u03F5"], ["\u03F7", "\u0481"], ["\u048A", "\u0527"], ["\u0531", "\u0556"], "\u0559", ["\u0561", "\u0587"], ["\u05D0", "\u05EA"], ["\u05F0", "\u05F2"], ["\u0620", "\u064A"], ["\u0660", "\u0669"], ["\u066E", "\u066F"], ["\u0671", "\u06D3"], "\u06D5", ["\u06E5", "\u06E6"], ["\u06EE", "\u06FC"], "\u06FF", "\u0710", ["\u0712", "\u072F"], ["\u074D", "\u07A5"], "\u07B1", ["\u07C0", "\u07EA"], ["\u07F4", "\u07F5"], "\u07FA", ["\u0800", "\u0815"], "\u081A", "\u0824", "\u0828", ["\u0840", "\u0858"], "\u08A0", ["\u08A2", "\u08AC"], ["\u0904", "\u0939"], "\u093D", "\u0950", ["\u0958", "\u0961"], ["\u0966", "\u096F"], ["\u0971", "\u0977"], ["\u0979", "\u097F"], ["\u0985", "\u098C"], ["\u098F", "\u0990"], ["\u0993", "\u09A8"], ["\u09AA", "\u09B0"], "\u09B2", ["\u09B6", "\u09B9"], "\u09BD", "\u09CE", ["\u09DC", "\u09DD"], ["\u09DF", "\u09E1"], ["\u09E6", "\u09F1"], ["\u0A05", "\u0A0A"], ["\u0A0F", "\u0A10"], ["\u0A13", "\u0A28"], ["\u0A2A", "\u0A30"], ["\u0A32", "\u0A33"], ["\u0A35", "\u0A36"], ["\u0A38", "\u0A39"], ["\u0A59", "\u0A5C"], "\u0A5E", ["\u0A66", "\u0A6F"], ["\u0A72", "\u0A74"], ["\u0A85", "\u0A8D"], ["\u0A8F", "\u0A91"], ["\u0A93", "\u0AA8"], ["\u0AAA", "\u0AB0"], ["\u0AB2", "\u0AB3"], ["\u0AB5", "\u0AB9"], "\u0ABD", "\u0AD0", ["\u0AE0", "\u0AE1"], ["\u0AE6", "\u0AEF"], ["\u0B05", "\u0B0C"], ["\u0B0F", "\u0B10"], ["\u0B13", "\u0B28"], ["\u0B2A", "\u0B30"], ["\u0B32", "\u0B33"], ["\u0B35", "\u0B39"], "\u0B3D", ["\u0B5C", "\u0B5D"], ["\u0B5F", "\u0B61"], ["\u0B66", "\u0B6F"], "\u0B71", "\u0B83", ["\u0B85", "\u0B8A"], ["\u0B8E", "\u0B90"], ["\u0B92", "\u0B95"], ["\u0B99", "\u0B9A"], "\u0B9C", ["\u0B9E", "\u0B9F"], ["\u0BA3", "\u0BA4"], ["\u0BA8", "\u0BAA"], ["\u0BAE", "\u0BB9"], "\u0BD0", ["\u0BE6", "\u0BEF"], ["\u0C05", "\u0C0C"], ["\u0C0E", "\u0C10"], ["\u0C12", "\u0C28"], ["\u0C2A", "\u0C33"], ["\u0C35", "\u0C39"], "\u0C3D", ["\u0C58", "\u0C59"], ["\u0C60", "\u0C61"], ["\u0C66", "\u0C6F"], ["\u0C85", "\u0C8C"], ["\u0C8E", "\u0C90"], ["\u0C92", "\u0CA8"], ["\u0CAA", "\u0CB3"], ["\u0CB5", "\u0CB9"], "\u0CBD", "\u0CDE", ["\u0CE0", "\u0CE1"], ["\u0CE6", "\u0CEF"], ["\u0CF1", "\u0CF2"], ["\u0D05", "\u0D0C"], ["\u0D0E", "\u0D10"], ["\u0D12", "\u0D3A"], "\u0D3D", "\u0D4E", ["\u0D60", "\u0D61"], ["\u0D66", "\u0D6F"], ["\u0D7A", "\u0D7F"], ["\u0D85", "\u0D96"], ["\u0D9A", "\u0DB1"], ["\u0DB3", "\u0DBB"], "\u0DBD", ["\u0DC0", "\u0DC6"], ["\u0E01", "\u0E30"], ["\u0E32", "\u0E33"], ["\u0E40", "\u0E46"], ["\u0E50", "\u0E59"], ["\u0E81", "\u0E82"], "\u0E84", ["\u0E87", "\u0E88"], "\u0E8A", "\u0E8D", ["\u0E94", "\u0E97"], ["\u0E99", "\u0E9F"], ["\u0EA1", "\u0EA3"], "\u0EA5", "\u0EA7", ["\u0EAA", "\u0EAB"], ["\u0EAD", "\u0EB0"], ["\u0EB2", "\u0EB3"], "\u0EBD", ["\u0EC0", "\u0EC4"], "\u0EC6", ["\u0ED0", "\u0ED9"], ["\u0EDC", "\u0EDF"], "\u0F00", ["\u0F20", "\u0F29"], ["\u0F40", "\u0F47"], ["\u0F49", "\u0F6C"], ["\u0F88", "\u0F8C"], ["\u1000", "\u102A"], ["\u103F", "\u1049"], ["\u1050", "\u1055"], ["\u105A", "\u105D"], "\u1061", ["\u1065", "\u1066"], ["\u106E", "\u1070"], ["\u1075", "\u1081"], "\u108E", ["\u1090", "\u1099"], ["\u10A0", "\u10C5"], "\u10C7", "\u10CD", ["\u10D0", "\u10FA"], ["\u10FC", "\u1248"], ["\u124A", "\u124D"], ["\u1250", "\u1256"], "\u1258", ["\u125A", "\u125D"], ["\u1260", "\u1288"], ["\u128A", "\u128D"], ["\u1290", "\u12B0"], ["\u12B2", "\u12B5"], ["\u12B8", "\u12BE"], "\u12C0", ["\u12C2", "\u12C5"], ["\u12C8", "\u12D6"], ["\u12D8", "\u1310"], ["\u1312", "\u1315"], ["\u1318", "\u135A"], ["\u1380", "\u138F"], ["\u13A0", "\u13F4"], ["\u1401", "\u166C"], ["\u166F", "\u167F"], ["\u1681", "\u169A"], ["\u16A0", "\u16EA"], ["\u16EE", "\u16F0"], ["\u1700", "\u170C"], ["\u170E", "\u1711"], ["\u1720", "\u1731"], ["\u1740", "\u1751"], ["\u1760", "\u176C"], ["\u176E", "\u1770"], ["\u1780", "\u17B3"], "\u17D7", "\u17DC", ["\u17E0", "\u17E9"], ["\u1810", "\u1819"], ["\u1820", "\u1877"], ["\u1880", "\u18A8"], "\u18AA", ["\u18B0", "\u18F5"], ["\u1900", "\u191C"], ["\u1946", "\u196D"], ["\u1970", "\u1974"], ["\u1980", "\u19AB"], ["\u19C1", "\u19C7"], ["\u19D0", "\u19D9"], ["\u1A00", "\u1A16"], ["\u1A20", "\u1A54"], ["\u1A80", "\u1A89"], ["\u1A90", "\u1A99"], "\u1AA7", ["\u1B05", "\u1B33"], ["\u1B45", "\u1B4B"], ["\u1B50", "\u1B59"], ["\u1B83", "\u1BA0"], ["\u1BAE", "\u1BE5"], ["\u1C00", "\u1C23"], ["\u1C40", "\u1C49"], ["\u1C4D", "\u1C7D"], ["\u1CE9", "\u1CEC"], ["\u1CEE", "\u1CF1"], ["\u1CF5", "\u1CF6"], ["\u1D00", "\u1DBF"], ["\u1E00", "\u1F15"], ["\u1F18", "\u1F1D"], ["\u1F20", "\u1F45"], ["\u1F48", "\u1F4D"], ["\u1F50", "\u1F57"], "\u1F59", "\u1F5B", "\u1F5D", ["\u1F5F", "\u1F7D"], ["\u1F80", "\u1FB4"], ["\u1FB6", "\u1FBC"], "\u1FBE", ["\u1FC2", "\u1FC4"], ["\u1FC6", "\u1FCC"], ["\u1FD0", "\u1FD3"], ["\u1FD6", "\u1FDB"], ["\u1FE0", "\u1FEC"], ["\u1FF2", "\u1FF4"], ["\u1FF6", "\u1FFC"], "\u2071", "\u207F", ["\u2090", "\u209C"], "\u2102", "\u2107", ["\u210A", "\u2113"], "\u2115", ["\u2119", "\u211D"], "\u2124", "\u2126", "\u2128", ["\u212A", "\u212D"], ["\u212F", "\u2139"], ["\u213C", "\u213F"], ["\u2145", "\u2149"], "\u214E", ["\u2160", "\u2188"], ["\u2C00", "\u2C2E"], ["\u2C30", "\u2C5E"], ["\u2C60", "\u2CE4"], ["\u2CEB", "\u2CEE"], ["\u2CF2", "\u2CF3"], ["\u2D00", "\u2D25"], "\u2D27", "\u2D2D", ["\u2D30", "\u2D67"], "\u2D6F", ["\u2D80", "\u2D96"], ["\u2DA0", "\u2DA6"], ["\u2DA8", "\u2DAE"], ["\u2DB0", "\u2DB6"], ["\u2DB8", "\u2DBE"], ["\u2DC0", "\u2DC6"], ["\u2DC8", "\u2DCE"], ["\u2DD0", "\u2DD6"], ["\u2DD8", "\u2DDE"], "\u2E2F", ["\u3005", "\u3007"], ["\u3021", "\u3029"], ["\u3031", "\u3035"], ["\u3038", "\u303C"], ["\u3041", "\u3096"], ["\u309D", "\u309F"], ["\u30A1", "\u30FA"], ["\u30FC", "\u30FF"], ["\u3105", "\u312D"], ["\u3131", "\u318E"], ["\u31A0", "\u31BA"], ["\u31F0", "\u31FF"], ["\u3400", "\u4DB5"], ["\u4E00", "\u9FCC"], ["\uA000", "\uA48C"], ["\uA4D0", "\uA4FD"], ["\uA500", "\uA60C"], ["\uA610", "\uA62B"], ["\uA640", "\uA66E"], ["\uA67F", "\uA697"], ["\uA6A0", "\uA6EF"], ["\uA717", "\uA71F"], ["\uA722", "\uA788"], ["\uA78B", "\uA78E"], ["\uA790", "\uA793"], ["\uA7A0", "\uA7AA"], ["\uA7F8", "\uA801"], ["\uA803", "\uA805"], ["\uA807", "\uA80A"], ["\uA80C", "\uA822"], ["\uA840", "\uA873"], ["\uA882", "\uA8B3"], ["\uA8D0", "\uA8D9"], ["\uA8F2", "\uA8F7"], "\uA8FB", ["\uA900", "\uA925"], ["\uA930", "\uA946"], ["\uA960", "\uA97C"], ["\uA984", "\uA9B2"], ["\uA9CF", "\uA9D9"], ["\uAA00", "\uAA28"], ["\uAA40", "\uAA42"], ["\uAA44", "\uAA4B"], ["\uAA50", "\uAA59"], ["\uAA60", "\uAA76"], "\uAA7A", ["\uAA80", "\uAAAF"], "\uAAB1", ["\uAAB5", "\uAAB6"], ["\uAAB9", "\uAABD"], "\uAAC0", "\uAAC2", ["\uAADB", "\uAADD"], ["\uAAE0", "\uAAEA"], ["\uAAF2", "\uAAF4"], ["\uAB01", "\uAB06"], ["\uAB09", "\uAB0E"], ["\uAB11", "\uAB16"], ["\uAB20", "\uAB26"], ["\uAB28", "\uAB2E"], ["\uABC0", "\uABE2"], ["\uABF0", "\uABF9"], ["\uAC00", "\uD7A3"], ["\uD7B0", "\uD7C6"], ["\uD7CB", "\uD7FB"], ["\uF900", "\uFA6D"], ["\uFA70", "\uFAD9"], ["\uFB00", "\uFB06"], ["\uFB13", "\uFB17"], "\uFB1D", ["\uFB1F", "\uFB28"], ["\uFB2A", "\uFB36"], ["\uFB38", "\uFB3C"], "\uFB3E", ["\uFB40", "\uFB41"], ["\uFB43", "\uFB44"], ["\uFB46", "\uFBB1"], ["\uFBD3", "\uFD3D"], ["\uFD50", "\uFD8F"], ["\uFD92", "\uFDC7"], ["\uFDF0", "\uFDFB"], ["\uFE70", "\uFE74"], ["\uFE76", "\uFEFC"], ["\uFF10", "\uFF19"], ["\uFF21", "\uFF3A"], ["\uFF41", "\uFF5A"], ["\uFF66", "\uFFBE"], ["\uFFC2", "\uFFC7"], ["\uFFCA", "\uFFCF"], ["\uFFD2", "\uFFD7"], ["\uFFDA", "\uFFDC"]], false, false, false);
  const peg$e34 = peg$otherExpectation("NUMBER");
  const peg$e35 = peg$literalExpectation("-", false);
  const peg$e36 = peg$literalExpectation(".", false);
  const peg$e37 = peg$classExpectation([["0", "9"]], false, false, false);
  const peg$e38 = peg$literalExpectation("<", false);
  const peg$e39 = peg$literalExpectation(">", false);
  const peg$e40 = peg$classExpectation(["<", ">"], false, false, false);
  const peg$e41 = peg$classExpectation(["\n", "\r", '"', ["\u2028", "\u2029"]], false, false, false);
  const peg$e42 = peg$literalExpectation("\\", false);
  const peg$e43 = peg$otherExpectation("end of line");
  const peg$e44 = peg$literalExpectation("\n", false);
  const peg$e45 = peg$literalExpectation("\r\n", false);
  const peg$e46 = peg$classExpectation(["\r", ["\u2028", "\u2029"]], false, false, false);
  const peg$e47 = peg$classExpectation([["	", "\n"], "\r", " "], false, false, false);
  const peg$e48 = peg$classExpectation(["\n", "\r"], false, false, false);
  const peg$e49 = peg$classExpectation([" ", "	"], false, false, false);
  function peg$f0(v) {
    return v;
  }
  function peg$f1(v) {
    return v;
  }
  function peg$f2(v) {
    return v;
  }
  function peg$f3(v) {
    return v;
  }
  function peg$f4(v) {
    return v;
  }
  function peg$f5(v) {
    return v;
  }
  function peg$f6(v) {
    return v;
  }
  function peg$f7(v) {
    return v;
  }
  function peg$f8(v) {
    return v;
  }
  function peg$f9(v) {
    return v;
  }
  function peg$f10(c1, graph, c2) {
    return b.createElement("Dot", {}, [...c1, graph, ...c2]);
  }
  function peg$f11(_strict, _kind, id, children) {
    const strict = !!_strict;
    const kind = _kind.toLowerCase();
    const directed = kind === "digraph";
    for (const edgeop of edgeops) {
      if (directed) {
        if (edgeop.operator !== "->") {
          error(`In digraph, it's necessary to describe with "->" operator to create edge.`, edgeop.location);
        }
      } else {
        if (edgeop.operator !== "--") {
          error(`In graph, it's necessary to describe with "--" operator to create edge.`, edgeop.location);
        }
      }
    }
    return b.createElement(
      "Graph",
      id !== null ? {
        id,
        directed,
        strict
      } : {
        directed,
        strict
      },
      children
    );
  }
  function peg$f12(keyValue) {
    return b.createElement(
      "Attribute",
      {
        ...keyValue
      },
      []
    );
  }
  function peg$f13(_kind, children) {
    return b.createElement(
      "AttributeList",
      {
        kind: `${_kind.slice(0, 1).toUpperCase()}${_kind.slice(1).toLowerCase()}`
      },
      children
    );
  }
  function peg$f14(id, rhs, _children) {
    edgeChainDepth = 0;
    return b.createElement(
      // @ts-ignore
      "Edge",
      {
        targets: [id, ...rhs]
      },
      _children ?? []
    );
  }
  function peg$f15(id, _children) {
    return b.createElement(
      "Node",
      {
        id
      },
      _children ?? []
    );
  }
  function peg$f16(key, value) {
    return { key, value };
  }
  function peg$f17(kv) {
    return b.createElement(
      "Attribute",
      {
        ...kv,
        location: location()
      },
      []
    );
  }
  function peg$f18(list) {
    return list;
  }
  function peg$f19(id, v) {
    return v;
  }
  function peg$f20(id, rest) {
    return b.createElement("NodeRefGroup", {}, [id, ...rest]);
  }
  function peg$f21(operator) {
    return { operator, location: location() };
  }
  function peg$f22(edgeop, id, rest) {
    edgeChainDepth++;
    if (edgeChainDepth > MAX_EDGE_CHAIN_DEPTH) {
      const loc = location();
      error(
        `Edge chain depth exceeds maximum allowed depth of ${MAX_EDGE_CHAIN_DEPTH} at line ${loc.start.line}, column ${loc.start.column}. Consider breaking up long edge chains or increasing the 'maxEdgeChainDepth' option.`
      );
    }
    edgeops.push(edgeop);
    return [id].concat(rest || []);
  }
  function peg$f23(id, port) {
    return b.createElement(
      "NodeRef",
      {
        id,
        ...port
      },
      []
    );
  }
  function peg$f24(port, compass) {
    return compass;
  }
  function peg$f25(port, compass) {
    if (["n", "ne", "e", "se", "s", "sw", "w", "nw"].includes(port)) {
      return { compass: port };
    } else if (compass) {
      return { port, compass };
    }
    return { port };
  }
  function peg$f26(id) {
    return id;
  }
  function peg$f27(id, _children) {
    const children = _children ?? [];
    return b.createElement("Subgraph", id ? { id } : {}, children);
  }
  function peg$f28(value) {
    return { value, quoted: false };
  }
  function peg$f29(value) {
    return { value, quoted: true };
  }
  function peg$f30(v) {
    return b.createElement(
      "Literal",
      {
        ...v
      },
      []
    );
  }
  function peg$f31(value) {
    return b.createElement(
      "Literal",
      {
        value,
        quoted: false
      },
      []
    );
  }
  function peg$f32(v) {
    return v;
  }
  function peg$f33(v) {
    return b.createElement(
      "Comment",
      {
        kind: "Block",
        value: dedent(v.join("").replace(/[ \t]*\*/g, ""))
      },
      []
    );
  }
  function peg$f34(lines) {
    return b.createElement(
      "Comment",
      {
        kind: "Slash",
        value: dedent(lines.join("\n"))
      },
      []
    );
  }
  function peg$f35(v) {
    return v;
  }
  function peg$f36(v) {
    return v.join("");
  }
  function peg$f37(lines) {
    return b.createElement(
      "Comment",
      {
        kind: "Macro",
        value: dedent(lines.join("\n"))
      },
      []
    );
  }
  function peg$f38(v) {
    return v;
  }
  function peg$f39(v) {
    return v.join("");
  }
  function peg$f40(first, rest) {
    return first + rest.join("");
  }
  function peg$f41(first, rest) {
    return first + rest;
  }
  function peg$f42(n) {
    return text();
  }
  function peg$f43(v) {
    return b.createElement(
      "Literal",
      {
        value: v.slice(1, v.length - 1),
        quoted: "html"
      },
      []
    );
  }
  function peg$f44() {
    if (htmlNestingDepth >= MAX_HTML_NESTING_DEPTH) {
      error(`HTML nesting depth exceeds maximum allowed depth of ${MAX_HTML_NESTING_DEPTH}`);
    }
    htmlNestingDepth++;
    return true;
  }
  function peg$f45(v) {
    htmlNestingDepth--;
    return "<" + v.join("") + ">";
  }
  function peg$f46(v) {
    return v;
  }
  function peg$f47(v) {
    return v.join("");
  }
  function peg$f48(chars) {
    return b.createElement(
      "Literal",
      {
        value: chars.join(""),
        quoted: true
      },
      []
    );
  }
  function peg$f49() {
    return text();
  }
  function peg$f50(v) {
    return v[1] === '"' ? '"' : v[0] + v[1];
  }
  function peg$f51() {
    return "";
  }
  let peg$currPos = options.peg$currPos | 0;
  let peg$savedPos = peg$currPos;
  const peg$posDetailsCache = [{ line: 1, column: 1 }];
  let peg$maxFailPos = peg$currPos;
  let peg$maxFailExpected = options.peg$maxFailExpected || [];
  let peg$silentFails = options.peg$silentFails | 0;
  let peg$result;
  if (options.startRule) {
    if (!(options.startRule in peg$startRuleFunctions)) {
      throw new Error(`Can't start parsing from rule "` + options.startRule + '".');
    }
    peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
  }
  function text() {
    return input.substring(peg$savedPos, peg$currPos);
  }
  function location() {
    return peg$computeLocation(peg$savedPos, peg$currPos);
  }
  function error(message, location2) {
    location2 = location2 !== void 0 ? location2 : peg$computeLocation(peg$savedPos, peg$currPos);
    throw peg$buildSimpleError(message, location2);
  }
  function peg$getUnicode(pos = peg$currPos) {
    const cp = input.codePointAt(pos);
    if (cp === void 0) {
      return "";
    }
    return String.fromCodePoint(cp);
  }
  function peg$literalExpectation(text2, ignoreCase) {
    return { type: "literal", text: text2, ignoreCase };
  }
  function peg$classExpectation(parts, inverted, ignoreCase, unicode) {
    return { type: "class", parts, inverted, ignoreCase, unicode };
  }
  function peg$anyExpectation() {
    return { type: "any" };
  }
  function peg$endExpectation() {
    return { type: "end" };
  }
  function peg$otherExpectation(description) {
    return { type: "other", description };
  }
  function peg$computePosDetails(pos) {
    let details = peg$posDetailsCache[pos];
    let p;
    if (details) {
      return details;
    } else {
      if (pos >= peg$posDetailsCache.length) {
        p = peg$posDetailsCache.length - 1;
      } else {
        p = pos;
        while (!peg$posDetailsCache[--p]) {
        }
      }
      details = peg$posDetailsCache[p];
      details = {
        line: details.line,
        column: details.column
      };
      while (p < pos) {
        if (input.charCodeAt(p) === 10) {
          details.line++;
          details.column = 1;
        } else {
          details.column++;
        }
        p++;
      }
      peg$posDetailsCache[pos] = details;
      return details;
    }
  }
  function peg$computeLocation(startPos, endPos, offset) {
    const startPosDetails = peg$computePosDetails(startPos);
    const endPosDetails = peg$computePosDetails(endPos);
    const res = {
      source: peg$source,
      start: {
        offset: startPos,
        line: startPosDetails.line,
        column: startPosDetails.column
      },
      end: {
        offset: endPos,
        line: endPosDetails.line,
        column: endPosDetails.column
      }
    };
    return res;
  }
  function peg$fail(expected) {
    if (peg$currPos < peg$maxFailPos) {
      return;
    }
    if (peg$currPos > peg$maxFailPos) {
      peg$maxFailPos = peg$currPos;
      peg$maxFailExpected = [];
    }
    peg$maxFailExpected.push(expected);
  }
  function peg$buildSimpleError(message, location2) {
    return new peg$SyntaxError(message, null, null, location2);
  }
  function peg$buildStructuredError(expected, found, location2) {
    return new peg$SyntaxError(
      peg$SyntaxError.buildMessage(expected, found),
      expected,
      found,
      location2
    );
  }
  function peg$parseDot() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_dot();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f0(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseGraph() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_graph();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f1(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseNode() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_node();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f2(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseAttributeList() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_attributes();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f3(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseAttribute() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_attribute();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f4(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseEdge() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_edge();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f5(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseSubgraph() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_subgraph();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f6(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseNodeRef() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_node_ref();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f7(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseAttibutesItem() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_attibutes_item();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f8(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseComment() {
    let s0, s2;
    s0 = peg$currPos;
    peg$parse__();
    s2 = peg$parse_comment();
    if (s2 !== peg$FAILED) {
      peg$parse__();
      peg$savedPos = s0;
      s0 = peg$f9(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseClusterStatements() {
    let s0, s1;
    s0 = [];
    s1 = peg$parseAttribute();
    if (s1 === peg$FAILED) {
      s1 = peg$parseAttributeList();
      if (s1 === peg$FAILED) {
        s1 = peg$parseEdge();
        if (s1 === peg$FAILED) {
          s1 = peg$parseSubgraph();
          if (s1 === peg$FAILED) {
            s1 = peg$parseNode();
            if (s1 === peg$FAILED) {
              s1 = peg$parseComment();
            }
          }
        }
      }
    }
    while (s1 !== peg$FAILED) {
      s0.push(s1);
      s1 = peg$parseAttribute();
      if (s1 === peg$FAILED) {
        s1 = peg$parseAttributeList();
        if (s1 === peg$FAILED) {
          s1 = peg$parseEdge();
          if (s1 === peg$FAILED) {
            s1 = peg$parseSubgraph();
            if (s1 === peg$FAILED) {
              s1 = peg$parseNode();
              if (s1 === peg$FAILED) {
                s1 = peg$parseComment();
              }
            }
          }
        }
      }
    }
    return s0;
  }
  function peg$parse_dot() {
    let s0, s1, s2, s3, s4;
    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseComment();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseComment();
    }
    s2 = peg$parseGraph();
    if (s2 !== peg$FAILED) {
      s3 = [];
      s4 = peg$parseComment();
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseComment();
      }
      peg$savedPos = s0;
      s0 = peg$f10(s1, s2, s3);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_graph() {
    let s0, s1, s3, s5, s7, s8, s10;
    s0 = peg$currPos;
    s1 = input.substr(peg$currPos, 6);
    if (s1.toLowerCase() === peg$c0) {
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e0);
      }
    }
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    peg$parse_();
    s3 = input.substr(peg$currPos, 5);
    if (s3.toLowerCase() === peg$c1) {
      peg$currPos += 5;
    } else {
      s3 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e1);
      }
    }
    if (s3 === peg$FAILED) {
      s3 = input.substr(peg$currPos, 7);
      if (s3.toLowerCase() === peg$c2) {
        peg$currPos += 7;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e2);
        }
      }
    }
    if (s3 !== peg$FAILED) {
      peg$parse_();
      s5 = peg$parse_literal();
      if (s5 === peg$FAILED) {
        s5 = null;
      }
      peg$parse__();
      if (input.charCodeAt(peg$currPos) === 123) {
        s7 = peg$c3;
        peg$currPos++;
      } else {
        s7 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e3);
        }
      }
      if (s7 !== peg$FAILED) {
        s8 = peg$parseClusterStatements();
        peg$parse__();
        if (input.charCodeAt(peg$currPos) === 125) {
          s10 = peg$c4;
          peg$currPos++;
        } else {
          s10 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e4);
          }
        }
        if (s10 !== peg$FAILED) {
          peg$savedPos = s0;
          s0 = peg$f11(s1, s3, s5, s8);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_attribute() {
    let s0, s1;
    s0 = peg$currPos;
    s1 = peg$parse_key_value();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      if (input.charCodeAt(peg$currPos) === 59) {
        peg$currPos++;
      } else {
        if (peg$silentFails === 0) {
          peg$fail(peg$e5);
        }
      }
      peg$savedPos = s0;
      s0 = peg$f12(s1);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_attributes() {
    let s0, s1, s2;
    s0 = peg$currPos;
    s1 = input.substr(peg$currPos, 5);
    if (s1.toLowerCase() === peg$c1) {
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e1);
      }
    }
    if (s1 === peg$FAILED) {
      s1 = input.substr(peg$currPos, 4);
      if (s1.toLowerCase() === peg$c6) {
        peg$currPos += 4;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e6);
        }
      }
      if (s1 === peg$FAILED) {
        s1 = input.substr(peg$currPos, 4);
        if (s1.toLowerCase() === peg$c7) {
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e7);
          }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_attribute_list();
      if (s2 !== peg$FAILED) {
        peg$parse_();
        if (input.charCodeAt(peg$currPos) === 59) {
          peg$currPos++;
        } else {
          if (peg$silentFails === 0) {
            peg$fail(peg$e5);
          }
        }
        peg$savedPos = s0;
        s0 = peg$f13(s1, s2);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_edge() {
    let s0, s1, s2, s3;
    s0 = peg$currPos;
    s1 = peg$parse_edge_target();
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_edge_rhs();
      if (s2 !== peg$FAILED) {
        s3 = peg$parse_attribute_list();
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        peg$parse_();
        if (input.charCodeAt(peg$currPos) === 59) {
          peg$currPos++;
        } else {
          if (peg$silentFails === 0) {
            peg$fail(peg$e5);
          }
        }
        peg$savedPos = s0;
        s0 = peg$f14(s1, s2, s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_node() {
    let s0, s1, s3;
    s0 = peg$currPos;
    s1 = peg$parse_literal();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = peg$parse_attribute_list();
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      peg$parse_();
      if (input.charCodeAt(peg$currPos) === 59) {
        peg$currPos++;
      } else {
        if (peg$silentFails === 0) {
          peg$fail(peg$e5);
        }
      }
      peg$savedPos = s0;
      s0 = peg$f15(s1, s3);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_key_value() {
    let s0, s1, s3, s5;
    s0 = peg$currPos;
    s1 = peg$parse_literal();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      if (input.charCodeAt(peg$currPos) === 61) {
        s3 = peg$c8;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e8);
        }
      }
      if (s3 !== peg$FAILED) {
        peg$parse_();
        s5 = peg$parse_literal();
        if (s5 !== peg$FAILED) {
          peg$savedPos = s0;
          s0 = peg$f16(s1, s5);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_attibutes_item() {
    let s0, s1, s3;
    s0 = peg$currPos;
    s1 = peg$parse_key_value();
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = input.charAt(peg$currPos);
      if (peg$r0.test(s3)) {
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e9);
        }
      }
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      peg$savedPos = s0;
      s0 = peg$f17(s1);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_attribute_list() {
    let s0, s2, s3, s4, s5;
    s0 = peg$currPos;
    peg$parse_();
    if (input.charCodeAt(peg$currPos) === 91) {
      s2 = peg$c9;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e10);
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = [];
      s4 = peg$parseAttibutesItem();
      if (s4 === peg$FAILED) {
        s4 = peg$parseComment();
      }
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseAttibutesItem();
        if (s4 === peg$FAILED) {
          s4 = peg$parseComment();
        }
      }
      s4 = peg$parse__();
      if (input.charCodeAt(peg$currPos) === 93) {
        s5 = peg$c10;
        peg$currPos++;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e11);
        }
      }
      if (s5 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f18(s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_edge_target_group() {
    let s0, s1, s2, s3, s4, s5, s6;
    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 123) {
      s1 = peg$c3;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e3);
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseNodeRef();
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$currPos;
        s5 = input.charAt(peg$currPos);
        if (peg$r0.test(s5)) {
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e9);
          }
        }
        if (s5 === peg$FAILED) {
          s5 = null;
        }
        s6 = peg$parseNodeRef();
        if (s6 !== peg$FAILED) {
          peg$savedPos = s4;
          s4 = peg$f19(s2, s6);
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          s5 = input.charAt(peg$currPos);
          if (peg$r0.test(s5)) {
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e9);
            }
          }
          if (s5 === peg$FAILED) {
            s5 = null;
          }
          s6 = peg$parseNodeRef();
          if (s6 !== peg$FAILED) {
            peg$savedPos = s4;
            s4 = peg$f19(s2, s6);
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
        s4 = input.charAt(peg$currPos);
        if (peg$r0.test(s4)) {
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e9);
          }
        }
        if (s4 === peg$FAILED) {
          s4 = null;
        }
        s5 = peg$parse__();
        if (input.charCodeAt(peg$currPos) === 125) {
          s6 = peg$c4;
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e4);
          }
        }
        if (s6 !== peg$FAILED) {
          peg$savedPos = s0;
          s0 = peg$f20(s2, s3);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_edge_target() {
    let s0;
    s0 = peg$parse_edge_target_group();
    if (s0 === peg$FAILED) {
      s0 = peg$parseNodeRef();
    }
    return s0;
  }
  function peg$parse_edge_operator() {
    let s0, s1;
    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c11) {
      s1 = peg$c11;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e12);
      }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 2) === peg$c12) {
        s1 = peg$c12;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e13);
        }
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f21(s1);
    }
    s0 = s1;
    return s0;
  }
  function peg$parse_edge_rhs() {
    let s0, s2, s4, s6;
    s0 = peg$currPos;
    peg$parse_();
    s2 = peg$parse_edge_operator();
    if (s2 !== peg$FAILED) {
      peg$parse_();
      s4 = peg$parse_edge_target();
      if (s4 !== peg$FAILED) {
        peg$parse_();
        s6 = peg$parse_edge_rhs();
        if (s6 === peg$FAILED) {
          s6 = null;
        }
        peg$savedPos = s0;
        s0 = peg$f22(s2, s4, s6);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_node_ref() {
    let s0, s1, s2;
    s0 = peg$currPos;
    s1 = peg$parse_literal();
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_port();
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      peg$savedPos = s0;
      s0 = peg$f23(s1, s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_port() {
    let s0, s1, s2, s3, s4, s5;
    peg$silentFails++;
    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 58) {
      s1 = peg$c13;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e15);
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parse_literal();
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 58) {
          s4 = peg$c13;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e15);
          }
        }
        if (s4 !== peg$FAILED) {
          s5 = peg$parse_compass();
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s3 = peg$f24(s2, s5);
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        peg$savedPos = s0;
        s0 = peg$f25(s2, s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e14);
      }
    }
    return s0;
  }
  function peg$parse_subgraph_id() {
    let s0, s1, s3;
    s0 = peg$currPos;
    s1 = input.substr(peg$currPos, 8);
    if (s1.toLowerCase() === peg$c14) {
      peg$currPos += 8;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e16);
      }
    }
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = peg$parse_literal();
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      peg$parse_();
      peg$savedPos = s0;
      s0 = peg$f26(s3);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_subgraph() {
    let s0, s1, s2, s3, s5;
    s0 = peg$currPos;
    s1 = peg$parse_subgraph_id();
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (input.charCodeAt(peg$currPos) === 123) {
      s2 = peg$c3;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e3);
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$parseClusterStatements();
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      peg$parse__();
      if (input.charCodeAt(peg$currPos) === 125) {
        s5 = peg$c4;
        peg$currPos++;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e4);
        }
      }
      if (s5 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f27(s1, s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_compass_keyword() {
    let s0;
    if (input.charCodeAt(peg$currPos) === 110) {
      s0 = peg$c15;
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e17);
      }
    }
    if (s0 === peg$FAILED) {
      if (input.substr(peg$currPos, 2) === peg$c16) {
        s0 = peg$c16;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e18);
        }
      }
      if (s0 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 101) {
          s0 = peg$c17;
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e19);
          }
        }
        if (s0 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c18) {
            s0 = peg$c18;
            peg$currPos += 2;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e20);
            }
          }
          if (s0 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 115) {
              s0 = peg$c19;
              peg$currPos++;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) {
                peg$fail(peg$e21);
              }
            }
            if (s0 === peg$FAILED) {
              if (input.substr(peg$currPos, 2) === peg$c20) {
                s0 = peg$c20;
                peg$currPos += 2;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) {
                  peg$fail(peg$e22);
                }
              }
              if (s0 === peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 119) {
                  s0 = peg$c21;
                  peg$currPos++;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) {
                    peg$fail(peg$e23);
                  }
                }
                if (s0 === peg$FAILED) {
                  if (input.substr(peg$currPos, 2) === peg$c22) {
                    s0 = peg$c22;
                    peg$currPos += 2;
                  } else {
                    s0 = peg$FAILED;
                    if (peg$silentFails === 0) {
                      peg$fail(peg$e24);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return s0;
  }
  function peg$parse_compass() {
    let s0, s1, s2, s3, s4;
    s0 = peg$currPos;
    s1 = peg$currPos;
    s2 = peg$parse_compass_keyword();
    if (s2 !== peg$FAILED) {
      peg$savedPos = s1;
      s2 = peg$f28(s2);
    }
    s1 = s2;
    if (s1 === peg$FAILED) {
      s1 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s2 = peg$c23;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e25);
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parse_compass_keyword();
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s4 = peg$c23;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e25);
            }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s1;
            s1 = peg$f29(s3);
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f30(s1);
    }
    s0 = s1;
    return s0;
  }
  function peg$parse_literal() {
    let s0, s1;
    s0 = peg$parseQUOTED_STRING();
    if (s0 === peg$FAILED) {
      s0 = peg$parseHTML_STRING();
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseSTRING();
        if (s1 === peg$FAILED) {
          s1 = peg$parseNUMBER_STRING();
          if (s1 === peg$FAILED) {
            s1 = peg$parseNUMBER();
          }
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$f31(s1);
        }
        s0 = s1;
      }
    }
    return s0;
  }
  function peg$parse_comment() {
    let s0;
    s0 = peg$parse_block_comment();
    if (s0 === peg$FAILED) {
      s0 = peg$parse_slash_comment();
      if (s0 === peg$FAILED) {
        s0 = peg$parse_macro_comment();
      }
    }
    return s0;
  }
  function peg$parse_block_comment() {
    let s0, s1, s2, s3, s4, s5;
    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c24) {
      s1 = peg$c24;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e26);
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$currPos;
      peg$silentFails++;
      if (input.substr(peg$currPos, 2) === peg$c25) {
        s5 = peg$c25;
        peg$currPos += 2;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e27);
        }
      }
      peg$silentFails--;
      if (s5 === peg$FAILED) {
        s4 = void 0;
      } else {
        peg$currPos = s4;
        s4 = peg$FAILED;
      }
      if (s4 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s5 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e28);
          }
        }
        if (s5 !== peg$FAILED) {
          peg$savedPos = s3;
          s3 = peg$f32(s5);
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$currPos;
        peg$silentFails++;
        if (input.substr(peg$currPos, 2) === peg$c25) {
          s5 = peg$c25;
          peg$currPos += 2;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e27);
          }
        }
        peg$silentFails--;
        if (s5 === peg$FAILED) {
          s4 = void 0;
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        if (s4 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s5 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e28);
            }
          }
          if (s5 !== peg$FAILED) {
            peg$savedPos = s3;
            s3 = peg$f32(s5);
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (input.substr(peg$currPos, 2) === peg$c25) {
        s3 = peg$c25;
        peg$currPos += 2;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e27);
        }
      }
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f33(s2);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_slash_comment() {
    let s0, s1, s2;
    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parse_slash_comment_line();
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parse_slash_comment_line();
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f34(s1);
    }
    s0 = s1;
    return s0;
  }
  function peg$parse_slash_comment_line() {
    let s0, s2, s3, s4, s5, s6;
    s0 = peg$currPos;
    peg$parse_();
    if (input.substr(peg$currPos, 2) === peg$c26) {
      s2 = peg$c26;
      peg$currPos += 2;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e29);
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = [];
      s4 = peg$currPos;
      s5 = peg$currPos;
      peg$silentFails++;
      s6 = peg$parse_newline();
      peg$silentFails--;
      if (s6 === peg$FAILED) {
        s5 = void 0;
      } else {
        peg$currPos = s5;
        s5 = peg$FAILED;
      }
      if (s5 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s6 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e28);
          }
        }
        if (s6 !== peg$FAILED) {
          peg$savedPos = s4;
          s4 = peg$f35(s6);
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
      } else {
        peg$currPos = s4;
        s4 = peg$FAILED;
      }
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$currPos;
        s5 = peg$currPos;
        peg$silentFails++;
        s6 = peg$parse_newline();
        peg$silentFails--;
        if (s6 === peg$FAILED) {
          s5 = void 0;
        } else {
          peg$currPos = s5;
          s5 = peg$FAILED;
        }
        if (s5 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s6 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e28);
            }
          }
          if (s6 !== peg$FAILED) {
            peg$savedPos = s4;
            s4 = peg$f35(s6);
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
      }
      s4 = peg$parse_newline();
      if (s4 === peg$FAILED) {
        s4 = null;
      }
      peg$savedPos = s0;
      s0 = peg$f36(s3);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parse_macro_comment() {
    let s0, s1, s2;
    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parse_macro_comment_line();
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parse_macro_comment_line();
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f37(s1);
    }
    s0 = s1;
    return s0;
  }
  function peg$parse_macro_comment_line() {
    let s0, s2, s3, s4, s5, s6;
    s0 = peg$currPos;
    peg$parse_();
    if (input.charCodeAt(peg$currPos) === 35) {
      s2 = peg$c27;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e30);
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = [];
      s4 = peg$currPos;
      s5 = peg$currPos;
      peg$silentFails++;
      s6 = peg$parse_newline();
      peg$silentFails--;
      if (s6 === peg$FAILED) {
        s5 = void 0;
      } else {
        peg$currPos = s5;
        s5 = peg$FAILED;
      }
      if (s5 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s6 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e28);
          }
        }
        if (s6 !== peg$FAILED) {
          peg$savedPos = s4;
          s4 = peg$f38(s6);
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
      } else {
        peg$currPos = s4;
        s4 = peg$FAILED;
      }
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$currPos;
        s5 = peg$currPos;
        peg$silentFails++;
        s6 = peg$parse_newline();
        peg$silentFails--;
        if (s6 === peg$FAILED) {
          s5 = void 0;
        } else {
          peg$currPos = s5;
          s5 = peg$FAILED;
        }
        if (s5 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s6 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e28);
            }
          }
          if (s6 !== peg$FAILED) {
            peg$savedPos = s4;
            s4 = peg$f38(s6);
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
      }
      s4 = peg$parse_newline();
      if (s4 === peg$FAILED) {
        s4 = null;
      }
      peg$savedPos = s0;
      s0 = peg$f39(s3);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseSTRING() {
    let s0, s1, s2, s3;
    peg$silentFails++;
    s0 = peg$currPos;
    s1 = peg$parseStringStart();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseStringPart();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseStringPart();
      }
      peg$savedPos = s0;
      s0 = peg$f40(s1, s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e31);
      }
    }
    return s0;
  }
  function peg$parseNUMBER_STRING() {
    let s0, s1, s2;
    s0 = peg$currPos;
    s1 = peg$parseNUMBER();
    if (s1 !== peg$FAILED) {
      s2 = peg$parseSTRING();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f41(s1, s2);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseStringStart() {
    let s0;
    s0 = input.charAt(peg$currPos);
    if (peg$r1.test(s0)) {
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e32);
      }
    }
    return s0;
  }
  function peg$parseStringPart() {
    let s0;
    s0 = input.charAt(peg$currPos);
    if (peg$r2.test(s0)) {
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e33);
      }
    }
    return s0;
  }
  function peg$parseNUMBER() {
    let s0, s1, s2, s3, s4, s5, s6, s7, s8;
    peg$silentFails++;
    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 45) {
      s2 = peg$c28;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e35);
      }
    }
    if (s2 === peg$FAILED) {
      s2 = null;
    }
    s3 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 46) {
      s4 = peg$c29;
      peg$currPos++;
    } else {
      s4 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e36);
      }
    }
    if (s4 !== peg$FAILED) {
      s5 = [];
      s6 = input.charAt(peg$currPos);
      if (peg$r3.test(s6)) {
        peg$currPos++;
      } else {
        s6 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e37);
        }
      }
      if (s6 !== peg$FAILED) {
        while (s6 !== peg$FAILED) {
          s5.push(s6);
          s6 = input.charAt(peg$currPos);
          if (peg$r3.test(s6)) {
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e37);
            }
          }
        }
      } else {
        s5 = peg$FAILED;
      }
      if (s5 !== peg$FAILED) {
        s4 = [s4, s5];
        s3 = s4;
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
    } else {
      peg$currPos = s3;
      s3 = peg$FAILED;
    }
    if (s3 === peg$FAILED) {
      s3 = peg$currPos;
      s4 = [];
      s5 = input.charAt(peg$currPos);
      if (peg$r3.test(s5)) {
        peg$currPos++;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e37);
        }
      }
      if (s5 !== peg$FAILED) {
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = input.charAt(peg$currPos);
          if (peg$r3.test(s5)) {
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e37);
            }
          }
        }
      } else {
        s4 = peg$FAILED;
      }
      if (s4 !== peg$FAILED) {
        s5 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 46) {
          s6 = peg$c29;
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e36);
          }
        }
        if (s6 !== peg$FAILED) {
          s7 = [];
          s8 = input.charAt(peg$currPos);
          if (peg$r3.test(s8)) {
            peg$currPos++;
          } else {
            s8 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e37);
            }
          }
          while (s8 !== peg$FAILED) {
            s7.push(s8);
            s8 = input.charAt(peg$currPos);
            if (peg$r3.test(s8)) {
              peg$currPos++;
            } else {
              s8 = peg$FAILED;
              if (peg$silentFails === 0) {
                peg$fail(peg$e37);
              }
            }
          }
          s6 = [s6, s7];
          s5 = s6;
        } else {
          peg$currPos = s5;
          s5 = peg$FAILED;
        }
        if (s5 === peg$FAILED) {
          s5 = null;
        }
        s4 = [s4, s5];
        s3 = s4;
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
    }
    if (s3 !== peg$FAILED) {
      s2 = [s2, s3];
      s1 = s2;
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f42();
    }
    s0 = s1;
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e34);
      }
    }
    return s0;
  }
  function peg$parseHTML_STRING() {
    let s0, s1;
    s0 = peg$currPos;
    s1 = peg$parsehtml_raw_string();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f43(s1);
    }
    s0 = s1;
    return s0;
  }
  function peg$parsehtml_raw_string() {
    let s0, s1, s2, s3, s4;
    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 60) {
      s1 = peg$c30;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e38);
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = peg$currPos;
      s2 = peg$f44();
      if (s2) {
        s2 = void 0;
      } else {
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parsehtml_char();
        if (s4 === peg$FAILED) {
          s4 = peg$parsehtml_raw_string();
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parsehtml_char();
          if (s4 === peg$FAILED) {
            s4 = peg$parsehtml_raw_string();
          }
        }
        if (input.charCodeAt(peg$currPos) === 62) {
          s4 = peg$c31;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e39);
          }
        }
        if (s4 !== peg$FAILED) {
          peg$savedPos = s0;
          s0 = peg$f45(s3);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parsehtml_char() {
    let s0, s1, s2, s3, s4;
    s0 = peg$currPos;
    s1 = [];
    s2 = peg$currPos;
    s3 = peg$currPos;
    peg$silentFails++;
    s4 = input.charAt(peg$currPos);
    if (peg$r4.test(s4)) {
      peg$currPos++;
    } else {
      s4 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e40);
      }
    }
    peg$silentFails--;
    if (s4 === peg$FAILED) {
      s3 = void 0;
    } else {
      peg$currPos = s3;
      s3 = peg$FAILED;
    }
    if (s3 !== peg$FAILED) {
      if (input.length > peg$currPos) {
        s4 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e28);
        }
      }
      if (s4 !== peg$FAILED) {
        peg$savedPos = s2;
        s2 = peg$f46(s4);
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
    } else {
      peg$currPos = s2;
      s2 = peg$FAILED;
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$currPos;
        s3 = peg$currPos;
        peg$silentFails++;
        s4 = input.charAt(peg$currPos);
        if (peg$r4.test(s4)) {
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e40);
          }
        }
        peg$silentFails--;
        if (s4 === peg$FAILED) {
          s3 = void 0;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s4 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e28);
            }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s2;
            s2 = peg$f46(s4);
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f47(s1);
    }
    s0 = s1;
    return s0;
  }
  function peg$parseQUOTED_STRING() {
    let s0, s1, s2, s3;
    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 34) {
      s1 = peg$c23;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e25);
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseDoubleStringCharacter();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseDoubleStringCharacter();
      }
      if (input.charCodeAt(peg$currPos) === 34) {
        s3 = peg$c23;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e25);
        }
      }
      if (s3 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f48(s2);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseDoubleStringCharacter() {
    let s0, s1, s2;
    s0 = peg$parseQuoteEscape();
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$currPos;
      peg$silentFails++;
      s2 = input.charAt(peg$currPos);
      if (peg$r5.test(s2)) {
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e41);
        }
      }
      peg$silentFails--;
      if (s2 === peg$FAILED) {
        s1 = void 0;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseSourceCharacter();
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s0 = peg$f49();
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$parseLineContinuation();
      }
    }
    return s0;
  }
  function peg$parseQuoteEscape() {
    let s0, s1, s2, s3;
    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 92) {
      s2 = peg$c32;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e42);
      }
    }
    if (s2 !== peg$FAILED) {
      if (input.length > peg$currPos) {
        s3 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e28);
        }
      }
      if (s3 !== peg$FAILED) {
        s2 = [s2, s3];
        s1 = s2;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$f50(s1);
    }
    s0 = s1;
    return s0;
  }
  function peg$parseLineContinuation() {
    let s0, s1, s2;
    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 92) {
      s1 = peg$c32;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e42);
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseLineTerminatorSequence();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s0 = peg$f51();
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parseLineTerminatorSequence() {
    let s0;
    peg$silentFails++;
    if (input.charCodeAt(peg$currPos) === 10) {
      s0 = peg$c33;
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e44);
      }
    }
    if (s0 === peg$FAILED) {
      if (input.substr(peg$currPos, 2) === peg$c34) {
        s0 = peg$c34;
        peg$currPos += 2;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e45);
        }
      }
      if (s0 === peg$FAILED) {
        s0 = input.charAt(peg$currPos);
        if (peg$r6.test(s0)) {
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e46);
          }
        }
      }
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      if (peg$silentFails === 0) {
        peg$fail(peg$e43);
      }
    }
    return s0;
  }
  function peg$parseSourceCharacter() {
    let s0;
    if (input.length > peg$currPos) {
      s0 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e28);
      }
    }
    return s0;
  }
  function peg$parse_() {
    let s0, s1;
    peg$silentFails++;
    s0 = [];
    s1 = peg$parse_whitespace();
    while (s1 !== peg$FAILED) {
      s0.push(s1);
      s1 = peg$parse_whitespace();
    }
    peg$silentFails--;
    return s0;
  }
  function peg$parse__() {
    let s0, s1;
    peg$silentFails++;
    s0 = [];
    s1 = input.charAt(peg$currPos);
    if (peg$r7.test(s1)) {
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e47);
      }
    }
    while (s1 !== peg$FAILED) {
      s0.push(s1);
      s1 = input.charAt(peg$currPos);
      if (peg$r7.test(s1)) {
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e47);
        }
      }
    }
    peg$silentFails--;
    return s0;
  }
  function peg$parse_newline() {
    let s0;
    s0 = input.charAt(peg$currPos);
    if (peg$r8.test(s0)) {
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e48);
      }
    }
    return s0;
  }
  function peg$parse_whitespace() {
    let s0;
    s0 = input.charAt(peg$currPos);
    if (peg$r9.test(s0)) {
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e49);
      }
    }
    return s0;
  }
  function dedent(value) {
    const str = value.trim();
    const matches = str.match(/\n([\t ]+|(?!\s).)/g);
    if (matches) {
      const indentLengths = matches.map((match) => match.match(/[\t ]/g)?.length ?? 0);
      const pattern = new RegExp(`
[	 ]{${Math.min(...indentLengths)}}`, "g");
      return str.replace(pattern, "\n");
    }
    return str;
  }
  const edgeops = [];
  const MAX_HTML_NESTING_DEPTH = options.maxHtmlNestingDepth ?? 100;
  const MAX_EDGE_CHAIN_DEPTH = options.maxEdgeChainDepth ?? 1e3;
  let htmlNestingDepth = 0;
  let edgeChainDepth = 0;
  const b = new Builder({
    locationFunction: location,
    maxASTNodes: options.maxASTNodes
  });
  function resetState() {
    b.resetNodeCount();
    htmlNestingDepth = 0;
    edgeChainDepth = 0;
    edgeops.length = 0;
  }
  resetState();
  peg$result = peg$startRuleFunction();
  const peg$success = peg$result !== peg$FAILED && peg$currPos === input.length;
  function peg$throw() {
    if (peg$result !== peg$FAILED && peg$currPos < input.length) {
      peg$fail(peg$endExpectation());
    }
    throw peg$buildStructuredError(
      peg$maxFailExpected,
      peg$maxFailPos < input.length ? peg$getUnicode(peg$maxFailPos) : null,
      peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
    );
  }
  if (options.peg$library) {
    return (
      /** @type {any} */
      {
        peg$result,
        peg$currPos,
        peg$FAILED,
        peg$maxFailExpected,
        peg$maxFailPos,
        peg$success,
        peg$throw: peg$success ? void 0 : peg$throw
      }
    );
  }
  if (peg$success) {
    return peg$result;
  } else {
    peg$throw();
  }
}
var DEFAULT_MAX_INPUT_SIZE = 10 * 1024 * 1024;
function parse(input, options) {
  const {
    startRule,
    filename,
    maxHtmlNestingDepth,
    maxEdgeChainDepth,
    maxInputSize,
    maxASTNodes
  } = options ?? {};
  const inputSizeLimit = maxInputSize ?? DEFAULT_MAX_INPUT_SIZE;
  if (inputSizeLimit > 0) {
    const inputBytes = new TextEncoder().encode(input).length;
    if (inputBytes > inputSizeLimit) {
      throw new DotSyntaxError(
        `Input size (${inputBytes} bytes) exceeds maximum allowed size (${inputSizeLimit} bytes). Consider increasing 'maxInputSize' option or reducing the input size.`
      );
    }
  }
  try {
    return peg$parse(input, {
      startRule,
      filename,
      maxHtmlNestingDepth,
      maxEdgeChainDepth,
      maxASTNodes
    });
  } catch (e) {
    if (e instanceof peg$SyntaxError) {
      throw new DotSyntaxError(e.message, {
        cause: e
      });
    }
    if (e instanceof ASTNodeCountExceededError) {
      throw new DotSyntaxError(e.message, {
        cause: e
      });
    }
    throw new Error("Unexpected parse error", {
      cause: e
    });
  }
}
var DotSyntaxError = class extends SyntaxError {
  constructor(...args) {
    super(...args);
    this.name = "DotSyntaxError";
  }
};
var escapeMap = {
  "\r": String.raw`\r`,
  "\n": String.raw`\n`,
  '"': String.raw`\"`
};

// src/handlers/tool.ts
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/core/duration.ts
function parseDuration(value) {
  if (!value) return 0;
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(value.trim());
  if (!m) return 0;
  const n = Number.parseInt(m[1], 10);
  const unit = m[2] ?? "s";
  const factors = { ms: 1, s: 1e3, m: 6e4, h: 36e5 };
  return n * factors[unit];
}

// src/core/outcome.ts
var Status = {
  SUCCESS: "success",
  PARTIAL: "partial_success",
  RETRY: "retry",
  FAIL: "fail",
  SKIPPED: "skipped"
};

// src/core/substitute.ts
var TOKEN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_.]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
function substitute(text, ctx) {
  return text.replace(TOKEN, (match, braced, bare) => {
    if (match === "$$") return "$$";
    const key = braced ?? bare;
    if (key === void 0) return match;
    const value = ctx.get(key);
    return value === void 0 ? match : value;
  });
}
function referencedKeys(text) {
  const keys = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(TOKEN)) {
    const key = match[1] ?? match[2];
    if (key !== void 0) keys.add(key);
  }
  return [...keys];
}

// src/handlers/tool.ts
function runShell(command, cwd, timeoutMs) {
  return new Promise((resolve3) => {
    const child = spawn("sh", ["-c", command], { cwd });
    let stdout = "";
    let stderr = "";
    let timer;
    if (timeoutMs > 0) {
      timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    }
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve3({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve3({ code: 1, stdout, stderr: `${stderr}${String(err)}` });
    });
  });
}
var TOOL_OUTPUT_KEYS = ["tool.last_line", "tool.output"];
function lastNonEmptyLine(text) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 ? lines[lines.length - 1].trim() : "";
}
var ToolHandler = class {
  /**
   * Section 5.6's run directory structure gives every `{node_id}/` a
   * `status.json` -- "Node execution outcome". Tool nodes wrote command.sh,
   * stdout.txt and stderr.txt and no status.json at all, so the one artifact
   * the spec tells an external reader to look for was missing for an entire
   * node kind. Section 4.5's status-file contract names it as the channel
   * external tools use to communicate outcomes back, which cannot work if
   * half the nodes never produce one.
   *
   * The wire shape is the same one `handlers/box.ts` writes, field for field,
   * because a reader parsing a run directory must not need to know which
   * handler produced a given node's file.
   */
  writeStatus(ctx, outcome) {
    const nodeDir = join(ctx.runDir, ctx.node.id);
    mkdirSync(nodeDir, { recursive: true });
    const statusFile = {
      outcome: outcome.status,
      preferred_label: outcome.preferredLabel,
      suggested_next_ids: outcome.suggestedNextIds,
      context_updates: outcome.contextUpdates,
      notes: outcome.notes,
      failure_reason: outcome.failureReason
    };
    writeFileSync(join(nodeDir, "status.json"), JSON.stringify(statusFile, null, 2), "utf8");
  }
  async execute(ctx) {
    const raw = ctx.node.attrs.tool_command;
    if (!raw) {
      const reason = `node ${ctx.node.id} has no tool_command`;
      const outcome2 = { status: Status.FAIL, notes: reason, failureReason: reason };
      this.writeStatus(ctx, outcome2);
      return outcome2;
    }
    const command = substitute(raw, ctx.context);
    const timeoutMs = parseDuration(ctx.node.attrs.timeout);
    ctx.events.append({ type: "node.tool.start", node: ctx.node.id });
    const result = await runShell(command, ctx.cwd, timeoutMs);
    const nodeDir = join(ctx.runDir, ctx.node.id);
    mkdirSync(nodeDir, { recursive: true });
    writeFileSync(join(nodeDir, "command.sh"), command, "utf8");
    writeFileSync(join(nodeDir, "stdout.txt"), result.stdout, "utf8");
    writeFileSync(join(nodeDir, "stderr.txt"), result.stderr, "utf8");
    ctx.events.append({
      type: "node.tool.end",
      node: ctx.node.id,
      exitCode: result.code
    });
    if (result.code !== 0) {
      const reason = `exit ${result.code}: ${lastNonEmptyLine(result.stderr) || lastNonEmptyLine(result.stdout)}`;
      const outcome2 = { status: Status.FAIL, notes: reason, failureReason: reason };
      this.writeStatus(ctx, outcome2);
      return outcome2;
    }
    const label = lastNonEmptyLine(result.stdout);
    const updates = { "tool.last_line": label, "tool.output": result.stdout };
    ctx.context.merge(updates);
    const outcome = {
      status: Status.SUCCESS,
      contextUpdates: updates,
      notes: label
    };
    this.writeStatus(ctx, outcome);
    return outcome;
  }
};

// src/dot/graph.ts
var Handler = {
  START: "start",
  EXIT: "exit",
  CODERGEN: "codergen",
  TOOL: "tool",
  CONDITIONAL: "conditional",
  HUMAN: "human",
  PARALLEL: "parallel",
  FAN_IN: "fan_in",
  MANAGER_LOOP: "manager_loop"
};
var SHAPE_TO_HANDLER = {
  Mdiamond: Handler.START,
  Msquare: Handler.EXIT,
  box: Handler.CODERGEN,
  parallelogram: Handler.TOOL,
  diamond: Handler.CONDITIONAL,
  hexagon: Handler.HUMAN,
  component: Handler.PARALLEL,
  tripleoctagon: Handler.FAN_IN,
  house: Handler.MANAGER_LOOP
};
var RESERVED_IDS = {
  start: Handler.START,
  Start: Handler.START,
  exit: Handler.EXIT,
  end: Handler.EXIT
};
function handlerForShape(shape, id) {
  if (shape && Object.hasOwn(SHAPE_TO_HANDLER, shape)) return SHAPE_TO_HANDLER[shape];
  if (!shape && Object.hasOwn(RESERVED_IDS, id)) return RESERVED_IDS[id];
  return Handler.CODERGEN;
}
var TYPE_TO_HANDLER = {
  start: Handler.START,
  exit: Handler.EXIT,
  codergen: Handler.CODERGEN,
  tool: Handler.TOOL,
  conditional: Handler.CONDITIONAL,
  "wait.human": Handler.HUMAN,
  parallel: Handler.PARALLEL,
  "parallel.fan_in": Handler.FAN_IN,
  "stack.manager_loop": Handler.MANAGER_LOOP
};
function handlerForNode(attrs, id) {
  const declared = attrs.type;
  if (declared !== void 0 && Object.hasOwn(TYPE_TO_HANDLER, declared)) {
    return TYPE_TO_HANDLER[declared];
  }
  return handlerForShape(attrs.shape, id);
}
function outgoingEdges(graph, nodeId) {
  return graph.edges.filter((e) => e.from === nodeId);
}
function directPredecessor(graph, nodeId) {
  const incoming = graph.edges.filter((e) => e.to === nodeId && e.from !== nodeId);
  const distinctSources = new Set(incoming.map((e) => e.from));
  if (distinctSources.size !== 1) return null;
  return graph.nodes.get([...distinctSources][0]) ?? null;
}
function findByHandler(graph, kind) {
  return [...graph.nodes.values()].filter((n) => n.handler === kind);
}
var INFERRED_OUTPUTS_BY_HANDLER = {
  [Handler.START]: [],
  // PassthroughHandler: {status: SUCCESS}, no contextUpdates.
  [Handler.EXIT]: [],
  // PassthroughHandler, same as START.
  [Handler.CODERGEN]: [],
  // Deliberate -- see the box-handler note above.
  [Handler.TOOL]: TOOL_OUTPUT_KEYS,
  [Handler.CONDITIONAL]: [],
  // PassthroughHandler, same as START.
  [Handler.HUMAN]: [],
  // Not registered in defaultHandlers() -- cannot execute, let alone write.
  [Handler.PARALLEL]: [],
  // ParallelHandler (p5-08) writes context via mergeBranchContext's direct
  // Context.set() calls, not via Outcome.contextUpdates -- nothing for this table to infer.
  [Handler.FAN_IN]: [],
  // Not registered in defaultHandlers() -- cannot execute, let alone write.
  [Handler.MANAGER_LOOP]: []
  // Not registered in defaultHandlers() -- cannot execute, let alone write.
};
var UNREGISTERED_HANDLER_KINDS = [
  Handler.HUMAN,
  Handler.FAN_IN,
  Handler.MANAGER_LOOP
];
var PASSTHROUGH_KINDS = [Handler.START, Handler.EXIT, Handler.CONDITIONAL];
var RunsOn = {
  SUCCESS: "success",
  FAILURE: "failure",
  ALWAYS: "always"
};
var RUNS_ON_MODES = {
  [RunsOn.SUCCESS]: RunsOn.SUCCESS,
  [RunsOn.FAILURE]: RunsOn.FAILURE,
  [RunsOn.ALWAYS]: RunsOn.ALWAYS
};
function runsOn(node) {
  const declared = node.attrs.runs_on;
  if (declared !== void 0 && Object.hasOwn(RUNS_ON_MODES, declared)) {
    return RUNS_ON_MODES[declared];
  }
  return RunsOn.SUCCESS;
}
var SUBSTITUTABLE_ATTRS = {
  [Handler.START]: [],
  // PassthroughHandler: no prompt, no command, no substitution.
  [Handler.EXIT]: [],
  // PassthroughHandler, same as START.
  [Handler.CODERGEN]: ["prompt", "label"],
  // BoxHandler: `attrs.prompt || attrs.label`.
  [Handler.TOOL]: ["tool_command"],
  // ToolHandler: `attrs.tool_command`.
  [Handler.CONDITIONAL]: [],
  // PassthroughHandler, same as START.
  [Handler.HUMAN]: [],
  // Not registered in defaultHandlers() -- cannot execute.
  [Handler.PARALLEL]: [],
  // ParallelHandler (p5-08) reads max_parallel (a plain int) and edges'
  // isolate attribute -- neither is substitutable text; nothing passes through substitute().
  [Handler.FAN_IN]: [],
  // Not registered in defaultHandlers() -- cannot execute.
  [Handler.MANAGER_LOOP]: []
  // Not registered in defaultHandlers() -- cannot execute.
};
function substitutableText(node) {
  for (const attr of SUBSTITUTABLE_ATTRS[node.handler] ?? []) {
    const value = node.attrs[attr];
    if (value) return value;
  }
  return "";
}
function declaredOutputs(node) {
  const raw = node.attrs.outputs;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
function inferredOutputs(node) {
  return [...INFERRED_OUTPUTS_BY_HANDLER[node.handler] ?? []];
}
function effectiveOutputs(node) {
  return [.../* @__PURE__ */ new Set([...inferredOutputs(node), ...declaredOutputs(node)])];
}
function reachableWithDepthTruncated(graph, startId, stopId, otherRoots) {
  const depth = /* @__PURE__ */ new Map();
  const queue = [];
  for (const e of outgoingEdges(graph, startId)) {
    if (!depth.has(e.to)) {
      depth.set(e.to, 1);
      queue.push(e.to);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    const curDepth = depth.get(cur);
    if (cur === stopId) continue;
    if (curDepth > 1 && otherRoots.has(cur)) continue;
    for (const e of outgoingEdges(graph, cur)) {
      if (!depth.has(e.to)) {
        depth.set(e.to, curDepth + 1);
        queue.push(e.to);
      }
    }
  }
  return depth;
}
function findConvergenceNode(graph, branchRootIds, fanOutNodeId) {
  if (branchRootIds.length === 0) return null;
  const rootSet = new Set(branchRootIds);
  const depthMaps = branchRootIds.map((id) => {
    const otherRoots = new Set(branchRootIds.filter((r) => r !== id));
    return reachableWithDepthTruncated(graph, id, fanOutNodeId, otherRoots);
  });
  let candidates = [...depthMaps[0].keys()].filter((id) => !rootSet.has(id) && id !== fanOutNodeId);
  for (let i = 1; i < depthMaps.length; i++) {
    candidates = candidates.filter((id) => depthMaps[i].has(id));
  }
  if (candidates.length === 0) return null;
  let best = null;
  let bestDepth = Infinity;
  for (const id of candidates) {
    const worstCase = Math.max(...depthMaps.map((dm) => dm.get(id)));
    if (worstCase < bestDepth) {
      bestDepth = worstCase;
      best = id;
    }
  }
  return best;
}
function findPartialReconvergence(graph, branchRootIdsRaw, convergenceId, fanOutNodeId) {
  if (convergenceId === null) return [];
  const branchRootIds = [...new Set(branchRootIdsRaw)];
  const rootSet = new Set(branchRootIds);
  const exitIds = new Set(findByHandler(graph, Handler.EXIT).map((n) => n.id));
  const truncatedSets = branchRootIds.map((rootId) => {
    const seen = /* @__PURE__ */ new Set([rootId]);
    const queue = [rootId];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === convergenceId) continue;
      for (const e of outgoingEdges(graph, cur)) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
    return seen;
  });
  const hazards = /* @__PURE__ */ new Set();
  const counts = /* @__PURE__ */ new Map();
  for (const set of truncatedSets) {
    for (const id of set) {
      if (id === convergenceId || id === fanOutNodeId || exitIds.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  for (const [id, count] of counts) {
    if (count >= 2) hazards.add(id);
  }
  const downstreamOfConvergence = (() => {
    const seen = /* @__PURE__ */ new Set();
    const queue = [];
    for (const e of outgoingEdges(graph, convergenceId)) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift();
      if (rootSet.has(cur)) continue;
      for (const e of outgoingEdges(graph, cur)) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
    return seen;
  })();
  for (const set of truncatedSets) {
    for (const id of set) {
      if (id === convergenceId || id === fanOutNodeId || exitIds.has(id) || rootSet.has(id)) continue;
      if (downstreamOfConvergence.has(id)) hazards.add(id);
    }
  }
  return [...hazards];
}

// src/dot/parse.ts
var NODE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
var IDENT_HEAD = /[A-Za-z_]/;
var IDENT_TAIL = /[A-Za-z0-9_]/;
var LF_PLACEHOLDER = "\uFFFE";
var CR_PLACEHOLDER = "\uFFFF";
function assertNoPlaceholderCollision(src) {
  if (src.includes(LF_PLACEHOLDER) || src.includes(CR_PLACEHOLDER)) {
    throw new Error(
      "attractor: source contains U+FFFE or U+FFFF, Unicode noncharacters this parser reserves internally to represent a literal newline or carriage return inside a quoted value (section 2.4); remove the codepoint from the source before parsing"
    );
  }
}
function restorePlaceholders(n) {
  for (const lit of [n.id, n.key, n.value]) {
    if (typeof lit?.value === "string" && (lit.value.includes(LF_PLACEHOLDER) || lit.value.includes(CR_PLACEHOLDER))) {
      lit.value = lit.value.split(LF_PLACEHOLDER).join("\n").split(CR_PLACEHOLDER).join("\r");
    }
  }
  for (const c of n.children ?? []) restorePlaceholders(c);
}
function scan(src) {
  let text = "";
  let masked = "";
  const emit = (s) => {
    text += s;
    masked += s;
  };
  const emitComment = (s) => {
    text += s;
    masked += s.replace(/[^\n]/g, " ");
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const stop = close === -1 ? src.length : close + 2;
      emitComment(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && src[i + 1] === "/" || c === "#") {
      const nl = src.indexOf("\n", i);
      const stop = nl === -1 ? src.length : nl;
      emitComment(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let chunkStart = i;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === '"') {
          j++;
          break;
        }
        if (src[j] === "\n" || src[j] === "\r") {
          emit(src.slice(chunkStart, j));
          emit(src[j] === "\n" ? LF_PLACEHOLDER : CR_PLACEHOLDER);
          j++;
          chunkStart = j;
          continue;
        }
        j++;
      }
      emit(src.slice(chunkStart, Math.min(j, src.length)));
      i = Math.min(j, src.length);
      continue;
    }
    if (c === "<") {
      let depth = 0;
      let j = i;
      while (j < src.length) {
        if (src[j] === "<") depth++;
        else if (src[j] === ">") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
        j++;
      }
      emit(src.slice(i, Math.min(j, src.length)));
      i = Math.min(j, src.length);
      continue;
    }
    if (IDENT_HEAD.test(c)) {
      let j = i + 1;
      while (j < src.length && IDENT_TAIL.test(src[j])) j++;
      let end = j;
      let dotted = false;
      while (src[end] === "." && end + 1 < src.length && IDENT_HEAD.test(src[end + 1])) {
        let k = end + 2;
        while (k < src.length && IDENT_TAIL.test(src[k])) k++;
        end = k;
        dotted = true;
      }
      const word = src.slice(i, end);
      emit(dotted ? `"${word}"` : word);
      i = end;
      continue;
    }
    emit(c);
    i++;
  }
  return { text, masked };
}
function enforceLexicalSubset(n, masked) {
  for (const lit of [n.id, n.key, n.value]) {
    if (lit?.quoted === "html") {
      throw new Error(
        `attractor: HTML strings are not part of the DOT subset (section 2.1: no HTML labels); rewrite <${String(lit.value)}> as a quoted string`
      );
    }
  }
  if (n.type === "Node" || n.type === "Edge" || n.type === "AttributeList") {
    const attrs = (n.children ?? []).filter((c) => c.type === "Attribute");
    for (let i = 0; i + 1 < attrs.length; i++) {
      const from = attrs[i].value?.location?.end.offset;
      const to = attrs[i + 1].location?.start.offset;
      if (from === void 0 || to === void 0) continue;
      if (!masked.slice(from, to).includes(",")) {
        throw new Error(
          `attractor: attributes ${String(attrs[i].key?.value)} and ${String(attrs[i + 1].key?.value)} are not separated by a comma (section 2.3: commas required between attributes)`
        );
      }
    }
  }
  for (const c of n.children ?? []) enforceLexicalSubset(c, masked);
}
function checkNodeId(id) {
  if (!NODE_ID.test(id)) {
    throw new Error(
      `attractor: node id ${JSON.stringify(id)} is not a bare identifier (section 2.3: node ids must match [A-Za-z_][A-Za-z0-9_]*); put the human-readable name in the label attribute`
    );
  }
  return id;
}
function attributesOf(n) {
  const out = {};
  for (const c of n.children ?? []) {
    if (c.type === "Attribute" && c.key && c.value !== void 0) {
      out[String(c.key.value)] = String(c.value.value);
    }
  }
  return out;
}
function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (!Object.hasOwn(target, k)) target[k] = v;
  }
}
function parseDot(src) {
  assertNoPlaceholderCollision(src);
  const scanned = scan(src);
  const ast = parse(scanned.text);
  restorePlaceholders(ast);
  enforceLexicalSubset(ast, scanned.masked);
  const nodes = /* @__PURE__ */ new Map();
  const edges = [];
  const graphAttrs = {};
  let name = "";
  const upsertNode = (rawId, attrs, scope) => {
    const id = checkNodeId(rawId);
    const existing = nodes.get(id);
    const merged = existing ? { ...existing.attrs, ...attrs } : { ...attrs };
    fillDefaults(merged, scope.nodeDefaults);
    nodes.set(id, { id, attrs: merged, handler: handlerForNode(merged, id) });
  };
  const walk = (parent, scope) => {
    for (const c of parent.children ?? []) {
      switch (c.type) {
        case "Node": {
          upsertNode(String(c.id?.value ?? ""), attributesOf(c), scope);
          break;
        }
        case "Edge": {
          const ids = (c.targets ?? []).map((t) => {
            const id = t.id?.value;
            if (id === void 0) {
              throw new Error(
                "attractor: grouped edge targets ({a; b} -> c) are not supported; write each edge explicitly"
              );
            }
            return checkNodeId(String(id));
          });
          const attrs = attributesOf(c);
          for (let i = 0; i < ids.length - 1; i++) {
            const edgeAttrs = { ...attrs };
            fillDefaults(edgeAttrs, scope.edgeDefaults);
            edges.push({ from: ids[i], to: ids[i + 1], attrs: edgeAttrs });
          }
          for (const id of ids) {
            if (!nodes.has(id)) upsertNode(id, {}, scope);
          }
          break;
        }
        case "Attribute": {
          if (scope.isRootGraph && c.key && c.value !== void 0) {
            graphAttrs[String(c.key.value)] = String(c.value.value);
          }
          break;
        }
        case "AttributeList": {
          if (c.kind === "Graph") {
            if (scope.isRootGraph) Object.assign(graphAttrs, attributesOf(c));
          } else if (c.kind === "Node") Object.assign(scope.nodeDefaults, attributesOf(c));
          else if (c.kind === "Edge") Object.assign(scope.edgeDefaults, attributesOf(c));
          break;
        }
        case "Subgraph": {
          walk(c, {
            nodeDefaults: { ...scope.nodeDefaults },
            edgeDefaults: { ...scope.edgeDefaults },
            isRootGraph: false
          });
          break;
        }
        default:
          if (c.children) walk(c, scope);
      }
    }
  };
  for (const top of ast.children ?? []) {
    if (top.type === "Graph") {
      if (top.strict === true) {
        throw new Error(
          "attractor: the strict modifier is not part of the DOT subset (section 2.3: strict modifiers are rejected)"
        );
      }
      if (top.directed !== true) {
        throw new Error(
          "attractor: this is an undirected graph; the DOT subset accepts digraph only (section 2.3: undirected graphs are rejected, -> is the only edge operator)"
        );
      }
      name = top.id ? String(top.id.value) : "";
      walk(top, { nodeDefaults: {}, edgeDefaults: {}, isRootGraph: true });
    }
  }
  return { name, attrs: graphAttrs, nodes, edges };
}

// src/backend/argv.ts
var OUTCOME_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["success", "fail", "retry"] },
    preferred_label: { type: "string" },
    notes: { type: "string" }
  },
  required: ["status", "preferred_label", "notes"],
  additionalProperties: false
};
function wantsVerdict(node) {
  return node.attrs.goal_gate === "true";
}
function buildArgv(node, opts) {
  const argv = ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"];
  const model = node.attrs.llm_model ?? opts.model;
  if (model !== void 0) argv.push("--model", model);
  if (opts.addDir !== void 0) argv.push("--add-dir", opts.addDir);
  if (opts.resumeId !== void 0) argv.push("--resume", opts.resumeId);
  else if (opts.sessionId !== void 0) argv.push("--session-id", opts.sessionId);
  if (opts.maxBudgetUsd !== void 0) argv.push("--max-budget-usd", String(opts.maxBudgetUsd));
  if (opts.allowedTools !== void 0 && opts.allowedTools.length > 0) {
    argv.push("--allowedTools", opts.allowedTools.join(","));
  }
  if (opts.appendSystemPrompt !== void 0) {
    argv.push("--append-system-prompt", opts.appendSystemPrompt);
  }
  if (wantsVerdict(node)) {
    argv.push("--json-schema", JSON.stringify(OUTCOME_SCHEMA));
  }
  return argv;
}

// src/core/condition.ts
var CLAUSE = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(!=|=)\s*(.*?)\s*$/;
var BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;
function resolveKey(key, ctx, outcome) {
  if (key === "outcome") return outcome.status;
  if (key === "preferred_label") {
    const live = outcome.preferredLabel;
    return live !== void 0 && live !== "" ? live : ctx.get("preferred_label") ?? "";
  }
  if (key.startsWith("context.")) {
    return ctx.get(key) ?? ctx.get(key.slice("context.".length)) ?? "";
  }
  return ctx.get(key) ?? "";
}
function parseLiteral(raw) {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}
function splitClauses(expr) {
  const trimmed = expr.trim();
  return trimmed === "" ? [] : trimmed.split("&&");
}
function isValidConditionSyntax(expr) {
  return splitClauses(expr).every((raw) => CLAUSE.test(raw) || BARE_IDENTIFIER.test(raw.trim()));
}
function evaluateCondition(expr, ctx, outcome) {
  for (const raw of splitClauses(expr)) {
    const m = CLAUSE.exec(raw);
    if (m === null) {
      const bare = raw.trim();
      if (bare === "") return false;
      if (resolveKey(bare, ctx, outcome) === "") return false;
      continue;
    }
    const [, key, op, expected] = m;
    const actual = resolveKey(key, ctx, outcome);
    const equal = actual === parseLiteral(expected);
    if (op === "=" ? !equal : equal) return false;
  }
  return true;
}

// src/core/edge-select.ts
function normaliseLabel(label) {
  return label.replace(/^\s*(?:\[[A-Za-z0-9]\]|[A-Za-z0-9]\)|[A-Za-z0-9]\s+-)\s+/, "").trim().toLowerCase();
}
function weightOf(edge) {
  const raw = edge.attrs.weight;
  if (raw === void 0) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
function byWeightThenTarget(a, b) {
  const wa = weightOf(a);
  const wb = weightOf(b);
  if (wa !== wb) return wb - wa;
  return a.to.localeCompare(b.to);
}
function isConditional(edge) {
  return edge.attrs.condition !== void 0 && edge.attrs.condition.trim() !== "";
}
function selectEdge(graph, fromId, ctx, outcome) {
  const edges = outgoingEdges(graph, fromId);
  if (edges.length === 0) return null;
  const matched = edges.filter(
    (e) => isConditional(e) && evaluateCondition(e.attrs.condition, ctx, outcome)
  );
  if (matched.length > 0) return matched.sort(byWeightThenTarget)[0];
  if (outcome.status === Status.FAIL) {
    return null;
  }
  const unconditional = edges.filter((e) => !isConditional(e));
  if (unconditional.length === 0) return null;
  if (outcome.preferredLabel) {
    const want = normaliseLabel(outcome.preferredLabel);
    const byLabel = unconditional.find(
      (e) => e.attrs.label !== void 0 && normaliseLabel(e.attrs.label) === want
    );
    if (byLabel) return byLabel;
  }
  if (outcome.suggestedNextIds && outcome.suggestedNextIds.length > 0) {
    for (const id of outcome.suggestedNextIds) {
      const bySuggestion = unconditional.find((e) => e.to === id);
      if (bySuggestion) return bySuggestion;
    }
  }
  return unconditional.sort(byWeightThenTarget)[0];
}

// src/core/context.ts
var ENGINE_MANAGED_KEYS = ["outcome", "preferred_label", "current_node"];
var ENGINE_MANAGED_PREFIXES = ["tool.", "graph.", "internal."];
function isEngineManagedKey(key) {
  return ENGINE_MANAGED_KEYS.includes(key) || ENGINE_MANAGED_PREFIXES.some((p) => key.startsWith(p));
}
var Context = class _Context {
  data;
  /**
   * Keys written since the last `takeWritten()`.
   *
   * The engine's failed-output ledger has to know which keys were ACTUALLY
   * PRODUCED, so it can stop reporting a key as unavailable once some node has
   * written it. Three cheaper-looking answers are all wrong, and each is wrong
   * in a way that matters:
   *
   * - A node's `effectiveOutputs`. That is a CONTRACT, not evidence: a node
   *   can succeed while writing only part of what it declared. Clearing on the
   *   declaration marks keys available that nobody produced -- the dataflow
   *   plan's own failure mode, inverted.
   * - The presence of a value. The stale-label doctrine deliberately leaves a
   *   failed tool node's PREVIOUS `tool.last_line` in place, so a value being
   *   present is not evidence that this run produced it.
   * - A before/after diff of `snapshot()`. Silently wrong when a node rewrites
   *   a key with the value it already held -- two tool nodes that both end
   *   `printf ok` -- which reintroduces exactly the false halt this exists to
   *   remove.
   * - The Outcome's `contextUpdates`. This one is a SECURITY property, not a
   *   preference: `handlers/box.ts` merges only the ALLOWED updates into
   *   context but returns the RAW map on its Outcome, so a model answering
   *   `contextUpdates: {'tool.last_line': 'green'}` -- rejected by the
   *   engine-managed guard and never written -- would forge a ledger clear.
   *   That is the forgery Plan 3 demonstrated with `{current_node: 'start'}`.
   *   Filtering by `isEngineManagedKey` in the engine does not rescue it
   *   either: that would drop `ToolHandler`'s entirely legitimate
   *   `tool.last_line` write, which is the very key the bug was about.
   *
   * Recording the write where the write happens is the only answer that is
   * true by construction for every handler, present and future, and it cannot
   * be forged because a key that never reached `data` never reaches here.
   *
   * Values seeded through the constructor (`--param`, a resumed checkpoint)
   * are deliberately NOT recorded: they are inputs to the run, not something a
   * node produced.
   */
  written = /* @__PURE__ */ new Set();
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
  }
  static from(obj) {
    return new _Context(obj);
  }
  get(key) {
    return this.data.get(key);
  }
  has(key) {
    return this.data.has(key);
  }
  set(key, value) {
    this.data.set(key, value);
    this.written.add(key);
  }
  merge(updates) {
    for (const [k, v] of Object.entries(updates)) {
      this.data.set(k, String(v));
      this.written.add(k);
    }
  }
  /**
   * The keys written since the last call, and reset. Drained rather than read
   * so a caller cannot see one node's writes attributed to the next: the
   * engine drains before dispatching a node and reads immediately after, so
   * what it gets back is that node's writes and nothing else.
   */
  takeWritten() {
    const keys = [...this.written];
    this.written.clear();
    return keys;
  }
  snapshot() {
    return Object.fromEntries(this.data);
  }
  clone() {
    return new _Context(this.snapshot());
  }
};

// src/core/retry.ts
var DEFAULT_POLICY = {
  // Spec section 3.5: "If neither is set, the built-in default is 0 (no
  // retries)." A node that declares no retry attributes runs exactly once.
  maxRetries: 0,
  initialDelayMs: 200,
  factor: 2,
  // Section 3.6: "`max_delay_ms : Integer -- cap on delay in milliseconds
  // (default: 60000)`". This read 30_000, which is not a value the spec
  // offers anywhere -- it halved the ceiling on every long backoff.
  maxDelayMs: 6e4,
  jitter: true
};
function intAttr(value) {
  if (value === void 0) return void 0;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? void 0 : n;
}
function resolveRetryPolicy(node, graph) {
  const maxRetries = intAttr(node.attrs.max_retries) ?? intAttr(graph.attrs.default_max_retries) ?? intAttr(graph.attrs.default_max_retry) ?? DEFAULT_POLICY.maxRetries;
  return { ...DEFAULT_POLICY, maxRetries };
}
function backoffMs(policy, attempt, rand = Math.random) {
  const raw = policy.initialDelayMs * policy.factor ** attempt;
  const capped = Math.min(raw, policy.maxDelayMs);
  if (policy.jitter === false) return capped;
  return Math.round(capped * (0.5 + rand()));
}
function resolveRetryTarget(node, graph, opts) {
  const candidates = [
    node.attrs.retry_target,
    node.attrs.fallback_retry_target,
    ...opts.includeGraphLevel ? [graph.attrs.retry_target, graph.attrs.fallback_retry_target] : []
  ];
  for (const c of candidates) {
    if (c && graph.nodes.has(c)) return c;
  }
  return null;
}

// src/dot/lint.ts
var Severity = {
  ERROR: "error",
  WARNING: "warning",
  INFO: "info"
};
function reachableFrom(graph, startId) {
  const seen = /* @__PURE__ */ new Set([startId]);
  const queue = [startId];
  const hasGoalGate = [...graph.nodes.values()].some(wantsVerdict);
  if (hasGoalGate) {
    for (const attr of ["retry_target", "fallback_retry_target"]) {
      const target = graph.attrs[attr];
      if (target && graph.nodes.has(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  while (queue.length > 0) {
    const current = queue.shift();
    for (const e of outgoingEdges(graph, current)) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    const node = graph.nodes.get(current);
    if (node) {
      for (const attr of ["retry_target", "fallback_retry_target"]) {
        const target = node.attrs[attr];
        if (target && graph.nodes.has(target) && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
  }
  return seen;
}
var FILTERS = ["tail", "head", "grep", "sed", "awk", "cut", "sort", "uniq", "tr", "wc"];
var FILTER_HEAD = new RegExp(`^\\s*(${FILTERS.join("|")})\\b`);
var PIPEFAIL = /\bset\s+-[a-zA-Z]*o\b[^;&|]*\bpipefail\b/;
function stripSubstitutions(cmd) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] === "$" && cmd[i + 1] === "(") {
      depth++;
      i++;
      continue;
    }
    if (depth > 0 && cmd[i] === ")") {
      depth--;
      continue;
    }
    if (depth === 0) out += cmd[i];
  }
  return out.replace(/`[^`]*`/g, " ");
}
function isPredicateFilter(segment) {
  return /^\s*grep\b[^|]*\s-[a-zA-Z]*q/.test(segment);
}
function maskingPipeline(statement) {
  const segments = statement.split(/(?<!\|)\|(?!\|)/);
  if (segments.length < 2) return false;
  const pipesIntoFilter = segments.slice(1).some((s) => FILTER_HEAD.test(s));
  if (!pipesIntoFilter) return false;
  return !isPredicateFilter(segments[segments.length - 1]);
}
function statementsOf(cmd) {
  return cmd.split(/;|\n/).filter((s) => s.trim() !== "");
}
var CHAINED_SENTINEL = /&&\s*(printf|echo)\b/;
var BARE_SENTINEL = /^\s*(printf|echo)\b/;
var STATUS_CAPTURE = /^\s*[A-Za-z_][A-Za-z0-9_]*=\$\?/;
var ENGINE_MANAGED_DESCRIPTION = [
  ...ENGINE_MANAGED_KEYS,
  ...ENGINE_MANAGED_PREFIXES.map((p) => `${p}*`)
].join(", ");
var HANDLER_OWNED_KEYS = new Set(
  Object.values(INFERRED_OUTPUTS_BY_HANDLER).flatMap((keys) => [...keys])
);
var EMPTY_CONTEXT = new Context();
var FAILED = { status: Status.FAIL };
var SUCCEEDED = { status: Status.SUCCESS };
function isFailureRoute(condition) {
  if (condition === void 0) return false;
  return condition.split("&&").some(
    (clause) => clause.trim() !== "" && evaluateCondition(clause, EMPTY_CONTEXT, FAILED) && !evaluateCondition(clause, EMPTY_CONTEXT, SUCCEEDED)
  );
}
var NEVER_FAILS = PASSTHROUGH_KINDS;
function bypassesGates(graph, entry, gates, exits) {
  if (gates.has(entry)) return null;
  const seen = /* @__PURE__ */ new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    if (exits.has(current)) return current;
    for (const e of outgoingEdges(graph, current)) {
      if (gates.has(e.to) || seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return null;
}
function canReachWithoutPassing(graph, fromId, targets, avoid) {
  if (targets.has(fromId) && fromId !== avoid) return true;
  const seen = /* @__PURE__ */ new Set([fromId]);
  const queue = [fromId];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === avoid) continue;
    for (const e of outgoingEdges(graph, cur)) {
      if (seen.has(e.to)) continue;
      if (targets.has(e.to) && e.to !== avoid) return true;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return false;
}
function lint(graph) {
  const diags = [];
  const starts = findByHandler(graph, Handler.START);
  const exits = findByHandler(graph, Handler.EXIT);
  if (starts.length !== 1) {
    diags.push({
      code: "TOPO-001",
      severity: Severity.ERROR,
      message: `expected exactly one start node, found ${starts.length}`
    });
  }
  if (exits.length !== 1) {
    diags.push({
      code: "TOPO-002",
      severity: Severity.ERROR,
      message: `expected exactly one exit node, found ${exits.length}`
    });
  }
  for (const e of graph.edges) {
    for (const id of [e.from, e.to]) {
      if (!graph.nodes.has(id)) {
        diags.push({
          code: "TOPO-003",
          severity: Severity.ERROR,
          message: `edge ${e.from} -> ${e.to} references unknown node ${id}`
        });
      }
    }
  }
  for (const e of graph.edges) {
    const cond = e.attrs.condition;
    if (cond !== void 0 && !isValidConditionSyntax(cond)) {
      diags.push({
        code: "COND-001",
        severity: Severity.ERROR,
        node: e.from,
        message: `edge ${e.from} -> ${e.to} has a malformed condition="${cond}"; each &&-joined clause must be either "key=value", "key!=value", or a bare identifier (letters, digits, "_" or "." only, e.g. "context.ready") for a truthiness check -- anything else (a hyphen, a space, stray punctuation) is a typo that would otherwise resolve to an empty, always-false comparison instead of failing loudly`
      });
    }
  }
  if (starts.length === 1) {
    const reachable = reachableFrom(graph, starts[0].id);
    for (const node of graph.nodes.values()) {
      if (!reachable.has(node.id)) {
        diags.push({
          code: "TOPO-004",
          severity: Severity.ERROR,
          node: node.id,
          message: `node ${node.id} is unreachable from ${starts[0].id}`
        });
      }
    }
    for (const e of graph.edges) {
      if (e.to === starts[0].id) {
        diags.push({
          code: "TOPO-005",
          severity: Severity.ERROR,
          node: e.from,
          message: `edge ${e.from} -> ${e.to} enters the start node`
        });
      }
    }
  }
  for (const exitNode of exits) {
    if (outgoingEdges(graph, exitNode.id).length > 0) {
      diags.push({
        code: "TOPO-005",
        severity: Severity.ERROR,
        node: exitNode.id,
        message: `exit node ${exitNode.id} has outgoing edges`
      });
    }
  }
  for (const node of graph.nodes.values()) {
    if (node.handler === Handler.EXIT) continue;
    if (outgoingEdges(graph, node.id).length === 0) {
      diags.push({
        code: "TOPO-006",
        severity: Severity.WARNING,
        node: node.id,
        message: `node ${node.id} has no outgoing edges and is not the exit node -- a dead end. Neither section 7.2 nor the section 11.2 checklist requires this to be an error, and the engine's own runtime already refuses to treat a dead end as success (a run reaching this node halts with FAIL rather than silently exiting); this is a design-time hint, not a guarantee the runtime does not already provide`
      });
    }
  }
  for (const node of graph.nodes.values()) {
    if (node.attrs.type !== void 0 && !Object.hasOwn(TYPE_TO_HANDLER, node.attrs.type)) {
      diags.push({
        code: "TYPE-001",
        severity: Severity.ERROR,
        node: node.id,
        message: `node ${node.id} sets type="${node.attrs.type}", which is not a handler this engine resolves (known: ${Object.keys(TYPE_TO_HANDLER).join(", ")}); it would silently fall back to shape-based resolution instead of running as intended`
      });
    }
    if (node.handler === Handler.HUMAN && node.attrs.timeout) {
      const onTimeout = node.attrs.on_timeout;
      const defaultChoice = node.attrs["human.default_choice"];
      const labels = outgoingEdges(graph, node.id).map((e) => e.attrs.label);
      const normalisedLabels = labels.filter((l) => l !== void 0).map(normaliseLabel);
      if (onTimeout === void 0 && defaultChoice === void 0) {
        diags.push({
          code: "HITL-001",
          severity: Severity.ERROR,
          node: node.id,
          message: `human gate ${node.id} sets timeout="${node.attrs.timeout}" but declares neither on_timeout nor human.default_choice (spec section 6.5). A timeout must name the edge to take; there is no implicit fallback.`
        });
      } else {
        const declarations = [];
        if (onTimeout !== void 0) declarations.push({ attr: "on_timeout", value: onTimeout });
        if (defaultChoice !== void 0) {
          declarations.push({ attr: "human.default_choice", value: defaultChoice });
        }
        const unmatched = declarations.filter(
          (d) => !normalisedLabels.includes(normaliseLabel(d.value))
        );
        if (unmatched.length === declarations.length) {
          const found = labels.filter(Boolean).join(", ") || "none";
          const declaredText = unmatched.map((d) => `${d.attr}="${d.value}"`).join(", ");
          diags.push({
            code: "HITL-001",
            severity: Severity.ERROR,
            node: node.id,
            message: `human gate ${node.id} declares ${declaredText} but no outgoing edge carries that label (found: ${found})`
          });
        }
      }
    }
    if (UNREGISTERED_HANDLER_KINDS.includes(node.handler)) {
      diags.push({
        code: "HAND-001",
        severity: Severity.ERROR,
        node: node.id,
        message: `node ${node.id} resolves to handler "${node.handler}", which this build does not register (known unregistered: ${UNREGISTERED_HANDLER_KINDS.join(", ")}); the run would abort with "no handler registered" mid-pipeline. Refused here instead, before anything runs.`
      });
    }
    if (node.handler === Handler.PARALLEL) {
      const branchRootIds = [...new Set(outgoingEdges(graph, node.id).map((e) => e.to))];
      if (branchRootIds.length === 1) {
        diags.push({
          code: "PAR-002",
          severity: Severity.WARNING,
          node: node.id,
          message: `node ${node.id} is a parallel fan-out (Handler.PARALLEL) with exactly one distinct successor, ${branchRootIds[0]} -- a fan-out of one branch runs no differently than an ordinary edge would, so this is likely not what was intended`
        });
      } else if (branchRootIds.length >= 2) {
        const convergenceId = findConvergenceNode(graph, branchRootIds, node.id);
        if (convergenceId === null) {
          diags.push({
            code: "PAR-001",
            severity: Severity.ERROR,
            node: node.id,
            message: `node ${node.id} fans out to ${branchRootIds.join(", ")}, but no node is reachable from every branch -- there is nowhere for the pipeline to resume after the fan-out. Add a node every branch's path leads to, or route two of the branches back together`
          });
        } else {
          const partial = findPartialReconvergence(graph, branchRootIds, convergenceId, node.id);
          if (partial.length > 0) {
            diags.push({
              code: "PAR-004",
              severity: Severity.ERROR,
              node: node.id,
              message: `node ${node.id} fans out to ${branchRootIds.join(", ")}, converging on ${convergenceId} -- but ${partial.join(", ")} ${partial.length === 1 ? "is" : "are"} also reachable, before ${convergenceId}, either from two or more of those branches or as a shortcut from a single branch into what ${convergenceId} itself leads to. A node reached either way could be dispatched twice -- route every branch through a single shared node before ${convergenceId}, or ensure nothing reachable from ${convergenceId} is also reachable directly from a branch`
            });
          }
          const exitIds2 = new Set(findByHandler(graph, Handler.EXIT).map((n) => n.id));
          for (const rootId of branchRootIds) {
            if (canReachWithoutPassing(graph, rootId, exitIds2, convergenceId)) {
              diags.push({
                code: "PAR-005",
                severity: Severity.WARNING,
                node: node.id,
                message: `node ${node.id}'s branch root ${rootId} can reach the graph's real exit node without first passing through the fan-out's own convergence node ${convergenceId}. This branch alone stops there -- it does NOT stop the whole pipeline, and sibling branches proceed normally; there is no way to stop the whole run from inside a branch in this build. If an early stop for just this branch is intended, this warning can be ignored`
              });
            }
          }
        }
      }
      const declaredBy = /* @__PURE__ */ new Map();
      for (const rootId of branchRootIds) {
        const rootNode = graph.nodes.get(rootId);
        if (!rootNode) continue;
        for (const key of declaredOutputs(rootNode)) {
          const owner = declaredBy.get(key);
          if (owner !== void 0 && owner !== rootId) {
            diags.push({
              code: "PAR-003",
              severity: Severity.WARNING,
              node: node.id,
              message: `node ${node.id}'s branches ${owner} and ${rootId} both declare outputs="${key}" -- whichever branch is declared LAST wins when their writes merge back after the fan-out (branch declaration order, not completion order). This rule only sees each branch root's own declared outputs=, not inferred keys like tool.last_line -- a collision on those is caught only at runtime, logged as node.parallel.context_collision`
            });
          } else if (owner === void 0) {
            declaredBy.set(key, rootId);
          }
        }
      }
    }
    if (node.handler === Handler.HUMAN) {
      const channelTokens = (node.attrs["human.channel"] ?? "").split(",").map((t) => t.trim());
      const context = (node.attrs["human.context"] ?? "").trim();
      if (channelTokens.includes("agent") && context !== "") {
        const predecessor = directPredecessor(graph, node.id);
        if (predecessor?.handler === Handler.CODERGEN) {
          diags.push({
            code: "HITL-003",
            severity: Severity.WARNING,
            node: node.id,
            message: `human gate ${node.id} exposes context ("${node.attrs["human.context"]}") to its "agent" channel, but that context traces to its sole direct predecessor, ${predecessor.id}, which resolves to Handler.CODERGEN -- an LLM node whose own output may be the "evidence" the agent then judges (self-report). Advisory only: does not block the run, and does not detect multi-hop chains or Handler.TOOL predecessors (see ADR-006).`
          });
        }
      }
    }
    if (node.attrs.goal_gate !== void 0 && node.attrs.goal_gate !== "false") {
      if (node.attrs.goal_gate !== "true") {
        diags.push({
          code: "HITL-002",
          severity: Severity.ERROR,
          node: node.id,
          message: `node ${node.id} sets goal_gate="${node.attrs.goal_gate}"; the engine only recognises the exact strings "true" and "false" -- any other value (including "TRUE" or "1") silently disables the gate`
        });
      } else if (node.handler !== Handler.CODERGEN && node.handler !== Handler.TOOL) {
        diags.push({
          code: "HITL-002",
          severity: Severity.ERROR,
          node: node.id,
          message: `node ${node.id} sets goal_gate=true but is not a box or parallelogram node; only those handlers can produce evidence for a gate, so this one is satisfied by a no-op with zero evidence`
        });
      }
    }
    const declaredRunsOn = node.attrs.runs_on;
    if (declaredRunsOn !== void 0 && !Object.hasOwn(RUNS_ON_MODES, declaredRunsOn)) {
      diags.push({
        code: "RUNS-001",
        severity: Severity.ERROR,
        node: node.id,
        message: `node ${node.id} sets runs_on="${declaredRunsOn}", which this engine does not recognise (known: ${Object.keys(RUNS_ON_MODES).join(", ")}); it silently falls back to runs_on="${RunsOn.SUCCESS}", which re-arms the eager input check and can stop a cleanup node from running at the one moment it was written for`
      });
    }
    const gateRunsOn = runsOn(node);
    if (wantsVerdict(node) && gateRunsOn !== RunsOn.SUCCESS) {
      const skipClause = gateRunsOn === RunsOn.FAILURE ? `a gate that only ran when something else had already failed could never be earned on a healthy run, and skipping it would record a SUCCESS for a gate that produced no evidence; and ` : "";
      diags.push({
        code: "RUNS-002",
        severity: Severity.WARNING,
        node: node.id,
        message: `node ${node.id} is a goal gate with runs_on="${gateRunsOn}", which cannot be honoured and is ignored entirely for this node: ${skipClause}a gate relieved of the eager input check could earn its verdict against an input the engine has already recorded as unavailable, which is the same unearned success. The engine runs it, and makes it earn its verdict against real inputs. Drop the runs_on, or move the failure-only work to a node that is not a gate`
      });
    }
    for (const key of declaredOutputs(node)) {
      const managed = isEngineManagedKey(key);
      const handlerOwned = HANDLER_OWNED_KEYS.has(key);
      if (!managed && !handlerOwned) continue;
      const owner = managed ? `the engine-managed namespace (${ENGINE_MANAGED_DESCRIPTION})` : `a handler's own output set`;
      diags.push({
        code: "DATA-002",
        severity: Severity.ERROR,
        node: node.id,
        message: `node ${node.id} declares outputs="${key}", but ${key} belongs to ${owner} and no node can be contracted to produce it. A declaration enters the failed-output ledger when this node fails, so the engine would then refuse every downstream node referencing \${${key}} -- including one reading a value some other part of the system had genuinely written. Declare a key in your own namespace instead`
      });
    }
    const cmd = node.attrs.tool_command;
    if (cmd && !PIPEFAIL.test(cmd)) {
      const stmts = statementsOf(stripSubstitutions(cmd));
      for (let i = 0; i < stmts.length; i++) {
        if (!maskingPipeline(stmts[i])) continue;
        diags.push({
          code: "CMD-001",
          severity: Severity.WARNING,
          node: node.id,
          message: `tool_command pipes into a filter without 'set -o pipefail'; under sh the pipeline exits with the filter's status, masking real failure`
        });
        const next = stmts[i + 1] ?? "";
        const sentinel = CHAINED_SENTINEL.test(stmts[i]) || BARE_SENTINEL.test(next) && !STATUS_CAPTURE.test(next);
        if (sentinel) {
          diags.push({
            code: "CMD-002",
            severity: Severity.ERROR,
            node: node.id,
            message: `tool_command emits a routing sentinel after a pipe to a filter; the filter exits 0 unconditionally so the sentinel fires regardless of real success`
          });
        }
      }
    }
  }
  const supplied = new Set(Object.keys(graph.attrs));
  for (const node of graph.nodes.values()) {
    for (const key of effectiveOutputs(node)) supplied.add(key);
  }
  for (const node of graph.nodes.values()) {
    for (const key of referencedKeys(substitutableText(node))) {
      if (supplied.has(key)) continue;
      if (isEngineManagedKey(key)) continue;
      if (!key.includes(".")) continue;
      diags.push({
        code: "DATA-001",
        severity: Severity.WARNING,
        node: node.id,
        message: `node ${node.id} references \${${key}}, which no node declares: it is in no node's effective outputs, it is not an engine built-in (${ENGINE_MANAGED_DESCRIPTION}), and it is not a graph attribute. Either it is a typo, or its producer never declared it -- note that a box (LLM) node infers NO outputs at all, because a model's contextUpdates keys are arbitrary and the engine-managed guard filters them, so a box node whose result a successor consumes must say so explicitly with outputs="${key}". WARNING rather than ERROR because a --param supplies keys at runtime that lint cannot see; the engine's eager input check is the guard that actually stops the run.`
      });
    }
  }
  const gates = new Set(
    [...graph.nodes.values()].filter((n) => wantsVerdict(n)).map((n) => n.id)
  );
  const exitIds = new Set(exits.map((n) => n.id));
  if (gates.size > 0 && exitIds.size > 0) {
    const routes = [];
    for (const e of graph.edges) {
      if (!isFailureRoute(e.attrs.condition)) continue;
      const from = graph.nodes.get(e.from);
      if (from === void 0 || NEVER_FAILS.includes(from.handler)) continue;
      if (gates.has(e.from)) continue;
      routes.push({
        origin: e.from,
        target: e.to,
        what: `the failure edge ${e.from} -> ${e.to} [condition="${e.attrs.condition}"]`
      });
    }
    for (const node of graph.nodes.values()) {
      if (NEVER_FAILS.includes(node.handler) || gates.has(node.id)) continue;
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false });
      if (target === null) continue;
      routes.push({
        origin: node.id,
        target,
        what: `node ${node.id}'s retry_target="${target}"`
      });
    }
    for (const route of routes) {
      const reachedExit = bypassesGates(graph, route.target, gates, exitIds);
      if (reachedExit === null) continue;
      const diag = {
        code: "GATE-001",
        severity: Severity.WARNING,
        message: `${route.what} can reach the exit node ${reachedExit} without passing through any goal gate (declared: ${[...gates].join(", ")}). Spec section 3.4 checks goal gates on VISITED nodes only, so a gate this route skips is legitimately never consulted and section 11.3 then reports the run a success -- the engine is behaving exactly as specified, and the gate is what does not gate. Route the failure path through a gate, or place one on it, or the run can exit claiming success with the gate's work unjudged.`
      };
      if (route.origin !== void 0) diag.node = route.origin;
      diags.push(diag);
    }
  }
  return diags;
}
function hasErrors(diags) {
  return diags.some((d) => d.severity === Severity.ERROR);
}

// src/core/checkpoint.ts
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync as mkdirSync2,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { join as join2 } from "node:path";
function toWire(cp) {
  return {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: cp.runId,
    current_node: cp.currentNode,
    completed_nodes: cp.completed,
    node_retries: cp.attempts,
    context: cp.context,
    goal_gates_satisfied: cp.goalGatesSatisfied
  };
}
var FILE = "checkpoint.json";
function syncPath(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
  } finally {
    if (fd !== void 0) closeSync(fd);
  }
}
function saveCheckpoint(runDir, cp) {
  mkdirSync2(runDir, { recursive: true });
  const target = join2(runDir, FILE);
  const temp = `${target}.${process.pid}.tmp`;
  const fd = openSync(temp, "w");
  try {
    writeFileSync2(fd, JSON.stringify(toWire(cp), null, 2), "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, target);
  syncPath(runDir);
}

// src/run/events.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var FILE2 = "events.jsonl";
var EventLog = class {
  path;
  constructor(runDir) {
    mkdirSync3(runDir, { recursive: true });
    this.path = join3(runDir, FILE2);
  }
  append(event) {
    const stamped = { ts: (/* @__PURE__ */ new Date()).toISOString(), ...event };
    appendFileSync(this.path, `${JSON.stringify(stamped)}
`, "utf8");
  }
  /**
   * Read the log back.
   *
   * A crash during an append can leave a truncated final line. That line is
   * non-empty, so it survives the blank-line filter and would throw from
   * JSON.parse -- making the WHOLE log unreadable in exactly the situation
   * the log exists to survive. An append-only file can only be damaged at
   * its end, so an unparseable line ends the read and everything before it
   * is still returned.
   */
  all() {
    if (!existsSync2(this.path)) return [];
    const events = [];
    for (const line of readFileSync2(this.path, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        break;
      }
    }
    return events;
  }
};

// src/handlers/box.ts
import { mkdirSync as mkdirSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join4 } from "node:path";
function carriesVerdict(outcome, allowedUpdates) {
  if (outcome.preferredLabel !== void 0 && outcome.preferredLabel.length > 0) return true;
  if (outcome.suggestedNextIds !== void 0 && outcome.suggestedNextIds.length > 0) return true;
  if (allowedUpdates !== void 0 && Object.keys(allowedUpdates).length > 0) return true;
  return false;
}
var LAST_RESPONSE_MAX = 200;
var BoxHandler = class {
  backend;
  constructor(backend) {
    this.backend = backend;
  }
  async execute(ctx) {
    const rawPrompt = ctx.node.attrs.prompt || ctx.node.attrs.label || ctx.node.id;
    const prompt = substitute(rawPrompt, ctx.context);
    const nodeDir = join4(ctx.runDir, ctx.node.id);
    mkdirSync4(nodeDir, { recursive: true });
    writeFileSync3(join4(nodeDir, "prompt.md"), prompt, "utf8");
    ctx.events.append({ type: "node.box.start", node: ctx.node.id });
    const timeoutMs = parseDuration(ctx.node.attrs.timeout);
    const controller = timeoutMs > 0 ? new AbortController() : void 0;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : void 0;
    let outcome;
    try {
      outcome = await this.backend.run(
        ctx.node,
        prompt,
        ctx.context,
        ctx.graph,
        controller?.signal ?? ctx.signal,
        ctx.cwd
      );
    } finally {
      if (timer !== void 0) clearTimeout(timer);
    }
    let allowedUpdates;
    if (outcome.contextUpdates) {
      const rejected = Object.keys(outcome.contextUpdates).filter(isEngineManagedKey);
      if (rejected.length > 0) {
        ctx.events.append({
          type: "node.box.rejected_update",
          node: ctx.node.id,
          keys: rejected
        });
      }
      allowedUpdates = Object.fromEntries(
        Object.entries(outcome.contextUpdates).filter(([k]) => !isEngineManagedKey(k))
      );
      if (Object.keys(allowedUpdates).length > 0) ctx.context.merge(allowedUpdates);
    }
    const isGoalGate = wantsVerdict(ctx.node);
    let finalStatus = outcome.status;
    if (isGoalGate && (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL) && !carriesVerdict(outcome, allowedUpdates)) {
      finalStatus = Status.RETRY;
      ctx.events.append({
        type: "node.box.goal_gate_unverified",
        node: ctx.node.id,
        message: "goal gate returned prose with no verdict; failing closed to RETRY"
      });
    }
    const responseText = outcome.notes ?? "";
    const handlerUpdates = {
      last_stage: ctx.node.id,
      last_response: responseText.slice(0, LAST_RESPONSE_MAX)
    };
    ctx.context.merge(handlerUpdates);
    const finalOutcome = {
      ...outcome,
      status: finalStatus,
      // Reported on the Outcome as well as merged, because section 4.5 states
      // them as `context_updates` and status.json is what an external reader
      // consumes. A model-authored key the namespace guard REJECTED is still
      // reported here unmerged, exactly as before -- this adds the handler's
      // own two keys to that record and changes nothing about the filter.
      contextUpdates: { ...outcome.contextUpdates, ...handlerUpdates }
    };
    const statusFile = {
      outcome: finalOutcome.status,
      preferred_label: finalOutcome.preferredLabel,
      suggested_next_ids: finalOutcome.suggestedNextIds,
      context_updates: finalOutcome.contextUpdates,
      notes: finalOutcome.notes,
      // Section 5.2's `failure_reason`. Snake-cased like its neighbours,
      // because this file is the external wire shape a spec-conformant reader
      // parses, not our internal Outcome type.
      failure_reason: finalOutcome.failureReason
    };
    writeFileSync3(join4(nodeDir, "status.json"), JSON.stringify(statusFile, null, 2), "utf8");
    writeFileSync3(join4(nodeDir, "response.md"), responseText, "utf8");
    ctx.events.append({ type: "node.box.end", node: ctx.node.id, status: finalStatus });
    return finalOutcome;
  }
};

// src/handlers/parallel.ts
import { randomUUID } from "node:crypto";
import { join as join6 } from "node:path";

// src/run/worktree.ts
import { execFile } from "node:child_process";
import {
  existsSync as existsSync3,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join as join5, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var WT_PREFIX = "attractor-wt-";
async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
async function isGitRepo(dir) {
  try {
    return (await git(dir, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch {
    return false;
  }
}
var RACE_ERROR_PATTERN = /failed to read .*commondir/i;
var RACE_RETRY_MAX_ATTEMPTS = 4;
function raceRetryDelayMs(attempt) {
  return Math.min(10 * 2 ** attempt, 80) + Math.floor(Math.random() * 10);
}
async function addWorktreeWithRaceRetry(repoDir, branch, path) {
  for (let attempt = 0; ; attempt++) {
    const flag = attempt === 0 ? "-b" : "-B";
    try {
      await git(repoDir, ["worktree", "add", "-q", flag, branch, path]);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt + 1 >= RACE_RETRY_MAX_ATTEMPTS || !RACE_ERROR_PATTERN.test(message)) throw err;
      await sleep(raceRetryDelayMs(attempt));
    }
  }
}
async function createWorktree(repoDir, runId) {
  if (!await isGitRepo(repoDir)) {
    throw new Error(`not a git repository: ${repoDir} -- cannot create an isolated worktree`);
  }
  const branch = `attractor/${runId}`;
  const parent = mkdtempSync(join5(tmpdir(), WT_PREFIX));
  const path = join5(parent, runId);
  try {
    await addWorktreeWithRaceRetry(repoDir, branch, path);
  } catch (err) {
    rmSync(parent, { recursive: true, force: true });
    throw err;
  }
  return { path, branch };
}
function realOrResolved(p) {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}
function isOurWorktree(target) {
  const tmpRoot = realOrResolved(tmpdir());
  const t = realOrResolved(target);
  return t.startsWith(`${tmpRoot}${sep}`) && basename(dirname(t)).startsWith(WT_PREFIX);
}
async function hasUncommittedWork(worktreePath) {
  try {
    return (await git(worktreePath, ["status", "--porcelain"])).trim() !== "";
  } catch {
    return true;
  }
}
async function isRegisteredWorktree(repoDir, target) {
  try {
    const out = await git(repoDir, ["worktree", "list", "--porcelain"]);
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ") && realOrResolved(line.slice("worktree ".length)) === target) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
function isNonEmptyDirectory(path) {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return true;
  }
}
async function removeWorktree(repoDir, wt) {
  const target = realOrResolved(wt.path);
  const root = realOrResolved(repoDir);
  const ours = isOurWorktree(target);
  if (target === root || root.startsWith(`${target}${sep}`)) {
    return {
      removed: false,
      warning: `refusing to remove ${target}: it is, or contains, the repository root`
    };
  }
  const registered = existsSync3(target) && await isRegisteredWorktree(repoDir, target);
  if (registered && await hasUncommittedWork(target)) {
    return {
      removed: false,
      warning: `keeping ${target}: it has uncommitted work on branch ${wt.branch}. Commit it there, or delete the directory once you have salvaged it.`
    };
  }
  if (existsSync3(target) && ours && !registered && isNonEmptyDirectory(target)) {
    return {
      removed: false,
      warning: `keeping ${target}: git's administrative record for this worktree is gone, so its status cannot be verified, and the directory is not empty. Treating it as uncommitted work on branch ${wt.branch} rather than guessing it is safe to delete.`
    };
  }
  let gitError;
  try {
    await git(repoDir, ["worktree", "remove", "--force", target]);
  } catch (err) {
    gitError = (err instanceof Error ? err.message : String(err)).trim();
  }
  try {
    await git(repoDir, ["worktree", "prune"]);
  } catch {
  }
  const survivedGit = existsSync3(target);
  if (survivedGit) {
    if (!ours) {
      return {
        removed: false,
        warning: `refusing to delete ${target}: it is not a worktree this module created (expected a ${WT_PREFIX}* directory under the system temp directory)`
      };
    }
    try {
      rmSync(target, { recursive: true, force: true });
    } catch (err) {
      return { removed: false, warning: `could not remove worktree ${target}: ${String(err)}` };
    }
  }
  if (ours) {
    const parent = dirname(target);
    try {
      if (existsSync3(parent) && readdirSync(parent).length === 0) rmdirSync(parent);
    } catch {
    }
  }
  if (survivedGit && gitError !== void 0) {
    return {
      removed: true,
      warning: `git could not remove the worktree cleanly, directory was deleted directly: ${gitError}`
    };
  }
  return { removed: true };
}

// src/handlers/parallel.ts
function mergeBranchContext(parentContext, preforkSnapshot, branchRootIds, results, events) {
  if (branchRootIds.length !== results.length) {
    throw new Error(
      `mergeBranchContext: branchRootIds.length (${branchRootIds.length}) !== results.length (${results.length}) -- results must be positionally paired with branchRootIds, one BranchRunResult per branch root, in the same order`
    );
  }
  const mergedBy = /* @__PURE__ */ new Map();
  for (let i = 0; i < branchRootIds.length; i++) {
    const rootId = branchRootIds[i];
    const result = results[i];
    if (result.outcome.status !== Status.SUCCESS && result.outcome.status !== Status.PARTIAL) continue;
    for (const [key, value] of Object.entries(result.context)) {
      if (ENGINE_MANAGED_KEYS.includes(key)) continue;
      if (preforkSnapshot[key] === value) continue;
      const previousOwner = mergedBy.get(key);
      if (previousOwner !== void 0) {
        events.append({
          type: "node.parallel.context_collision",
          key,
          previousBranch: previousOwner,
          winningBranch: rootId
        });
      }
      mergedBy.set(key, rootId);
      parentContext.set(key, value);
    }
  }
}
function describeFailures(results, branchRootIds) {
  return results.map((r, i) => ({ r, id: branchRootIds?.[i] ?? `branch ${i}` })).filter(({ r }) => r.outcome.status !== Status.SUCCESS && r.outcome.status !== Status.PARTIAL).map(({ r, id }) => `${id}: ${r.outcome.failureReason ?? r.outcome.notes ?? "no reason given"}`).join("; ");
}
function applyDefaultJoinPolicy(results, branchRootIds) {
  const settled = results.filter(
    (r) => r.outcome.status === Status.SUCCESS || r.outcome.status === Status.PARTIAL
  );
  if (settled.length === 0) {
    const failures = describeFailures(results, branchRootIds);
    const notes = `all ${results.length} branch(es) failed` + (failures ? ` -- ${failures}` : "");
    return { status: Status.FAIL, notes, failureReason: notes };
  }
  if (settled.length === results.length) {
    return { status: Status.SUCCESS, notes: `all ${results.length} branch(es) succeeded` };
  }
  return {
    status: Status.PARTIAL,
    notes: `${settled.length}/${results.length} branch(es) succeeded or partially succeeded -- failed: ${describeFailures(results, branchRootIds)}`
  };
}
var Semaphore = class {
  available;
  waiters = [];
  constructor(permits) {
    this.available = permits;
  }
  async acquire() {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise((resolve3) => this.waiters.push(resolve3));
    this.available--;
  }
  release() {
    this.available++;
    const next = this.waiters.shift();
    if (next) next();
  }
};
function intAttr2(value) {
  if (value === void 0) return void 0;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? void 0 : n;
}
var DEFAULT_MAX_PARALLEL = 4;
var ParallelHandler = class {
  async execute(ctx) {
    const { node, graph, context, runDir, cwd, events } = ctx;
    const branchRootIds = [...new Set(outgoingEdges(graph, node.id).map((e) => e.to))];
    if (branchRootIds.length === 0) {
      return applyDefaultJoinPolicy([]);
    }
    const maxParallel = Math.max(1, intAttr2(node.attrs.max_parallel) ?? DEFAULT_MAX_PARALLEL);
    const semaphore = new Semaphore(maxParallel);
    const preforkSnapshot = context.snapshot();
    const convergenceId = findConvergenceNode(graph, branchRootIds, node.id);
    const stopAt = convergenceId ? /* @__PURE__ */ new Set([convergenceId]) : /* @__PURE__ */ new Set();
    const edgeFor = (rootId) => outgoingEdges(graph, node.id).find((e) => e.to === rootId);
    const dispatchBranch = async (rootId) => {
      const edge = edgeFor(rootId);
      const isolate = edge?.attrs.isolate !== "false";
      let worktree;
      try {
        let branchCwd = cwd;
        if (isolate) {
          worktree = await createWorktree(cwd, `${node.id}-${rootId}-${randomUUID().slice(0, 8)}`);
          branchCwd = worktree.path;
        }
        return await ctx.runBranch({
          startNodeId: rootId,
          stopAt,
          context: context.clone(),
          runDir: join6(runDir, rootId),
          cwd: branchCwd
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          outcome: { status: Status.FAIL, notes: message, failureReason: message },
          path: [],
          context: preforkSnapshot
        };
      } finally {
        if (worktree) {
          const removal = await removeWorktree(cwd, worktree);
          if (!removal.removed) {
            try {
              events.append({
                type: "node.parallel.worktree_warning",
                node: node.id,
                branch: rootId,
                warning: removal.warning
              });
            } catch {
            }
          }
        }
      }
    };
    const results = await Promise.all(
      branchRootIds.map(async (rootId) => {
        await semaphore.acquire();
        try {
          return await dispatchBranch(rootId);
        } finally {
          semaphore.release();
        }
      })
    );
    try {
      mergeBranchContext(context, preforkSnapshot, branchRootIds, results, events);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: Status.FAIL, notes: `merge-back failed: ${message}`, failureReason: message };
    }
    return applyDefaultJoinPolicy(results, branchRootIds);
  }
};

// src/core/engine.ts
var PassthroughHandler = class {
  async execute() {
    return { status: Status.SUCCESS };
  }
};
function defaultHandlers(backend) {
  const passthrough = new PassthroughHandler();
  return new Map([
    ...PASSTHROUGH_KINDS.map((kind) => [kind, passthrough]),
    [Handler.TOOL, new ToolHandler()],
    [Handler.CODERGEN, new BoxHandler(backend)],
    [Handler.PARALLEL, new ParallelHandler()]
  ]);
}
var DEFAULT_MAX_STEPS = 500;
var Engine = class {
  opts;
  events;
  path = [];
  completed = [];
  attempts = /* @__PURE__ */ new Map();
  /**
   * The LATEST outcome status of every goal gate the run has actually
   * visited, in first-visit order.
   *
   * Spec section 3.4: "Check all *visited* nodes that have `goal_gate=true`.
   * If any goal gate node has a non-success outcome (not SUCCESS or
   * PARTIAL_SUCCESS), the pipeline cannot exit." Two properties of that
   * sentence are load-bearing and were both missing:
   *
   * - *visited*. Iterating every declared node made a gate on a branch the
   *   run legitimately never took permanently unsatisfiable, so the exit
   *   bounced to its retry target until the step cap and then failed a run
   *   the spec exits successfully. A gate absent from this map was never
   *   reached and is not consulted.
   * - *latest*. This replaces a sticky satisfied-Set that was never cleared,
   *   under which a gate that passed on iteration 1 and failed on iteration 3
   *   still permitted exit -- a fail-OPEN divergence, and the exact shape of
   *   the false-success this plugin's fail-closed doctrine exists to stop.
   *
   * Nothing here weakens what counts as satisfaction: the set of statuses
   * that satisfy a gate (SUCCESS, PARTIAL) is unchanged, and BoxHandler's
   * fail-closed downgrade of an unearned verdict to RETRY is untouched.
   */
  gateOutcomes = /* @__PURE__ */ new Map();
  /**
   * Nodes holding an UNRESOLVED failure: they ended FAIL and have not since
   * been re-executed to SUCCESS or PARTIAL.
   *
   * This exists because routing and honesty are two different questions, and
   * the whole-branch review found the engine answering only the first. Two
   * individually-correct corrections compose into a run that reaches the exit
   * and reports SUCCESS while a node's FAIL sits unrecovered in the log:
   *
   * - A vacuously-true `!=` guard. Spec section 10.3 makes a missing key the
   *   empty string, so `condition="context.build_error!=fatal"` is TRUE when
   *   nothing ever writes `build_error`. Section 3.3 step 1 returns a matched
   *   conditional edge immediately, before fail-fast is ever consulted -- so
   *   the failure is carried forward by an edge the author did write, and
   *   fail-fast is not violated, it simply never runs.
   * - A FAIL `retry_target` whose route reaches the exit without passing the
   *   goal gate. Section 3.4 scopes the gate check to *visited* nodes, so an
   *   unvisited gate is correctly not consulted, and the fallback route is
   *   exactly the failure route section 3.7 says to take.
   *
   * This ledger is a RECORD, not a verdict. Section 11.3 decides the run
   * verdict purely by goal gates, so both shapes above legitimately report
   * SUCCESS. What was missing was not a different status; it was that nothing
   * above the event log could see the failure at all.
   *
   * Both findings are settled now and neither settlement was verdict-level:
   * I1 is CLOSED by the eager input check, which stops the first shape at the
   * consuming node -- but only for keys some node DECLARED via `outputs=`, so
   * an undeclared graph still lands here. I2 is RECLASSIFIED, not closed: the
   * engine was always conformant and the hazard is a graph shape, now caught
   * by the GATE-001 lint rule. See docs/superpowers/spec-conformance.md. This is what `RunResult.unresolvedFailures`, the
   * `pipeline.unresolved_failure` event and the CLI's stderr warning are all
   * built from.
   *
   * "Unresolved" is re-execution-based, not first-occurrence-based, so a
   * legitimate repair loop leaves nothing behind: `build` fails, routes to
   * `fix`, `fix` repairs, `build` re-runs green and clears itself here. RETRY
   * and SKIPPED neither add nor clear -- only an actual SUCCESS or PARTIAL
   * re-execution resolves a failure. Without that, the record would name
   * every node that ever stumbled and be worth nothing.
   *
   * There are TWO ways a node's work is given up on, and an accurate record
   * has to see both. The obvious one is a FAIL outcome. The other is an
   * exhausted RETRY that has a retry target: `Engine.run` rewrites an
   * exhausted RETRY to FAIL only when there is NO target, so with one the
   * node never reaches a FAIL status here at all -- it is abandoned mid-retry
   * and the run jumps away. The spec's own model says that node failed:
   * section 3.5's `execute_with_retry` returns `Outcome(status=FAIL,
   * failure_reason="max retries exceeded")` on exhaustion unconditionally,
   * and section 3.7's retry-target jump happens AFTER that, as failure
   * routing. So recording it is faithful to the spec, not an extension of it;
   * omitting it made `unresolvedFailures` silently wrong for the most
   * reachable failure there is -- a backend crash, malformed output or budget
   * abort on a node with a node- or graph-level retry target.
   * `recordAbandoned` is that second entry point.
   *
   * A `Map<string, boolean>` rather than a `Set`, because the documented
   * contract is FIRST-failure order and a Set does not deliver it: deleting a
   * recovered node and re-inserting it on a later failure moves it to the end,
   * so `a` fails, `b` fails, `a` recovers, `a` fails again reported
   * `[b, a]`. `Map.set` on an existing key preserves its original position, so
   * flipping the flag instead of deleting the entry keeps the order the
   * comment promises -- and first-failure order is the useful one, because it
   * points at the earliest thing that went wrong rather than the latest.
   */
  nodeFailures = /* @__PURE__ */ new Map();
  /**
   * The context keys the run is now MISSING, and the id of the node that owed
   * each one: `key -> owing node id`.
   *
   * `nodeFailures` answers "which nodes did the run give up on". That is not
   * enough for finding I1, whose defect is about KEYS rather than nodes: a
   * successor cannot distinguish "my producer failed and this key is never
   * arriving" from "this key is legitimately empty", because section 10.3
   * resolves a missing key to the empty string and a `!=` guard on it is then
   * vacuously true. This ledger is the missing half. A later task turns it
   * into an eager input check that refuses to invoke a handler whose
   * referenced keys appear here.
   *
   * Populated on exactly the two events `nodeFailures` already treats as
   * giving up on a node, and deliberately through the same two call sites --
   * `recordOutcome` and `recordAbandoned` -- rather than a parallel mechanism
   * beside them, so the two records cannot drift into disagreeing about what
   * counts as a failure. Those two events are one event in the spec's model:
   * section 3.5's `execute_with_retry` returns `Outcome(status=FAIL,
   * failure_reason="max retries exceeded")` on exhaustion unconditionally, and
   * section 3.7's retry-target jump happens AFTER that, as failure routing. In
   * our loop the abandoned node never reaches a FAIL status at all, so a
   * ledger keyed on FAIL alone would be silently empty for the most reachable
   * failure there is -- a backend crash on a node with a retry target.
   *
   * The keys are `declaredOutputs(node)` -- what the node's author declared it
   * would produce via `outputs=`, and nothing else. Imported from
   * `dot/graph.ts`, never re-derived here: a second opinion about what a node
   * produces is exactly the drift that design exists to eliminate.
   *
   * DECLARED and not EFFECTIVE, since fix round 2. The inferred half made the
   * failure-reporting branch of every tool pipeline unreachable, because
   * `tool.last_line` is inferred for every tool node and the stale-label rule
   * exists precisely so that key survives a failure to be read. See
   * `recordFailedOutputs` for the full argument.
   *
   * Cleared per NODE, by re-execution: when a node later executes to SUCCESS
   * or PARTIAL, the entries it owns are dropped. Same rule as `nodeFailures`,
   * so a repair loop leaves both empty. Ownership is checked by value rather
   * than by recomputing the node's outputs, so if two nodes declare the same
   * key the recovery of the one that does NOT currently own the entry cannot
   * erase the other's debt.
   *
   * A RECORD, NOT ROUTING STATE, and this one is not a preference. Plan 3
   * demonstrated -- not theorised -- that engine state a condition can read is
   * forgeable by a model through `contextUpdates`: `{current_node: 'start'}`
   * took a `condition="context.current_node=start"` branch, which is why
   * `isEngineManagedKey` covers the engine's built-ins today. This ledger
   * could not be defended that way even in principle, because its keys come
   * from `outputs=` and therefore live in the AUTHOR's namespace, which the
   * guard deliberately does not reserve. So it stays out of `Context`
   * entirely: nothing here is ever written through `setManaged` or `set`, and
   * the only way out is `outputsOwedByFailedNodes`, which hands back a copy.
   */
  failedOutputs = /* @__PURE__ */ new Map();
  /**
   * Steps taken across the WHOLE run, main loop and every branch (p5-05)
   * alike -- one shared instance field, not a loop-local variable. Without
   * this, a branch containing a routing cycle that never reaches its stop
   * frontier has no bound of its own, and `max_parallel` branches each
   * independently capped at maxSteps would multiply the run-wide ceiling
   * NFR-1 exists to hold. Incremented once per `executeNodeStep` call,
   * whether that call continues to a new node or retries the same one.
   */
  stepCount = 0;
  constructor(opts) {
    this.opts = opts;
    this.events = new EventLog(opts.runDir);
  }
  checkpoint(current) {
    const cp = {
      runId: this.opts.runId ?? "run",
      currentNode: current,
      completed: [...this.completed],
      attempts: Object.fromEntries(this.attempts),
      context: this.opts.context.snapshot(),
      // Derived, not stored: the checkpoint's section 5.3 wire field stays
      // exactly what Task 2 defined, while the engine's own state is now the
      // richer per-gate outcome map.
      goalGatesSatisfied: [...this.gateOutcomes].filter(([, s]) => s === Status.SUCCESS || s === Status.PARTIAL).map(([id]) => id)
    };
    saveCheckpoint(this.opts.runDir, cp);
  }
  unsatisfiedGoalGates() {
    const gates = [];
    for (const [id, status] of this.gateOutcomes) {
      if (status !== Status.SUCCESS && status !== Status.PARTIAL) gates.push(id);
    }
    return gates;
  }
  /**
   * Where a run blocked at its exit by unsatisfied goal gates should jump.
   *
   * Spec section 3.4 step 3: "Instead, jump to the `retry_target` OF THE
   * UNSATISFIED GOAL GATE NODE. If that is not set, try
   * `fallback_retry_target`. If that is also not set, try the graph-level
   * `retry_target` and `fallback_retry_target`." That is exactly
   * `resolveRetryTarget`'s four-rung ladder -- applied to the GATE.
   *
   * This branch passed the EXIT node instead. Rungs 1 and 2 are the node's own
   * two attributes, so a gate's own repair loop could never fire; rungs 3 and 4
   * read `graph.attrs` whatever node they are handed, which is why the ladder
   * appeared to work at all and why the defect survived. The precedence was not
   * merely incomplete, it was INVERTED: a gate naming one target and a graph
   * naming another jumped to the graph's.
   *
   * WHICH GATE, when several are unsatisfied, IS NOT STATED BY THE SPEC, so
   * this is a recorded choice. Section 3.4's own `check_goal_gates` iterates
   * `node_outcomes` and RETURNS on the first gate it finds unsatisfied -- it
   * hands the caller one gate, the first in traversal order -- so taking the
   * FIRST-VISITED unsatisfied gate is the reading closest to the pseudocode.
   * It is also the useful one: it points at the earliest stage that failed to
   * converge rather than the last, which is the same ordering
   * `unresolvedFailures` already promises, and it is deterministic, which
   * "any unsatisfied gate" would not be.
   *
   * `unsatisfiedGoalGates()` derives from `gateOutcomes`, a Map in first-visit
   * order, so `unsatisfied[0]` IS that gate.
   *
   * The exit node's own `retry_target` is deliberately no longer consulted:
   * section 3.4's ladder does not contain it, and section 2.6 defines
   * `retry_target` as where to jump "if THIS NODE fails" -- a terminal node
   * does not fail. The graph-level rungs are unchanged, which is what keeps
   * every pipeline that relied on them working.
   */
  gateRetryTarget(unsatisfied) {
    const gate = this.opts.graph.nodes.get(unsatisfied[0]);
    if (gate === void 0) return null;
    return resolveRetryTarget(gate, this.opts.graph, { includeGraphLevel: true });
  }
  /** Nodes whose failure nothing has resolved, in first-failure order. */
  unresolvedFailures() {
    const ids = [];
    for (const [id, unresolved] of this.nodeFailures) if (unresolved) ids.push(id);
    return ids;
  }
  /**
   * The context keys no node is going to produce any more, each mapped to the
   * node that owed it. A COPY, so a caller cannot edit the engine's record by
   * mutating what it reads -- the ledger is evidence about a run, and evidence
   * a reader can rewrite is not evidence.
   *
   * Public because the ledger is otherwise unobservable, and a test that
   * reached into the private field with a cast would be testing the field
   * rather than the behaviour: it would keep passing if the engine started
   * leaking these keys into `Context`, which is the one thing that must never
   * happen. Returning it here rather than on `RunResult` is deliberate too --
   * `RunResult` crosses into the CLI and the event log, and this is engine
   * state that later tasks consume in-process.
   */
  outputsOwedByFailedNodes() {
    return new Map(this.failedOutputs);
  }
  /**
   * The run gave up on this node, so every key it DECLARED it would produce is
   * now owed and never coming.
   *
   * `declaredOutputs` and NOT `effectiveOutputs`. This read `effectiveOutputs`
   * until fix round 2, and the inferred half of that union made the
   * failure-reporting branch of every tool pipeline unreachable:
   *
   *     build  [shape=parallelogram, tool_command="exit 1"]
   *     notify [shape=parallelogram, tool_command="printf 'said: ${tool.last_line}'"]
   *     build -> notify [condition="outcome=fail"]
   *
   * `tool.last_line` is inferred for EVERY tool node, so `build` failing
   * recorded it as owed, and the eager input check then refused `notify` --
   * the node whose entire job is to report the failure. No `outputs=` appears
   * anywhere in that graph, so no author opt-in was required to hit it, and
   * `notify` then re-recorded the key against ITSELF without ever executing,
   * poisoning it for everything downstream.
   *
   * The reason this is doctrine and not tuning: THE STALE-LABEL RULE EXISTS
   * PRECISELY SO THAT A FAILING TOOL NODE'S PREVIOUS `tool.last_line` SURVIVES
   * TO BE READ. That is the whole point of the rule and it is in the
   * non-tradeable list in AGENTS.md. A ledger marking the same key
   * "unavailable" contradicts it head on -- the two mechanisms were arguing,
   * and the doctrine wins. The old comment here had the argument exactly
   * backwards: it cited the stale-label rule as the REASON `tool.last_line` is
   * owed, when that rule is the reason the key is still worth reading.
   *
   * It also puts the ledger where the design always said it belonged.
   * `outputs=` is a node DECLARING A CONTRACT; inference exists so DATA-001 can
   * reason about what a graph supplies, and was never evidence that anyone
   * promised anything. A key nobody declared is not a debt anybody owes, so
   * the ledger has nothing to say about it and the eager check stays silent.
   *
   * The consequence an author should know: a box node infers nothing and now a
   * tool node contributes nothing either, so `outputs=` is the ONLY way a node
   * joins the dataflow contract. That is the design's own position, stated in
   * its open question 2, and DATA-001 is the design-time hint that says so.
   *
   * Re-recording an entry this node already owns is a no-op by construction,
   * which matters because `recordOutcome` runs twice per step.
   */
  recordFailedOutputs(nodeId) {
    const node = this.opts.graph.nodes.get(nodeId);
    if (node === void 0) return;
    for (const key of declaredOutputs(node)) this.failedOutputs.set(key, nodeId);
  }
  /**
   * This node re-executed successfully, so it has settled its own debts.
   *
   * Deletes by OWNER, not by recomputing the node's output set: if two nodes
   * declare the same key, only the one currently recorded as owing it can
   * clear it. Recomputing would let a node that never owed the entry erase the
   * debt of the node that did.
   */
  clearFailedOutputs(nodeId) {
    for (const [key, owner] of this.failedOutputs) {
      if (owner === nodeId) this.failedOutputs.delete(key);
    }
  }
  /**
   * The EAGER INPUT CHECK: the first key this node references that a node the
   * run gave up on was contracted to produce, and the id of that node.
   *
   * This is finding I1's fix. A node fails; a later node's edge guards on a
   * key the failed node owed; section 10.3 resolves the missing key to the
   * empty string, so `context.artifact.path!=bad` is vacuously TRUE, section
   * 3.3 step 1 returns that matched conditional edge before fail-fast is ever
   * consulted, and the run walks into a node whose inputs do not exist.
   * Section 10.3 is correct and is untouched: the missing half was that a
   * successor could not tell "my producer failed and this key is never
   * arriving" from "this key is legitimately empty". `failedOutputs` is that
   * half, and this is what reads it.
   *
   * The reference set comes from `substitutableText` in `dot/graph.ts`, not
   * from a list of attribute names kept here, and the tokenizer is
   * `referencedKeys`, which walks `substitute`'s own pattern. Both are shared
   * with the DATA-001 lint rule on purpose: the design-time warning and the
   * runtime halt must agree about what counts as a reference, or a graph lints
   * clean and then dies on a key lint could have named.
   *
   * FIRST match, in the order the reference appears in the text, so the
   * message is deterministic when several inputs are missing at once. Naming
   * one key precisely is more use to an operator than naming a set.
   *
   * A key this node OWES ITSELF is skipped, and that exemption is
   * load-bearing rather than tidy. The node that would settle such a debt is
   * this one; blocking it on its own debt makes the debt permanently
   * unsettleable, so a node whose command mentions its own `outputs=` key
   * (`tool_command="make ${artifact.path}", outputs="artifact.path"`) could
   * never be retried after its first failure -- the repair loop that
   * `clearFailedOutputs` exists to support would deadlock instead.
   */
  unavailableInput(node) {
    for (const key of referencedKeys(substitutableText(node))) {
      const owedBy = this.failedOutputs.get(key);
      if (owedBy !== void 0 && owedBy !== node.id) return { key, owedBy };
    }
    return void 0;
  }
  /**
   * Is the run currently holding a failure nothing has recovered? This is what
   * `runs_on=failure` asks.
   *
   * TWO RECORDS EXIST AND THEY ANSWER DIFFERENT QUESTIONS. `failedOutputs` is
   * keyed by context KEY and answers "which inputs are missing, and who owed
   * them" -- a DATAFLOW question, and the eager input check's business.
   * `nodeFailures` is keyed by NODE and answers "which nodes did the run give
   * up on" -- a CONTROL-FLOW question. "Should this node run at all" is control
   * flow, so it reads the node record, through the same `unresolvedFailures()`
   * the run result and the CLI warning are built from rather than a second
   * scan of the same map.
   *
   * The design says a `runs_on=failure` node "runs only if one of its
   * REFERENCED producers failed", which would be the key-scoped reading. The
   * handlers were read instead of the design transcribed, and the key-scoped
   * reading does not survive contact with them:
   *
   * - A box node's inferred output set is deliberately EMPTY -- a model's
   *   `contextUpdates` keys are arbitrary and filtered, so there is nothing
   *   honest to infer. A failing box node with no `outputs=` therefore puts
   *   NOTHING in the ledger, and that is the single most common failure this
   *   engine has. A key-scoped `runs_on=failure` would silently never fire
   *   after it.
   * - It leaves a node with no references at all -- `notify [runs_on=failure,
   *   tool_command="send-alert"]`, which references nothing by nature --
   *   permanently dead code, decided by whether the author happened to write a
   *   `${}` anywhere. That is not predictable from reading the graph.
   *
   * So there is ONE rule with no cases: a `runs_on=failure` node runs when the
   * run is holding an unrecovered failure. A reader predicts it from the
   * attribute name alone, and the degenerate no-reference case is not
   * degenerate because references play no part in the decision.
   *
   * The cost is accepted deliberately: a `runs_on=failure` node fires for a
   * failure elsewhere in the run rather than only for one it consumes from. It
   * is the same "unresolved" the whole plugin already reports, cleared the same
   * way -- by re-executing the failed node to SUCCESS or PARTIAL -- so a repair
   * loop that fixed everything leaves this false, and a failure the author
   * routed around but never repaired leaves it true. That is the honest state
   * of the run at the moment the node is reached.
   */
  holdsUnresolvedFailure() {
    return this.unresolvedFailures().length > 0;
  }
  /**
   * The run gave up on this node without it ever reaching a FAIL status.
   *
   * Reached when a RETRY exhausts its policy and a retry target exists, which
   * is the engine abandoning the node's work and routing elsewhere. The
   * record must not depend on whether a fallback happened to be declared: an
   * identical run whose graph declares no `retry_target` is rewritten to FAIL
   * and recorded, and it would be incoherent for adding a fallback route to
   * erase the node from the record of what failed.
   *
   * Record-only. The node's `Outcome` is NOT rewritten to FAIL on this path,
   * even though section 3.5's pseudocode does rewrite it, because doing so
   * here would push `fail` into the routing-visible `context.outcome` before
   * the jump and could change which edge the target node takes. That is a
   * routing change and is out of scope; the divergence is recorded in
   * docs/superpowers/spec-conformance.md.
   */
  recordAbandoned(nodeId) {
    this.nodeFailures.set(nodeId, true);
    this.recordFailedOutputs(nodeId);
  }
  /**
   * Build every terminal RunResult through one place, so the unresolved-FAIL
   * record cannot be attached to some exit paths and forgotten on others --
   * which is how the record would quietly become "present when we remembered"
   * instead of "present when the run holds one".
   */
  result(status, notes, failureReason) {
    const result = { status, path: this.path };
    if (notes !== void 0) result.notes = notes;
    if (failureReason !== void 0 && status === Status.FAIL) {
      result.failureReason = failureReason;
    }
    const unresolved = this.unresolvedFailures();
    if (unresolved.length > 0) result.unresolvedFailures = unresolved;
    return result;
  }
  /**
   * Spec section 3.2 step 4 and section 5.1's built-in keys.
   *
   * `outcome` is set unconditionally; `preferred_label` only when non-empty,
   * which is the spec's own wording ("IF outcome.preferred_label is not
   * empty") and means the last non-empty label survives a node that offered
   * none. Note that a *bare* `outcome`/`preferred_label` in a condition is
   * answered from the live Outcome object by condition.ts, not from here;
   * these keys are what makes the `context.`-qualified spelling resolve.
   *
   * Called both immediately after a handler returns and again after the retry
   * machine has had its say, because an exhausted RETRY is rewritten to FAIL
   * before edge selection -- recording only the first would leave
   * `context.outcome` saying "retry" while the edge being selected sees
   * "fail".
   */
  recordOutcome(nodeId, outcome, context) {
    const node = this.opts.graph.nodes.get(nodeId);
    if (node !== void 0 && wantsVerdict(node)) {
      this.gateOutcomes.set(nodeId, outcome.status);
    }
    if (outcome.status === Status.FAIL) {
      this.nodeFailures.set(nodeId, true);
      this.recordFailedOutputs(nodeId);
    } else if (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL) {
      if (this.nodeFailures.has(nodeId)) this.nodeFailures.set(nodeId, false);
      this.clearFailedOutputs(nodeId);
    }
    this.setManaged(context, "outcome", outcome.status);
    if (outcome.preferredLabel !== void 0 && outcome.preferredLabel !== "") {
      this.setManaged(context, "preferred_label", outcome.preferredLabel);
    }
  }
  /**
   * Write a built-in context key, refusing any key the model-facing guard in
   * `handlers/box.ts` would not already reject.
   *
   * This is the mechanism that keeps the two ends of `isEngineManagedKey`
   * honest. Making a key routing-visible without reserving it is precisely
   * how this task's own correction opened forgeable routing surface; adding
   * the next built-in without registering it would do the same silently. A
   * throw rather than an event because this can only fire on a developer
   * mistake, never on run data -- a loud abort is right for the one case
   * where the control plane has caught itself, and any test touching the new
   * key will surface it immediately.
   */
  setManaged(context, key, value) {
    if (!isEngineManagedKey(key)) {
      throw new Error(
        `engine built-in context key ${key} is not covered by isEngineManagedKey; register it there so a backend cannot forge it`
      );
    }
    context.set(key, value);
  }
  /**
   * Runs exactly one node's step: dispatch (eager-input-check, `runs_on`
   * skip logic, handler call or skip, the RETRY ladder with its two
   * `recordOutcome` calls), then a per-node checkpoint via the exported
   * `saveCheckpoint` directly -- never the private `this.checkpoint()`
   * wrapper, which after this refactor is called only by `run()`'s own
   * EXIT/dead-end/step-cap terminal paths (ADR-012). The ONE seam both
   * `run()`'s own loop and `runBranch` (p5-05) call.
   *
   * Node lookup, the `current_node` context write, and handler lookup all
   * live HERE rather than in a caller's wrapper -- see this task's own
   * Step 2: an existing test requires `RunResult.path` to already contain a
   * node by the moment its handler-lookup failure is reported. `path.push`
   * lives HERE too (final-review correction, p5-05 addendum's own bug):
   * each caller passes its OWN `path` array via `opts.path` -- `run()`'s
   * loop passes `this.path`; `runBranch`'s loop passes its own local
   * `path` -- so a branch's internal node ids still cannot leak into the
   * outer run's own `this.path` (the original addendum's own concern,
   * still closed). But the push itself happens HERE, immediately after the
   * step-cap check above, not in the caller before this method is even
   * entered: the addendum's own relocation pushed unconditionally BEFORE
   * calling this method, meaning a dispatch the step-cap check went on to
   * block still left its id in `path` -- a phantom, never-actually-executed
   * hop (no `node.start`, no handler call) on every step-cap termination,
   * on ANY graph, not just ones with a branch. Pushing after the step-cap
   * check and before node/handler lookup keeps the pre-dispatch-failure
   * invariant above intact while closing that regression.
   * Folded into the `'deadend'` stop reason alongside the ordinary
   * "no outgoing edge" case, since from a caller's point of view all three
   * are "this step produced no next node to continue to"; the one accepted,
   * documented behavioural delta is that `run()`'s uniform handling of
   * `'deadend'` always calls `this.checkpoint(null)`, where today's
   * unknown-node/no-handler-registered paths did not -- an extra, harmless
   * checkpoint write on an already-terminal FAIL that no existing test
   * observes.
   */
  async executeNodeStep(currentId, opts) {
    const { graph } = this.opts;
    const context = opts.context;
    if (++this.stepCount > opts.maxSteps) {
      const capped = `step cap of ${opts.maxSteps} reached without terminating`;
      return {
        kind: "stop",
        reason: "stepcap",
        nodeId: currentId,
        outcome: { status: Status.FAIL, notes: capped, failureReason: capped }
      };
    }
    opts.path.push(currentId);
    const node = graph.nodes.get(currentId);
    if (!node) {
      const msg = `unknown node ${currentId}`;
      return {
        kind: "stop",
        reason: "deadend",
        nodeId: currentId,
        outcome: { status: Status.FAIL, notes: msg, failureReason: msg }
      };
    }
    this.setManaged(context, "current_node", node.id);
    const handler = this.opts.handlers.get(node.handler);
    if (!handler) {
      const msg = `no handler registered for ${node.handler} (node ${node.id})`;
      return {
        kind: "stop",
        reason: "deadend",
        nodeId: node.id,
        outcome: { status: Status.FAIL, notes: msg, failureReason: msg }
      };
    }
    const attempt = this.attempts.get(node.id) ?? 0;
    this.attempts.set(node.id, attempt + 1);
    this.events.append({ type: "node.start", node: node.id });
    context.takeWritten();
    let outcome;
    const mode = runsOn(node);
    const checksInputs = mode === RunsOn.SUCCESS || wantsVerdict(node);
    const unavailable = checksInputs ? this.unavailableInput(node) : void 0;
    if (unavailable) {
      this.events.append({
        type: "node.input_unavailable",
        node: node.id,
        key: unavailable.key,
        owedBy: unavailable.owedBy
      });
      outcome = {
        status: Status.FAIL,
        notes: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`,
        failureReason: `required input '${unavailable.key}' unavailable: node '${unavailable.owedBy}' failed`
      };
    } else if (mode === RunsOn.FAILURE && !wantsVerdict(node) && !this.holdsUnresolvedFailure()) {
      this.events.append({ type: "node.runs_on.skipped", node: node.id, runsOn: mode });
      outcome = {
        status: Status.SUCCESS,
        notes: `${node.id} did not run: runs_on=failure and no failure is outstanding`
      };
    } else {
      try {
        outcome = await handler.execute({
          node,
          graph,
          context,
          runDir: opts.runDir,
          cwd: opts.cwd,
          events: this.events,
          runBranch: (o) => this.runBranch(o)
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.events.append({ type: "node.error", node: node.id, message });
        outcome = { status: Status.FAIL, notes: message, failureReason: message };
      }
    }
    for (const key of context.takeWritten()) this.failedOutputs.delete(key);
    this.events.append({ type: "node.end", node: node.id, status: outcome.status });
    this.recordOutcome(node.id, outcome, context);
    if (outcome.status === Status.RETRY) {
      const policy = resolveRetryPolicy(node, graph);
      if (attempt < policy.maxRetries) {
        const delay = backoffMs(policy, attempt);
        this.events.append({
          type: "node.retry",
          node: node.id,
          attempt: attempt + 1,
          delayMs: delay
        });
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        return { kind: "continue", nextId: node.id };
      }
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false });
      this.events.append({ type: "node.retry.exhausted", node: node.id, target });
      if (target) {
        this.recordAbandoned(node.id);
        this.attempts.set(node.id, 0);
        return { kind: "continue", nextId: target };
      }
      outcome = {
        ...outcome,
        status: Status.FAIL,
        notes: `retries exhausted for ${node.id} with no retry target`,
        failureReason: "max retries exceeded"
      };
    }
    this.recordOutcome(node.id, outcome, context);
    this.attempts.set(node.id, 0);
    if (!this.completed.includes(node.id)) this.completed.push(node.id);
    const cp = {
      runId: this.opts.runId ?? "run",
      currentNode: node.id,
      completed: [...this.completed],
      attempts: Object.fromEntries(this.attempts),
      context: context.snapshot(),
      goalGatesSatisfied: [...this.gateOutcomes].filter(([, s]) => s === Status.SUCCESS || s === Status.PARTIAL).map(([id]) => id)
    };
    saveCheckpoint(opts.runDir, cp);
    if (node.handler === Handler.EXIT) {
      return { kind: "stop", reason: "exit", nodeId: node.id, outcome };
    }
    if (node.handler === Handler.PARALLEL && (outcome.status === Status.SUCCESS || outcome.status === Status.PARTIAL)) {
      const branchRootIds = [...new Set(outgoingEdges(graph, node.id).map((e) => e.to))];
      const convergenceId = findConvergenceNode(graph, branchRootIds, node.id);
      if (convergenceId) {
        if (opts.stopAt?.has(convergenceId)) {
          return { kind: "stop", reason: "frontier", nodeId: node.id, outcome };
        }
        return { kind: "continue", nextId: convergenceId };
      }
    }
    const edge = selectEdge(graph, node.id, context, outcome);
    if (!edge && outcome.status === Status.FAIL) {
      const target = resolveRetryTarget(node, graph, { includeGraphLevel: false });
      if (target) {
        this.events.append({ type: "node.fail.retry_target", node: node.id, target });
        return { kind: "continue", nextId: target };
      }
    }
    if (!edge) {
      const notes = outcome.status === Status.FAIL ? `no matching edge from ${node.id} after failure: ${outcome.notes ?? ""}` : `run terminated at ${node.id}, which has no outgoing edges and is not the exit`;
      return {
        kind: "stop",
        reason: "deadend",
        nodeId: node.id,
        // status is forced to FAIL here (even when the dispatch's own
        // outcome was SUCCESS/PARTIAL with simply no matching edge) --
        // run()'s own interpretation of 'deadend' never reads
        // outcome.status (it hardcodes Status.FAIL onto its own RunResult
        // regardless), so this is inert for run(); it matters for
        // runBranch (Task 5), whose BranchRunResult.outcome is this object
        // verbatim and whose own contract requires status === FAIL for a
        // true dead end unconditionally.
        outcome: { ...outcome, status: Status.FAIL, notes, failureReason: outcome.failureReason ?? notes }
      };
    }
    if (opts.stopAt?.has(edge.to)) {
      return { kind: "stop", reason: "frontier", nodeId: node.id, outcome };
    }
    this.events.append({ type: "edge.taken", node: node.id, to: edge.to });
    return { kind: "continue", nextId: edge.to };
  }
  /**
   * A bounded forward traversal of the SAME graph, starting at
   * opts.startNodeId, using the exact per-node step logic executeNodeStep
   * (Task 2) already implements -- against this Engine's own shared
   * gateOutcomes/nodeFailures/failedOutputs/stepCount ledgers. REJECTED: one
   * independent `new Engine(...)` per branch -- a fresh instance would own
   * its own empty ledgers, so a goal gate inside a branch would satisfy or
   * fail a map nothing outside that branch's own instance ever reads,
   * silently reopening the fail-open hole those ledgers exist to close
   * (ADR-009).
   *
   * Treats EVERY stop reason -- 'exit', 'frontier', 'deadend', 'stepcap' --
   * identically: stop looping and return whatever outcome/path the branch
   * ended with. In particular, dispatching the graph's real EXIT node is an
   * ORDINARY DEAD END for this branch alone (ADR-007's amendment): this
   * method never calls unsatisfiedGoalGates(), never calls
   * this.checkpoint(null), and never returns an Engine.RunResult -- that
   * logic lives EXCLUSIVELY in run()'s own interpretation of a
   * `{ kind: 'stop', reason: 'exit' }` result, a branch this uniform
   * handling structurally cannot reach.
   */
  async runBranch(opts) {
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS;
    const path = [];
    const context = opts.context.clone();
    let currentId = opts.startNodeId;
    for (; ; ) {
      const stepResult = await this.executeNodeStep(currentId, {
        runDir: opts.runDir,
        cwd: opts.cwd,
        maxSteps,
        stopAt: opts.stopAt,
        context,
        path
      });
      if (stepResult.kind === "continue") {
        currentId = stepResult.nextId;
        continue;
      }
      return { outcome: stepResult.outcome, path, context: context.snapshot() };
    }
  }
  async run() {
    const { graph, context } = this.opts;
    const maxSteps = this.opts.maxSteps ?? DEFAULT_MAX_STEPS;
    const diagnostics = lint(graph);
    if (hasErrors(diagnostics)) {
      const detail = diagnostics.filter((d) => d.severity === Severity.ERROR).map((d) => `${d.code}${d.node ? ` (${d.node})` : ""}: ${d.message}`).join("; ");
      const msg = `graph carries error-severity lint diagnostics and will not run: ${detail}`;
      this.events.append({ type: "pipeline.end", status: Status.FAIL });
      return this.result(Status.FAIL, msg, msg);
    }
    const startNode = [...graph.nodes.values()].find((n) => n.handler === Handler.START);
    if (!startNode) {
      this.events.append({ type: "pipeline.end", status: Status.FAIL });
      return this.result(Status.FAIL, "graph has no start node", "graph has no start node");
    }
    for (const [k, v] of Object.entries(graph.attrs)) {
      if (!context.has(k)) context.set(k, v);
      const qualified = `graph.${k}`;
      if (!context.has(qualified)) this.setManaged(context, qualified, v);
    }
    let currentId = startNode.id;
    this.events.append({ type: "pipeline.start", node: startNode.id });
    while (currentId !== null) {
      const stepResult = await this.executeNodeStep(currentId, {
        runDir: this.opts.runDir,
        cwd: this.opts.cwd,
        maxSteps,
        stopAt: void 0,
        context,
        path: this.path
      });
      if (stepResult.kind === "continue") {
        currentId = stepResult.nextId;
        continue;
      }
      const { reason, nodeId, outcome } = stepResult;
      if (reason === "exit") {
        const unsatisfied = this.unsatisfiedGoalGates();
        if (unsatisfied.length > 0) {
          const target = this.gateRetryTarget(unsatisfied);
          this.events.append({
            type: "pipeline.goal_gate_block",
            node: nodeId,
            unsatisfied,
            target
          });
          if (target) {
            currentId = target;
            continue;
          }
          this.events.append({ type: "pipeline.end", node: nodeId, status: Status.FAIL });
          this.checkpoint(null);
          return this.result(
            Status.FAIL,
            `exit reached with unsatisfied goal gates: ${unsatisfied.join(", ")}`,
            "Goal gate unsatisfied and no retry target"
          );
        }
        const failed = this.unresolvedFailures();
        if (failed.length > 0) {
          this.events.append({ type: "pipeline.unresolved_failure", node: nodeId, failed });
        }
        this.events.append({ type: "pipeline.end", node: nodeId, status: Status.SUCCESS });
        this.checkpoint(null);
        return this.result(
          Status.SUCCESS,
          failed.length > 0 ? `exit reached with unresolved node failures: ${failed.join(", ")}` : outcome.notes
        );
      }
      this.events.append({ type: "pipeline.end", node: nodeId, status: Status.FAIL });
      this.checkpoint(reason === "stepcap" ? nodeId : null);
      return this.result(Status.FAIL, outcome.notes, outcome.failureReason);
    }
    return this.result(
      Status.FAIL,
      "run terminated with no current node",
      "run terminated with no current node"
    );
  }
};

// src/handlers/stub.ts
var StubBackend = class {
  script;
  cursor = /* @__PURE__ */ new Map();
  log = [];
  constructor(script = {}) {
    this.script = script;
  }
  async run(node, prompt, _context, _graph) {
    this.log.push({ nodeId: node.id, prompt });
    const entry = this.script[node.id];
    if (entry === void 0) {
      return { status: Status.SUCCESS, notes: `stub: no script for ${node.id}` };
    }
    if (!Array.isArray(entry)) return entry;
    const i = this.cursor.get(node.id) ?? 0;
    this.cursor.set(node.id, Math.min(i + 1, entry.length - 1));
    return entry[Math.min(i, entry.length - 1)];
  }
  calls() {
    return this.log;
  }
};

// src/backend/claude.ts
import { spawn as spawn2 } from "node:child_process";

// src/backend/result.ts
var STATUS_BY_NAME = {
  success: Status.SUCCESS,
  partial_success: Status.PARTIAL,
  retry: Status.RETRY,
  fail: Status.FAIL
};
function parseVerdict(result) {
  if (typeof result !== "string") return null;
  const trimmed = result.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}
function interpretResult(rawText, opts = {}) {
  let parsed;
  try {
    const value = JSON.parse(rawText);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("not an object");
    }
    parsed = value;
  } catch {
    return {
      outcome: {
        status: Status.FAIL,
        notes: `could not parse claude output: ${rawText.slice(0, 200)}`
      }
    };
  }
  const metrics = {};
  if (typeof parsed.total_cost_usd === "number") metrics.costUsd = parsed.total_cost_usd;
  if (typeof parsed.num_turns === "number") metrics.turns = parsed.num_turns;
  const denials = parsed.permission_denials ?? [];
  const denialNote = denials.length > 0 ? ` (${denials.length} permission denial(s): ${JSON.stringify(denials)})` : "";
  const verdict = opts.expectVerdict === true ? parseVerdict(parsed.result) : null;
  if (verdict !== null && typeof verdict.status === "string") {
    const status = STATUS_BY_NAME[verdict.status] ?? Status.FAIL;
    const notesText = `${typeof verdict.notes === "string" ? verdict.notes : ""}${denialNote}`;
    return {
      outcome: {
        status: parsed.is_error === true ? Status.FAIL : status,
        preferredLabel: typeof verdict.preferred_label === "string" ? verdict.preferred_label : void 0,
        notes: notesText === "" ? void 0 : notesText,
        metrics
      },
      sessionId: parsed.session_id
    };
  }
  const text = typeof parsed.result === "string" ? parsed.result : "";
  const notes = `${text}${denialNote}`;
  return {
    outcome: {
      status: parsed.is_error === true ? Status.FAIL : Status.SUCCESS,
      notes: notes === "" ? void 0 : notes,
      metrics
    },
    sessionId: parsed.session_id
  };
}

// src/backend/threads.ts
function isFullFidelity(node) {
  return node.attrs.fidelity === "full" && typeof node.attrs.thread_id === "string";
}
var ThreadStore = class _ThreadStore {
  sessions;
  constructor(initial = /* @__PURE__ */ new Map()) {
    this.sessions = new Map(initial);
  }
  resumeIdFor(node) {
    if (!isFullFidelity(node)) return void 0;
    return this.sessions.get(node.attrs.thread_id);
  }
  record(node, sessionId) {
    if (!isFullFidelity(node)) return;
    this.sessions.set(node.attrs.thread_id, sessionId);
  }
  /**
   * Branch-local copy. Parallel branches that shared a store would resume the
   * same conversation and interleave their turns, so a clone must not write
   * back to its parent.
   */
  clone() {
    return new _ThreadStore(this.sessions);
  }
};

// src/backend/claude.ts
function runProcess(command, argv, prompt, cwd, signal) {
  return new Promise((resolve3) => {
    const child = spawn2(command, argv, { cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      resolve3(r);
    };
    const onAbort = () => {
      if (child.pid !== void 0) child.kill("SIGKILL");
      finish({ code: 1, stdout, stderr, failure: "aborted" });
    };
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (signal !== void 0) signal.removeEventListener("abort", onAbort);
      finish({ code: 1, stdout, stderr, failure: `could not run ${command}: ${String(err)}` });
    });
    child.on("close", (code) => {
      if (signal !== void 0) signal.removeEventListener("abort", onAbort);
      finish({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(prompt);
    if (signal !== void 0) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
var ClaudeCodeBackend = class {
  opts;
  threads;
  constructor(opts = {}) {
    this.opts = opts;
    this.threads = opts.threads ?? new ThreadStore();
  }
  async run(node, prompt, _context, _graph, signal, cwd) {
    const command = this.opts.command ?? "claude";
    const argv = buildArgv(node, {
      ...this.opts,
      resumeId: this.threads.resumeIdFor(node)
    });
    const proc = await runProcess(command, argv, prompt, cwd ?? this.opts.cwd, signal);
    if (proc.failure !== void 0) {
      return { status: Status.FAIL, notes: proc.failure };
    }
    if (proc.code !== 0 && proc.stdout.trim() === "") {
      return {
        status: Status.FAIL,
        notes: `claude exited ${proc.code}: ${proc.stderr.trim() || "(no stderr)"}`
      };
    }
    const { outcome, sessionId } = interpretResult(proc.stdout, {
      expectVerdict: wantsVerdict(node)
    });
    if (sessionId !== void 0) this.threads.record(node, sessionId);
    return outcome;
  }
};

// src/doctor.ts
import { execFileSync } from "node:child_process";
function probe(name, args, required) {
  try {
    const out = execFileSync(name, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return { name, ok: true, required, detail: out.trim().split("\n")[0] || "present" };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { name, ok: false, required, detail: "not found" };
    }
    const reason = err instanceof Error ? err.message.trim().split("\n")[0] : String(err);
    return { name, ok: false, required, detail: `present but failing: ${reason}` };
  }
}
function runChecks() {
  return [
    probe("claude", ["--version"], true),
    probe("git", ["--version"], true),
    probe("sh", ["-c", "echo ok"], true),
    // Optional: the Discord channel plugin is a Bun script (Plan 4), and
    // Graphviz renders images (Plan 6). Neither blocks running a pipeline.
    probe("bun", ["--version"], false),
    probe("dot", ["-V"], false)
  ];
}
function checksPass(checks) {
  return checks.every((c) => c.ok || !c.required);
}
function formatChecks(checks) {
  const lines = checks.map((c) => {
    const mark = (c.ok ? "ok" : c.required ? "MISSING" : "absent").padEnd(7);
    const tag = c.required ? "" : " (optional)";
    return `  ${mark}  ${c.name}${tag}: ${c.detail}`;
  });
  return `attractor doctor
${lines.join("\n")}
`;
}

// src/cli.ts
var USAGE = `attractor - DOT pipeline runner

Usage:
  attractor lint   <file.dot>
  attractor run    <file.dot> [--param key=value]... [--cwd dir] [--run-dir dir]
                    [--stub] [--model name] [--max-budget-usd n]
                    [--allow-tools tool,tool,...] [--worktree] [--in-place]
  attractor doctor

Options:
  --param key=value     Seed a context value. Repeatable.
  --cwd dir             Working directory for shell commands. Default: current directory.
  --run-dir dir         Where checkpoints, events and node artifacts are written.
                        Default: .attractor/runs/<timestamp>
  --stub                Execute LLM nodes with the deterministic stub backend
                        instead of the real claude backend.
  --model name          Model to pass to the claude backend.
  --max-budget-usd n    Budget cap to pass to the claude backend. Must be a
                        positive number.
  --allow-tools t,t,... Comma-separated list of tools the claude backend may use.
  --worktree            Explicit, redundant request for what a real run does by
                        default: isolate in a dedicated git worktree. Refuses
                        if --cwd is not inside a git repository.
  --in-place            Opt out of the default isolation and run the real
                        backend directly in --cwd. An unattended model gets
                        bypassed permissions and shell/write access (Bash,
                        Read, Write, Edit by default) to that directory --
                        only pass this if you mean it.

Isolation is the default for a real (non --stub) run: when --cwd is inside a
git repository, a dedicated worktree is created automatically, exactly as
--worktree requests explicitly. Pass --in-place to run directly in --cwd
instead. When --cwd is NOT a git repository, isolation is not possible and
the run proceeds in place with a warning. --stub never touches --cwd this
way and needs neither flag.
`;
function parseRunArgs(argv) {
  const file = argv[0];
  if (!file || file.startsWith("--")) return null;
  const params = {};
  let cwd = process.cwd();
  let runDir = "";
  let stub = false;
  let model;
  let maxBudgetUsd;
  let allowedTools;
  let worktree = false;
  let inPlace = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--param") {
      const pair = argv[++i] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        process.stderr.write(`invalid --param "${pair}": expected key=value
`);
        return null;
      }
      params[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === "--cwd") {
      cwd = resolve2(argv[++i] ?? ".");
    } else if (arg === "--run-dir") {
      runDir = resolve2(argv[++i] ?? ".");
    } else if (arg === "--stub") {
      stub = true;
    } else if (arg === "--model") {
      model = argv[++i];
    } else if (arg === "--max-budget-usd") {
      const raw = argv[++i] ?? "";
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`invalid --max-budget-usd "${raw}": expected a positive number
`);
        return null;
      }
      maxBudgetUsd = n;
    } else if (arg === "--allow-tools") {
      allowedTools = (argv[++i] ?? "").split(",").filter((t) => t !== "");
    } else if (arg === "--worktree") {
      worktree = true;
    } else if (arg === "--in-place") {
      inPlace = true;
    } else if (arg.startsWith("--")) {
      process.stderr.write(`unknown option ${arg}
`);
      return null;
    }
  }
  if (worktree && inPlace) {
    process.stderr.write("--worktree and --in-place are mutually exclusive\n");
    return null;
  }
  if (runDir === "") {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    runDir = resolve2(cwd, ".attractor", "runs", stamp);
  }
  return { file: resolve2(file), params, cwd, runDir, stub, model, maxBudgetUsd, allowedTools, worktree, inPlace };
}
function warnOnManagedParams(params) {
  for (const key of Object.keys(params)) {
    if (!isEngineManagedKey(key)) continue;
    process.stderr.write(
      `WARNING: --param ${key} names a context key the engine owns. It is seeded as asked, but the engine may overwrite it at any step, and if it survives it can change routing.
`
    );
  }
}
function readPipeline(file) {
  try {
    return readFileSync3(file, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cannot read ${file}: ${reason}
`);
    return null;
  }
}
function reportDiagnostics(file, source) {
  const diags = lint(parseDot(source));
  for (const d of diags) {
    const where = d.node ? `${file}:${d.node}` : file;
    process.stderr.write(`${d.severity.toUpperCase()} ${d.code} ${where}: ${d.message}
`);
  }
  return hasErrors(diags);
}
async function main(argv) {
  const command = argv[0];
  if (command === "lint") {
    const file = argv[1];
    if (!file) {
      process.stderr.write(USAGE);
      return 2;
    }
    const resolved = resolve2(file);
    const source = readPipeline(resolved);
    if (source === null) return 2;
    if (reportDiagnostics(resolved, source)) return 1;
    process.stdout.write(`${file}: no errors
`);
    return 0;
  }
  if (command === "doctor") {
    const checks = runChecks();
    process.stdout.write(formatChecks(checks));
    return checksPass(checks) ? 0 : 1;
  }
  if (command === "run") {
    const args = parseRunArgs(argv.slice(1));
    if (!args) {
      process.stderr.write(USAGE);
      return 2;
    }
    const source = readPipeline(args.file);
    if (source === null) return 2;
    if (reportDiagnostics(args.file, source)) {
      process.stderr.write("refusing to run a graph with lint errors\n");
      return 1;
    }
    warnOnManagedParams(args.params);
    let worktree;
    let cwd = args.cwd;
    const runId = `${basename2(args.runDir)}-${randomUUID2().slice(0, 8)}`;
    if (args.worktree) {
      if (!await isGitRepo(args.cwd)) {
        process.stderr.write(
          `--worktree requires a git repository; ${args.cwd} is not one
`
        );
        return 1;
      }
      worktree = await createWorktree(args.cwd, runId);
      cwd = worktree.path;
      process.stdout.write(`worktree: ${worktree.path} (branch ${worktree.branch})
`);
    } else if (!args.stub) {
      if (args.inPlace) {
        process.stderr.write(
          `WARNING: --in-place was passed. This unattended run has bypassed permissions and shell/write access (Bash, Read, Write, Edit by default) directly in ${args.cwd}. Nothing isolates it from your working copy.
`
        );
      } else if (await isGitRepo(args.cwd)) {
        worktree = await createWorktree(args.cwd, runId);
        cwd = worktree.path;
        process.stdout.write(`worktree: ${worktree.path} (branch ${worktree.branch})
`);
      } else {
        process.stderr.write(
          `WARNING: ${args.cwd} is not a git repository, so this run cannot be isolated in a worktree. This unattended run has bypassed permissions and shell/write access (Bash, Read, Write, Edit by default) directly in ${args.cwd}.
`
        );
      }
    }
    try {
      const backend = args.stub ? new StubBackend({}) : new ClaudeCodeBackend({
        cwd,
        model: args.model,
        addDir: worktree?.path,
        maxBudgetUsd: args.maxBudgetUsd,
        allowedTools: args.allowedTools ?? ["Bash", "Read", "Write", "Edit"]
      });
      const engine = new Engine({
        graph: parseDot(source),
        context: Context.from(args.params),
        runDir: args.runDir,
        cwd,
        handlers: defaultHandlers(backend),
        runId
      });
      const result = await engine.run();
      if (result.unresolvedFailures !== void 0 && result.unresolvedFailures.length > 0) {
        process.stderr.write(
          `WARNING: the pipeline reached its exit with unresolved node failures: ${result.unresolvedFailures.join(", ")}. Per spec section 11.3 the run status is decided by goal gates alone, so this run reports ${result.status}, but the work of ${result.unresolvedFailures.length === 1 ? "that node" : "those nodes"} did not succeed and nothing re-ran it.
`
        );
      }
      process.stdout.write(`status: ${result.status}
`);
      process.stdout.write(`path:   ${result.path.join(" -> ")}
`);
      if (result.notes) process.stdout.write(`notes:  ${result.notes}
`);
      process.stdout.write(`run:    ${args.runDir}
`);
      if (worktree !== void 0) {
        process.stdout.write(`work is on branch ${worktree.branch}
`);
      }
      return result.status === Status.SUCCESS ? 0 : 1;
    } finally {
      if (worktree !== void 0) {
        const removal = await removeWorktree(args.cwd, worktree);
        if (removal.warning !== void 0) process.stderr.write(`${removal.warning}
`);
      }
    }
  }
  process.stderr.write(USAGE);
  return 2;
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    process.stderr.write(`attractor: ${err instanceof Error ? err.message : String(err)}
`);
    process.exitCode = 1;
  });
}
export {
  main
};
