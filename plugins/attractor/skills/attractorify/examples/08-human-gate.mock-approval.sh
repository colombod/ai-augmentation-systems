#!/bin/sh
# Deterministic stand-in for a real human/CommandChannel approval script, matching
# this example set's own established convention (00/02/03/05: a self-contained
# deterministic replacement for whatever real check amplifier's illustrative version
# ran). Prints the routing label a real approval script would print as its last
# non-empty stdout line -- see channels/command.ts's own contract.
printf 'approve\n'
