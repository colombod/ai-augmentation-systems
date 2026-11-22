#!/usr/bin/env python3
"""Remove the delivery plugin's user-level setup-guard hook from a Claude config dir.

Run it in a normal terminal, not through a Claude session (the guard refuses its own removal
when a Claude tool tries it). Default is a dry run. Use --apply to change anything.

What it removes, and only this:
  - hook entries in <config>/settings.json whose command names delivery/bin/setup-guard.js
  - (with --apply) the launcher directory <config>/delivery
It leaves every other key and hook untouched, writes a timestamped backup first, and writes
settings.json atomically.
"""
import argparse, json, os, shutil, sys, time

p = argparse.ArgumentParser()
p.add_argument('--config-dir', default=os.path.expanduser('~/.claude'))
p.add_argument('--apply', action='store_true')
a = p.parse_args()

settings = os.path.join(a.config_dir, 'settings.json')
launcher_dir = os.path.join(a.config_dir, 'delivery')
MARK = os.path.join('delivery', 'bin', 'setup-guard.js')

with open(settings, encoding='utf-8') as f:
    data = json.load(f)

removed = []
hooks = data.get('hooks', {})
for event in list(hooks):
    groups = hooks[event]
    kept_groups = []
    for g in groups:
        kept = []
        for h in g.get('hooks', []):
            if MARK in h.get('command', ''):
                removed.append((event, g.get('matcher'), h.get('command')))
            else:
                kept.append(h)
        if kept:
            g = dict(g, hooks=kept)
            kept_groups.append(g)
        elif g.get('hooks') is None:
            kept_groups.append(g)
    if kept_groups:
        hooks[event] = kept_groups
    else:
        del hooks[event]
if not hooks and 'hooks' in data:
    del data['hooks']

print(('APPLY' if a.apply else 'DRY RUN'), 'config dir:', a.config_dir)
for e, m, c in removed:
    print('  remove hook:', e, '|', m, '|', c)
if not removed:
    print('  no delivery setup-guard hook entries found in settings.json')
print('  launcher dir', launcher_dir, 'exists' if os.path.isdir(launcher_dir) else 'absent')

if a.apply:
    if removed:
        backup = settings + '.bak-' + time.strftime('%Y%m%d-%H%M%S')
        shutil.copy2(settings, backup)
        tmp = settings + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        os.replace(tmp, settings)
        print('  wrote', settings, '(backup:', backup + ')')
    if os.path.isdir(launcher_dir):
        shutil.rmtree(launcher_dir)
        print('  removed', launcher_dir)
else:
    print('Nothing changed. Re-run with --apply to make these changes.')
