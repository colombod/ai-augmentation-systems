# Spike: how long must a matched passage be? (brief, Open question 3)

**Run:** 2026-10-31, `spikes/shingle-calibration.js /home/user/the-vault-planning /home/user/colombod-personal/the-vault`
(the Vault's private planning repository at its HEAD of 2026-10-25, against the public product repository's
609 tracked text files and its 315 commit messages in a 30-commit shallow clone). Words are lowercased,
NFKC-normalised alphanumeric runs; a shingle is n consecutive words.

| n | plan shingles | public files with a hit | distinct shingles hit | commit messages with a hit |
| :-- | --: | --: | --: | --: |
| 4 | 13,078 | 298 / 609 | 815 | 16 / 315 |
| 5 | 13,721 | 98 / 609 | 262 | 5 / 315 |
| 6 | 14,124 | 16 / 609 | 82 | 0 / 315 |
| 8 | 14,586 | 6 / 609 | 26 | 0 / 315 |
| 10 | 14,811 | 2 / 609 | 9 | 0 / 315 |

**What the hits are.** Below 6 words: URLs and paths (`https github com colombod-personal`), number runs
(`in 1 2 3`), common English (`the same name as`). At 8 words: two number runs (`1 2 3 4 5 6 7 8`) and four
passages that read as copied from the plan, for example `AGENTS.md`: "in the same pull request and a security"
and `tests/test_chief_of_staff_rules.py`: "a headless pass is a test not evidence about production".

**Decision (for the PRD).** Match 8-word shingles, and drop a shingle whose tokens are mostly digits or
path fragments (fewer than 5 words of three letters or more). Expected false positives on this corpus: the
two number runs, removed by that filter. The four remaining hits are the gate's job: each is either a real
copy from the plan or public-by-design text the owner allows. Not measured: paraphrase (out of scope), and
a corpus other than the Vault's.
