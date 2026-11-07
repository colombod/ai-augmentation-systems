#!/usr/bin/env python3
# Mutation check for the rv-184-delivery-lead-6 fixes: each mutant must make a test fail.
import os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PR = os.path.join(ROOT, 'plugins/delivery/scripts/prepare-role.js')
MF = os.path.join(ROOT, 'plugins/delivery/scripts/lib/manifest.js')
MUTANTS = {
    'label-is-rule': (PR, "`permission:${roleId}=${require('./lib/manifest.js').permissionCommand(allow)}`", '`permission:${roleId}=${allow}`'),
    'no-wrapper-check': (MF, "if (RULE_WRAPPERS.has(words[0].toLowerCase()))", "if (false)"),
    'no-flag-check': (MF, "if (words[1].startsWith('-'))", "if (false)"),
    'no-owner-words': (PR, "if (!wordsOf(v.text).includes(wordsOf(cmd)))", "if (false)"),
    'approve-throw-escapes': (PR, "try { approved = module.exports.ownerApproved(projectRoot, role, verifyRecord); } catch (err) {", "try { approved = module.exports.ownerApproved(projectRoot, role, verifyRecord); } catch (err) { throw err;"),
    'sidecar-first': (PR, "    sidecars.push([allowFile, { allow: approved.rules.filter((r) => !userAllow.includes(r)) }]);", "    fs.writeFileSync(allowFile, JSON.stringify({ allow: approved.rules.filter((r) => !userAllow.includes(r)) }));"),
}
env = dict(os.environ, DELIVERY_TEST_FILES='plugins/delivery/scripts/prepare-role.test.js')
bad = 0
for name, (f, old, new) in MUTANTS.items():
    src = open(f).read()
    if src.count(old) != 1:
        print(name, 'PATTERN NOT FOUND'); bad += 1; continue
    open(f, 'w').write(src.replace(old, new))
    try:
        out = subprocess.run(['node', 'plugins/delivery/scripts/testing/run-tests.js'], cwd=ROOT, env=env, capture_output=True, text=True).stdout
    finally:
        open(f, 'w').write(src)
    open(os.path.join(ROOT, 'scratch', f'mut10-{name}.log'), 'w').write(out)
    failed = [l for l in out.splitlines() if l.startswith('not ok')]
    print(name, 'KILLED' if failed else 'SURVIVED', '|', '; '.join(l[:90] for l in failed))
    if not failed: bad += 1
sys.exit(1 if bad else 0)
