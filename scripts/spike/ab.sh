#!/bin/bash
# A/B/A/B whole-game CPU comparison of two dist-spike bundles on two cores.
#   scripts/spike/ab.sh <A.mjs> <B.mjs> <rounds> <out.jsonl> [game args...=4 normal 201]
# Each round runs A and B at once, one per core, swapping cores every round; every line records
# which bundle and core. Reports CPU of each process (game.ts), so load elsewhere only adds noise.
set -e
A=$1; B=$2; R=$3; OUT=$4; shift 4
ARGS=${*:-4 normal 201}
CORES=(${SPIKE_CORES:-14 15})
for r in $(seq 1 "$R"); do
  if (( r % 2 )); then ca=${CORES[0]}; cb=${CORES[1]}; else ca=${CORES[1]}; cb=${CORES[0]}; fi
  (taskset -c "$ca" node "$A" $ARGS | sed "s/^{/{\"bundle\":\"A\",\"round\":$r,\"core\":$ca,/" >> "$OUT") &
  (taskset -c "$cb" node "$B" $ARGS | sed "s/^{/{\"bundle\":\"B\",\"round\":$r,\"core\":$cb,/" >> "$OUT") &
  wait
done
