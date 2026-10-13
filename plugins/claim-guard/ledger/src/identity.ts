// Stable claim identity (upstream F-9): trivial rewording must not fork a
// claim's id; a real change of claim must. Over-collapsing two distinct claims
// into one id is the primary risk (an identity match reads as an idempotent
// re-add and silently drops a claim), so negation, modals, quantifiers, and
// numbers are never stripped.
import { createHash } from "node:crypto";

const CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bwon't\b/g, "will not"],
  [/\bcan't\b/g, "cannot"],
  [/\bdon't\b/g, "do not"],
  [/\bdoesn't\b/g, "does not"],
  [/\bdidn't\b/g, "did not"],
  [/\bisn't\b/g, "is not"],
  [/\baren't\b/g, "are not"],
  [/\bwasn't\b/g, "was not"],
  [/\bweren't\b/g, "were not"],
  [/\bcouldn't\b/g, "could not"],
  [/\bshouldn't\b/g, "should not"],
  [/\bwouldn't\b/g, "would not"],
  [/\bhasn't\b/g, "has not"],
  [/\bhaven't\b/g, "have not"],
];

// Closed filler set: articles and copula only. Deliberately excludes negation
// (not, never, no, cannot), modals (will, would, must, may, might, can, could,
// should), and quantifiers (all, any, some, none, every).
const FILLER = new Set([
  "a", "an", "the",
  "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "that", "this", "it", "and",
]);

const LEAD_INS = /^(the code ensures that|this change ensures that|ensures that)\s+/;

// file.ext or file.ext:line — the code-span shape whose trailing line number is
// stripped so "registry.py:648" and "registry.py:9" carry the same identity.
const FILE_TOKEN = /^\S+\.[a-z0-9]{1,8}(:\d+)?$/;

function isCodeToken(token: string): boolean {
  return /[0-9_]/.test(token) || FILE_TOKEN.test(token);
}

export function normalizeClaimText(text: string): string {
  let s = text.normalize("NFKC");
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/`/g, "");
  s = s.toLowerCase();
  for (const [re, expansion] of CONTRACTIONS) s = s.replace(re, expansion);
  s = s.replace(LEAD_INS, "");

  const out: string[] = [];
  for (const raw of s.split(/\s+/)) {
    // Strip surrounding (not internal) punctuation before classifying, so a
    // trailing comma never forks "registry.py:648," from "registry.py:648".
    const token = raw.replace(/^[^a-z0-9_]+|[^a-z0-9_]+$/g, (m) =>
      // keep a trailing file-extension dot context intact: only strip chars
      // that are not part of an inner path token
      m.includes(".") && FILE_TOKEN.test(raw) ? m : "",
    ).replace(/^[,;:!?"'()[\]{}]+|[,;:!?"'()[\]{}]+$/g, "");
    if (!token) continue;
    if (isCodeToken(token)) {
      // preserved atomically, casefolded; strip a trailing :line on file tokens
      out.push(FILE_TOKEN.test(token) ? token.replace(/:\d+$/, "") : token);
      continue;
    }
    // prose: fold internal punctuation to whitespace, drop closed filler set
    for (const word of token.split(/[^a-z0-9]+/)) {
      if (word && !FILLER.has(word)) out.push(word);
    }
  }
  return out.join(" ");
}

export function claimId(text: string, type: string, sourceRelPath: string): string {
  const key = `${normalizeClaimText(text)}|${type}|${sourceRelPath}`;
  return "clm_" + createHash("sha1").update(key, "utf8").digest("hex").slice(0, 8);
}
