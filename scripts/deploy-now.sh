#!/usr/bin/env bash
# Deploy this app to Tower: wait for the CI build of a commit, then pull and roll the app's
# compose project with Tower's shared deploy script (tower-deploy repo, deploy-app).
#
#   scripts/deploy-now.sh            # deploy the build of $DEFAULT_REF
#   scripts/deploy-now.sh v1.2.3     # deploy the build of that tag (or branch, or commit)
#   scripts/deploy-now.sh --now      # skip the wait; roll whatever image is on GHCR now
#
# The CI run is matched by commit SHA, so a run that has not registered yet is waited for
# rather than mistaken for the previous build. deploy-app recreates only what changed,
# waits for health, and rolls every changed service back together if the new build is
# unhealthy. Undo the last deploy by hand:
#   ssh tower bash /boot/config/bin/deploy-app --rollback <project>
set -euo pipefail
PROJECT=arcs      # compose.manager project on Tower
SERVICES=""              # empty = every ghcr.io/basmith7/ service in the project
WORKFLOW=docker-publish.yml    # the workflow that builds and pushes the image
DEFAULT_REF=HEAD         # what a bare `deploy-now.sh` deploys (a release tag sits on HEAD)
WAIT_FOR_RUN=${WAIT_FOR_RUN:-120}

ref=${1:-$DEFAULT_REF}
if [ "$ref" != "--now" ]; then
  git fetch -q --tags origin || echo "deploy-now: git fetch failed; using local refs" >&2
  # A branch name means the branch as pushed (origin/<name>), not a stale local copy.
  if [ "$ref" != HEAD ] && git rev-parse -q --verify "refs/remotes/origin/$ref" >/dev/null; then ref=origin/$ref; fi
  sha=$(git rev-parse -q --verify "$ref^{commit}") || { echo "deploy-now: unknown ref '$ref'" >&2; exit 1; }
  find_run() {
    gh run list --workflow "$WORKFLOW" --limit 30 --json databaseId,headSha 2>/dev/null |
      jq -r --arg s "$sha" 'first(.[] | select(.headSha == $s) | .databaseId) // empty' || true
  }
  run_id=$(find_run)
  waited=0
  while [ -z "$run_id" ] && [ "$waited" -lt "$WAIT_FOR_RUN" ]; do
    sleep 5; waited=$((waited + 5)); run_id=$(find_run)
  done
  [ -n "$run_id" ] || { echo "deploy-now: no $WORKFLOW run for ${sha:0:7} ($ref) after ${WAIT_FOR_RUN}s" >&2; exit 1; }
  echo "deploy-now: waiting for $WORKFLOW run $run_id (${sha:0:7})"
  gh run watch "$run_id" --exit-status >/dev/null || { echo "deploy-now: run $run_id failed — not deploying" >&2; exit 1; }
fi

# setsid: the deploy keeps going on Tower even if this ssh session drops.
# shellcheck disable=SC2086  # SERVICES is a deliberate word list
ssh tower setsid -w bash /boot/config/bin/deploy-app "$PROJECT" $SERVICES
