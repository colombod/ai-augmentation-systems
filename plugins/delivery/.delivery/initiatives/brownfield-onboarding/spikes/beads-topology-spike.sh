#!/usr/bin/env bash
# beads-topology-spike.sh -- brownfield onboarding, beads topology. NOT shipped code.
#
# Question: can a delivery team spread over several hosts share one beads database with no
# network server, by giving every host its own embedded database and syncing through the
# project repo's git remote (refs/dolt/data)? And what breaks: concurrent claims across hosts,
# concurrent writers on one host, recovery after a rejected sync.
#
# Two "hosts" are two clones with separate HOME directories; the remote is a bare git repo.
# Usage: beads-topology-spike.sh <path to bd> <empty work dir>
set -u
BD=${1:?path to bd}; W=${2:?work dir}
export PATH="$(dirname "$BD"):$PATH"
mkdir -p "$W"/{homeA,homeB,hostA,hostB}
for h in A B; do HOME="$W/home$h" git config --global user.name "$h"; HOME="$W/home$h" git config --global user.email "$h@spike"; done
A() { (export HOME="$W/homeA" BEADS_ACTOR=alice BD_NON_INTERACTIVE=1; cd "$W/hostA/proj" && "$@"); }
B() { (export HOME="$W/homeB" BEADS_ACTOR=bob BD_NON_INTERACTIVE=1; cd "$W/hostB/proj" && "$@"); }
step() { echo; echo "### $*"; }
rc() { local r=$?; echo "${1:+$1 }exit=$r"; }

echo "bd: $(bd version)"; echo "git: $(git --version)"; echo "date: $(date -u +%FT%TZ)"
git init -q --bare -b main "$W/remote.git"
(export HOME="$W/homeA"; git clone -q "$W/remote.git" "$W/hostA/proj" 2>/dev/null; cd "$W/hostA/proj" && git commit -q --allow-empty -m init && git push -q origin HEAD:main)

step "1. host A: bd init in a repo that has an origin"
A bd init --prefix spk --non-interactive >/dev/null 2>&1; rc
A bd dolt remote list
A sh -c 'grep -E "^(sync\.remote|dolt\.mode|mode)" .beads/config.yaml; grep -o "\"[a-z_]*mode[a-z_]*\": *\"[a-z-]*\"" .beads/metadata.json'
A git push -q origin HEAD:main 2>/dev/null

step "2. host A: create two issues, bd dolt push"
ID=$(A bd create "shared task" -t task -p 1 --silent 2>/dev/null); echo "created $ID"
A bd create "second task" -t task -p 2 --silent >/dev/null 2>&1
A bd dolt push >/dev/null 2>&1; rc
echo "refs on the remote:"; git --git-dir="$W/remote.git" for-each-ref --format='  %(refname)'

step "3. host B: plain git clone, then bd bootstrap"
(export HOME="$W/homeB"; git clone -q "$W/remote.git" "$W/hostB/proj" 2>/dev/null)
B bd bootstrap --yes >/dev/null 2>&1; rc
B bd list 2>/dev/null | grep -E "^Total"

step "4. race: A and B both claim $ID before syncing"
A bd update "$ID" --claim >/dev/null 2>&1; rc "A claim"
B bd update "$ID" --claim >/dev/null 2>&1; rc "B claim"
A bd dolt push >/dev/null 2>&1; rc "A push"
B bd dolt push >/dev/null 2>&1; rc "B push"
echo "B pull:"; B bd dolt pull 2>&1 | grep -E "Error|conflict|Pull"; B bd dolt pull >/dev/null 2>&1; rc
echo "B's local view:"; B bd show "$ID" --json 2>/dev/null | grep -E '"assignee"'

step "5. recovery: B sets its unsynced database aside and bootstraps again"
B mv .beads/embeddeddolt "$W/hostB-embeddeddolt.set-aside"
B bd bootstrap --yes >/dev/null 2>&1; rc
B bd show "$ID" --json 2>/dev/null | grep -E '"assignee"'

step "6. claim after pull: B tries to claim the issue A holds"
B bd update "$ID" --claim 2>&1 | grep -E "Error|Updated"; B bd update "$ID" --claim >/dev/null 2>&1; rc

step "7. one host, four concurrent writers, five creates each (embedded mode)"
for w in 1 2 3 4; do (for i in 1 2 3 4 5; do s=$(date +%s%N); A bd create "w$w-$i" -t task --silent >/dev/null 2>>"$W/err.$w"; r=$?; echo "$w $i $r $(( ($(date +%s%N)-s)/1000000 ))"; done) & done > "$W/writes.txt"; wait
awk '{n++; if ($3!=0) f++; if ($4>m) m=$4; t+=$4} END {printf "writes=%d failed=%d max_ms=%d mean_ms=%d\n", n, f+0, m, t/n}' "$W/writes.txt"
echo "stderr lines: $(cat "$W"/err.* | grep -v -c permissions)"
echo "issues now: $(A bd list --all --json 2>/dev/null | grep -c '"id"')"
