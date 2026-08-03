<!--
BUDGET — target 500 words, hard cap 900, for the prose only. The term table is data and
excluded; it grows as large as the domain needs.
The prose here is curation notes. The value is in the table.
-->

# Glossary — the ubiquitous language

> Every document, question and conversation in this project uses these terms and only these
> terms. One concept, one word. Where a role's professional dialect prefers another word, the
> dialect gives way.
>
> **Owned by:** Product Owner (arbitrates) · **Curated by:** Business Analyst
> Last curated: `<date>`

## How to use this

- **Before writing anything**, read this file. Use these terms exactly.
- **Need a word that is not here?** Propose it — do not just use it. An undefined word
  reaches implementation as a guess.
- **Found a word meaning two things?** That is a defect. Raise it; do not pick one silently.
- **Changing a definition** requires recording what it meant before and which documents were
  written under the old meaning.

## Terms

| Term | Definition (in the business's words) | Referent | Code identifier | Aliases — do not use |
| :-- | :-- | :-- | :-- | :-- |
| | | example, path or value | `identifier`, if it differs | words this replaces, and where they came from |

Definitions must be ones the originator would recognise and could have written. Where
precision needs technical vocabulary, give the plain sentence first and the precise one
after it, clearly marked as such.

## Deliberately excluded

Words that appear in the project but are not domain terms — generic technical vocabulary,
library names, framework concepts. Listing them stops the same debate recurring.

| Word | Why it is not a domain term |
| :-- | :-- |

## Homonyms resolved

One word that meant several things, now split. The most dangerous category, because nothing
looks wrong until two people act on different readings.

| Original word | Meanings found | Now called | Where the collision was |
| :-- | :-- | :-- | :-- |

## Terms nobody could define

A concept nobody can define crisply is usually an unresolved product decision wearing a
noun. These are open questions, not vocabulary gaps — do not invent a definition to close
the row.

| Word | Who used it | What is actually undecided | Owner |
| :-- | :-- | :-- | :-- |

## Conventions

Formats and units that cause silent, expensive errors when assumed. One line each; cheaper
than the incident.

| Convention | Rule | Example |
| :-- | :-- | :-- |
| Dates, business-facing | | |
| Dates, in data files | | |
| Currency | | |
| Time zone | | |

## Curation log

What changed and why. A definition's history is how you tell whether the team's
understanding is converging or thrashing.

| Date | Change | Reason | Documents written under the old meaning |
| :-- | :-- | :-- | :-- |
