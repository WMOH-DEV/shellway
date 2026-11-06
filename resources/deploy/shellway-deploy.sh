#!/bin/sh
# Shellway deploy runner. Installed by Shellway; safe to read, do not edit by hand.
set -u

RUNNER_VERSION=1
ROOT="${SHELLWAY_DEPLOY_ROOT:-$HOME/.shellway-deploy}"
CRONTAB_BIN="${SHELLWAY_CRONTAB:-crontab}"
HEALTH_DELAY="${SHELLWAY_HEALTH_DELAY:-3}"
HEALTH_ATTEMPTS=5
CRON_MARKER="# shellway-deploy"
CRON_PROCESSES="${SHELLWAY_CRON_PROCESSES:-cron crond}"
STOP_GRACE_SECONDS=5
EXIT_BUSY=75
TAB="$(printf '\t')"
PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
export PATH

LOCKED=0
DEPLOY_OPEN=0
WARNINGS=0
CONVERTED=0
CANCELLED=0
LIVE_TOUCHED=0
STAGE=''
STEP_INDEX=0
STEP_TOTAL=0
STEP_PID=''
STEP_LIMIT=''

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
now() { date +%s; }

check_name() {
  case "$1" in
    ''|-*|*[!a-z0-9-]*) die "invalid name: $1" ;;
  esac
}

check_id() {
  case "$1" in
    ''|-*|*[!a-zA-Z0-9-]*) die "invalid id: $1" ;;
  esac
}

load_site() {
  check_name "$1"
  SITE="$1"
  SDIR="$ROOT/sites/$SITE"
  [ -f "$SDIR/site.conf" ] || die "unknown site: $SITE"
  SITE_PATH=''; REPO_URL=''; BRANCH=main; SOURCE_MODE=auto; LAYOUT=releases
  SHARED_PATHS=''; ENV_FILE=.env; HEALTH_URL=''; HEALTH_STATUS=200; HEALTH_REVERT=1
  KEEP_RELEASES=5; POLL_MINUTES=1; APPROVE_MIGRATIONS=0; MIGRATIONS_PATH=database/migrations; PC_AUTO=0
  QUIET_HOURS=''; NOTIFY_URL=''
  . "$SDIR/site.conf"
  case "$SITE_PATH" in
    /?*) ;;
    *) die "SITE_PATH must be an absolute path other than /" ;;
  esac
  SITE_PATH="${SITE_PATH%/}"
  DEPLOY_ROOT="$SITE_PATH-deploy"
  MIRROR="$SDIR/repo.git"
}

read_val() { [ -f "$SDIR/$1" ] && cat "$SDIR/$1"; return 0; }
write_val() { printf '%s\n' "$2" > "$SDIR/$1.tmp" && mv -f "$SDIR/$1.tmp" "$SDIR/$1"; }

with_timeout() {
  seconds="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$seconds" "$@"; else "$@"; fi
}

lock_owner_alive() {
  owner="$(cat "$SDIR/lock/pid" 2>/dev/null)"
  if [ -z "$owner" ]; then
    [ -z "$(find "$SDIR/lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]
    return
  fi
  kill -0 "$owner" 2>/dev/null
}

acquire_lock() {
  if ! mkdir "$SDIR/lock" 2>/dev/null; then
    lock_owner_alive && return 1
    rm -rf "$SDIR/lock"
    mkdir "$SDIR/lock" 2>/dev/null || return 1
  fi
  rm -f "$SDIR/cancel" "$SDIR/progress"
  echo $$ > "$SDIR/lock/pid"
  LOCKED=1
  trap on_exit EXIT
  trap 'exit 130' INT TERM HUP
  close_orphaned_deploys
}

release_lock() {
  [ "$LOCKED" = 1 ] && rm -rf "$SDIR/lock"
  LOCKED=0
}

on_exit() {
  [ -n "$STEP_PID" ] && signal_tree TERM "$(process_tree "$STEP_PID" "$$")"
  if [ "$DEPLOY_OPEN" = 1 ]; then
    RESULT_NOTE="interrupted"
    finish failed
  fi
  release_lock
}

close_orphaned_deploys() {
  [ -f "$SDIR/history.tsv" ] || return 0
  orphans="$(awk -F "$TAB" -v OFS="$TAB" -v now="$(now)" '
    { last[$1] = $0; status[$1] = $2 }
    END { for (id in status) if (status[id] == "running") { split(last[id], f, FS); print id, "failed", f[3], f[4], f[5], now, f[7], "interrupted" } }
  ' "$SDIR/history.tsv")"
  [ -z "$orphans" ] || printf '%s\n' "$orphans" >> "$SDIR/history.tsv"
}

is_busy() { [ -d "$SDIR/lock" ] && lock_owner_alive; }

process_tree() {
  { ps -A -o pid= -o ppid= 2>/dev/null || ps -o pid= -o ppid= 2>/dev/null; } | awk -v root="$1" -v owner="$2" '
    { parent[$1] = $2; kids[$2] = kids[$2] " " $1 }
    END {
      p = root
      for (depth = 0; depth < 64 && p != owner; depth++) { if (!(p in parent) || p <= 1) exit; p = parent[p] }
      if (p != owner) exit
      queue = root
      while (queue != "") {
        n = split(queue, q, " "); queue = ""
        for (i = 1; i <= n; i++) { printf "%s ", q[i]; queue = queue " " kids[q[i]] }
      }
    }'
}

signal_tree() {
  for pid in $2; do kill -"$1" "$pid" 2>/dev/null; done
  return 0
}

stop_tree() {
  tree="$1"
  [ -n "$tree" ] || return 0
  signal_tree TERM "$tree"
  waited=0
  while [ "$waited" -lt "$STOP_GRACE_SECONDS" ]; do
    alive=0
    for pid in $tree; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  signal_tree KILL "$tree"
}

write_progress() {
  printf 'STAGE=%s\nSTEP=%s\nSTEPS=%s\nCOMMAND=%s\nSTEP_PID=%s\n' \
    "$STAGE" "$STEP_INDEX" "$STEP_TOTAL" "$(printf '%s' "${1:-}" | tr '\t' ' ')" "${2:-}" > "$SDIR/progress.tmp" \
    && mv -f "$SDIR/progress.tmp" "$SDIR/progress"
}

set_stage() {
  STAGE="$1"
  write_progress
}

progress_field() { printf '%s\n' "$1" | sed -n "s/^$2=//p"; }

count_steps() {
  [ -f "$1" ] || { echo 0; return 0; }
  awk -F "$TAB" '$2 != ""' "$1" | wc -l | tr -d ' '
}

cancel_requested() { [ -f "$SDIR/cancel" ]; }

mark_cancelled() {
  [ "$CANCELLED" = 1 ] || log "cancelled"
  CANCELLED=1
  return 1
}

stop_if_cancelled() {
  case "$STAGE" in fetch|build) ;; *) return 0 ;; esac
  [ "$LIVE_TOUCHED" = 1 ] && return 0
  cancel_requested || return 0
  mark_cancelled
}

enter_go_live() {
  set_stage activate
  cancel_requested || return 0
  mark_cancelled
}

run_tracked() {
  "$@" &
  STEP_PID=$!
  write_progress "${STEP_COMMAND:-}" "$STEP_PID"
  stop_if_cancelled || stop_step "$STEP_PID" "$$" || true
  wait "$STEP_PID"
  tracked_code=$?
  STEP_PID=''
  return "$tracked_code"
}

use_deploy_key() {
  [ -f "$SDIR/deploy_key" ] || return 0
  GIT_SSH_COMMAND="ssh -i '$SDIR/deploy_key' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
  export GIT_SSH_COMMAND
}

ensure_mirror() { [ -d "$MIRROR" ] || git init --bare -q "$MIRROR"; }

fetch_remote() {
  use_deploy_key
  ensure_mirror
  log "fetching $BRANCH from $REPO_URL"
  run_tracked with_timeout 300 git --git-dir="$MIRROR" fetch -q --prune -- "$REPO_URL" "+refs/heads/$BRANCH:refs/heads/$BRANCH"
}

fetch_bundle() {
  ensure_mirror
  log "fetching $BRANCH from uploaded bundle"
  run_tracked git --git-dir="$MIRROR" fetch -q "$1" "+refs/heads/$BRANCH:refs/heads/$BRANCH"
  fetched=$?
  rm -f "$1"
  return $fetched
}

resolve_commit() { git --git-dir="$MIRROR" rev-parse -q --verify "$1^{commit}" 2>/dev/null; }

history_add() {
  note="$(printf '%s' "$8" | tr '\t\n' '  ')"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$note" >> "$SDIR/history.tsv"
}

history_commit_of() {
  awk -F "$TAB" -v id="$1" '$1 == id && ($2 == "success" || $2 == "warning") { c = $4 } END { print c }' "$SDIR/history.tsv" 2>/dev/null
}

step_shell() {
  if [ -n "$STEP_LIMIT" ]; then with_timeout "$STEP_LIMIT" sh -c "$1"; else sh -c "$1"; fi
}

run_step() {
  (cd "$1" && export SHELLWAY_SITE="$SITE" SHELLWAY_COMMIT="${COMMIT:-}" SHELLWAY_RELEASE_DIR="$1" && step_shell "$2") </dev/null
}

set_step_limit() {
  STEP_LIMIT=''
  case "$1" in *:*) STEP_LIMIT="${1#*:}" ;; esac
  case "$STEP_LIMIT" in ''|*[!0-9]*|0) STEP_LIMIT='' ;; esac
}

describe_failure() {
  if [ "$1" = 124 ] && [ -n "$STEP_LIMIT" ]; then
    printf 'hit its %ss time limit' "$STEP_LIMIT"
  else
    printf 'exit %s' "$1"
  fi
}

run_steps() {
  steps_file="$1"; workdir="$2"
  [ -f "$steps_file" ] || return 0
  while IFS="$TAB" read -r kind cmd || [ -n "${kind:-}" ]; do
    [ -n "${cmd:-}" ] || continue
    stop_if_cancelled || return 1
    STEP_INDEX=$((STEP_INDEX + 1))
    STEP_COMMAND="$cmd"
    set_step_limit "$kind"
    kind="${kind%%:*}"
    log "\$ $cmd"
    run_tracked run_step "$workdir" "$cmd"
    code=$?
    STEP_COMMAND=''
    [ "$code" = 0 ] && continue
    stop_if_cancelled || return 1
    failure="$(describe_failure "$code")"
    if [ "$kind" = O ]; then
      WARNINGS=$((WARNINGS + 1))
      log "optional step failed ($failure), continuing"
      continue
    fi
    log "step failed ($failure)"
    return 1
  done < "$steps_file"
  return 0
}

http_code() {
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -S --spider -T 10 "$1" 2>&1 | awk '/^ *HTTP\// { c = $2 } END { print c }'
  else
    echo none
  fi
}

health_ok() {
  [ -n "$HEALTH_URL" ] || return 0
  set_stage health
  attempt=1
  while :; do
    got="$(http_code "$HEALTH_URL")"
    [ "$got" = "$HEALTH_STATUS" ] && { log "health check ok ($got)"; return 0; }
    log "health check attempt $attempt got ${got:-no response}, expected $HEALTH_STATUS"
    [ "$attempt" -ge "$HEALTH_ATTEMPTS" ] && return 1
    attempt=$((attempt + 1))
    sleep "$HEALTH_DELAY"
  done
}

needs_approval() {
  [ "$APPROVE_MIGRATIONS" = 1 ] && [ "$APPROVED" != 1 ] || return 1
  base="$(read_val current)"
  [ -n "$base" ] || return 1
  changed="$(git --git-dir="$MIRROR" diff --name-only "$base" "$COMMIT" -- "$MIGRATIONS_PATH" 2>/dev/null)" || return 0
  [ -n "$changed" ]
}

link_shared() {
  release="$1"
  for shared in $SHARED_PATHS; do
    src="$DEPLOY_ROOT/shared/$shared"
    dst="$release/$shared"
    if [ ! -e "$src" ]; then
      mkdir -p "$(dirname "$src")"
      if [ -e "$SITE_PATH/$shared" ]; then
        cp -a "$SITE_PATH/$shared" "$src"
      elif [ -e "$dst" ]; then
        cp -a "$dst" "$src"
      else
        log "warning: shared path $shared does not exist yet"
      fi
    fi
    rm -rf "$dst"
    mkdir -p "$(dirname "$dst")"
    ln -s "$src" "$dst"
  done
}

point_current_at() {
  ln -sfn "$1" "$DEPLOY_ROOT/current.tmp" || return 1
  mv -T "$DEPLOY_ROOT/current.tmp" "$DEPLOY_ROOT/current" 2>/dev/null && return 0
  rm -f "$DEPLOY_ROOT/current.tmp"
  ln -sfn "$1" "$DEPLOY_ROOT/current"
}

link_site_path() {
  target="$DEPLOY_ROOT/current"
  if [ -L "$SITE_PATH" ]; then
    [ "$(readlink "$SITE_PATH")" = "$target" ] && return 0
    log "$SITE_PATH is a symlink to $(readlink "$SITE_PATH"), expected $target; refusing to replace it"
    return 1
  fi
  if [ -e "$SITE_PATH" ]; then
    if [ -e "$SITE_PATH.pre-shellway" ]; then
      log "$SITE_PATH.pre-shellway already exists; move it away first"
      return 1
    fi
    mv "$SITE_PATH" "$SITE_PATH.pre-shellway" || return 1
    CONVERTED=1
    log "moved existing $SITE_PATH to $SITE_PATH.pre-shellway"
  fi
  mkdir -p "$(dirname "$SITE_PATH")"
  ln -s "$target" "$SITE_PATH" && return 0
  undo_conversion
  return 1
}

undo_conversion() {
  [ "$CONVERTED" = 1 ] || return 0
  rm -f "$SITE_PATH"
  mv "$SITE_PATH.pre-shellway" "$SITE_PATH"
  CONVERTED=0
  log "restored original $SITE_PATH"
}

revert_release() {
  previous="$1"
  if [ "$CONVERTED" = 1 ]; then
    undo_conversion
    rm -f "$DEPLOY_ROOT/current"
    return 0
  fi
  [ -n "$previous" ] && [ -d "$previous" ] || return 1
  point_current_at "$previous" && log "switched back to $(basename "$previous")"
}

prune_releases() {
  keep_name="$(basename "$(read_val current_release)")"
  ls -1 "$DEPLOY_ROOT/releases" 2>/dev/null | sort -r \
    | awk -v keep="$KEEP_RELEASES" -v cur="$keep_name" 'NR > keep && $0 != cur' \
    | while read -r old; do rm -rf "$DEPLOY_ROOT/releases/$old" || log "could not delete old release $old"; done
  return 0
}

discard_release() {
  [ "$(readlink "$DEPLOY_ROOT/current" 2>/dev/null)" = "$1" ] || rm -rf "$1"
}

checkout_release() {
  archive="$SDIR/checkout.tar"
  git --git-dir="$MIRROR" archive -o "$archive" "$COMMIT" && tar -xf "$archive" -C "$1"
  extracted=$?
  rm -f "$archive"
  return $extracted
}

activate_release() {
  release="$1"; previous="$2"
  point_current_at "$release" || { log "could not switch current"; return 1; }
  if ! link_site_path; then
    revert_release "$previous"
    return 1
  fi
  if run_steps "$SDIR/steps.activate" "$release" && health_ok; then
    return 0
  fi
  if [ "$HEALTH_REVERT" = 1 ] && revert_release "$previous"; then
    RESULT_NOTE="reverted; migrations or other activate steps may already have run"
    return 2
  fi
  return 1
}

deploy_releases() {
  release="$DEPLOY_ROOT/releases/$ID"
  previous="$(read_val current_release)"
  set_stage build
  mkdir -p "$release" "$DEPLOY_ROOT/shared" || return 1
  checkout_release "$release" || { log "checkout failed"; discard_release "$release"; return 1; }
  link_shared "$release"
  run_steps "$SDIR/steps.build" "$release" || { RESULT_NOTE="build failed; live site untouched"; discard_release "$release"; return 1; }
  enter_go_live || { discard_release "$release"; return 1; }
  activate_release "$release" "$previous"
  activated=$?
  [ "$activated" = 0 ] || { discard_release "$release"; return "$activated"; }
  write_val current_release "$release"
  prune_releases
}

deploy_inplace() {
  for shared in $SHARED_PATHS; do
    if git --git-dir="$MIRROR" cat-file -e "$COMMIT:$shared" 2>/dev/null; then
      RESULT_NOTE="$shared is tracked in git; an in-place deploy would overwrite it"
      log "$RESULT_NOTE"
      return 1
    fi
  done
  if [ ! -d "$SITE_PATH/.git" ]; then
    mkdir -p "$SITE_PATH" && git -C "$SITE_PATH" init -q || return 1
  fi
  git -C "$SITE_PATH" fetch -q "$MIRROR" "+refs/heads/*:refs/remotes/shellway/*" || return 1
  set_stage build
  stop_if_cancelled || return 1
  LIVE_TOUCHED=1
  git -C "$SITE_PATH" reset -q --hard "$COMMIT" || return 1
  run_steps "$SDIR/steps.build" "$SITE_PATH" || return 1
  set_stage activate
  run_steps "$SDIR/steps.activate" "$SITE_PATH" || return 1
  health_ok || { RESULT_NOTE="health check failed"; return 1; }
  write_val current_release "$SITE_PATH"
}

needs_remote_fetch() {
  [ "$SOURCE_MODE" = auto ] || return 1
  [ -z "$REQUESTED" ] && return 0
  [ -z "$(resolve_commit "$REQUESTED")" ]
}

obtain_commit() {
  if [ -n "$BUNDLE" ]; then
    fetch_bundle "$BUNDLE" || return 1
  elif needs_remote_fetch; then
    fetch_remote || return 1
  fi
  COMMIT="$(resolve_commit "${REQUESTED:-refs/heads/$BRANCH}")"
  [ -n "$COMMIT" ] || { log "commit ${REQUESTED:-$BRANCH} not found"; return 1; }
}

json_escape() {
  printf '%s' "$1" | tr '\n\r\t' '   ' | tr -d '\000-\010\013\014\016-\037\177' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

notify_message() {
  message="Deploy $1: $SITE"
  [ -n "${COMMIT:-}" ] && message="$message at $(printf '%.7s' "$COMMIT")"
  [ -n "$RESULT_NOTE" ] && message="$message ($RESULT_NOTE)"
  printf '%s' "$message"
}

notify_payload() {
  case "$NOTIFY_URL" in
    http://hooks.slack.com/*|https://hooks.slack.com/*)
      printf '{"text": "%s"}' "$(json_escape "$(notify_message "$1")")" ;;
    http://discord.com/*|https://discord.com/*|http://discordapp.com/*|https://discordapp.com/*)
      printf '{"content": "%s"}' "$(json_escape "$(notify_message "$1")")" ;;
    *)
      printf '{"site": "%s", "status": "%s", "commit": "%s", "note": "%s"}' \
        "$(json_escape "$SITE")" "$1" "$(json_escape "${COMMIT:-}")" "$(json_escape "$RESULT_NOTE")" ;;
  esac
}

post_json() {
  if command -v curl >/dev/null 2>&1; then
    curl -sf -o /dev/null --max-time 10 -X POST -H 'Content-Type: application/json' -d "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null -T 10 --tries=1 --header='Content-Type: application/json' --post-data="$2" "$1"
  else
    return 2
  fi
}

notify_failure() {
  case "$1" in failed|reverted) ;; *) return 0 ;; esac
  case "$NOTIFY_URL" in http://?*|https://?*) ;; *) return 0 ;; esac
  post_json "$NOTIFY_URL" "$(notify_payload "$1")"
  sent=$?
  case "$sent" in
    0) log "failure notification sent" ;;
    2) ;;
    *) log "could not send failure notification" ;;
  esac
  return 0
}

finish() {
  status="$1"
  DEPLOY_OPEN=0
  history_add "$ID" "$status" "$TRIGGER" "${COMMIT:--}" "$STARTED" "$(now)" "$WARNINGS" "$RESULT_NOTE"
  rm -f "$SDIR/progress" "$SDIR/cancel"
  log "deploy $status"
  notify_failure "$status"
}

finish_unsuccessful() {
  if [ "$CANCELLED" != 1 ]; then
    finish failed
  else
    RESULT_NOTE="cancelled; live site untouched"
    finish cancelled
  fi
}

start_deploy_log() {
  STAGE="$1"; STEP_TOTAL="$2"
  [ -n "$ID" ] || ID="$(date -u +%Y%m%d%H%M%S)"
  check_id "$ID"
  [ -e "$SDIR/logs/$ID.log" ] && ID="$ID-$$"
  mkdir -p "$SDIR/logs"
  exec >>"$SDIR/logs/$ID.log" 2>&1
  STARTED="$(now)"
  history_add "$ID" running "$TRIGGER" "${REQUESTED:--}" "$STARTED" "" 0 ""
  DEPLOY_OPEN=1
  write_progress
}

do_deploy() {
  RESULT_NOTE=''
  acquire_lock || { printf 'busy\n' >&2; exit $EXIT_BUSY; }
  start_deploy_log fetch $(($(count_steps "$SDIR/steps.build") + $(count_steps "$SDIR/steps.activate")))
  log "deploy $SITE ($LAYOUT, $SOURCE_MODE, trigger $TRIGGER)"
  obtain_commit
  obtained=$?
  stop_if_cancelled && [ "$obtained" = 0 ] || { finish_unsuccessful; return 1; }
  write_val last_attempted "$COMMIT"
  log "commit $COMMIT"
  if needs_approval; then
    write_val pending "$COMMIT"
    RESULT_NOTE="new migrations need approval"
    finish waiting
    return 0
  fi
  rm -f "$SDIR/pending"
  if [ "$LAYOUT" = inplace ]; then deploy_inplace; else deploy_releases; fi
  outcome=$?
  case "$outcome" in
    0)
      write_val current "$COMMIT"
      if [ "$WARNINGS" -gt 0 ]; then finish warning; else finish success; fi ;;
    2) finish reverted; return 1 ;;
    *) finish_unsuccessful; return 1 ;;
  esac
}

cmd_deploy() {
  load_site "$1"; shift
  TRIGGER=manual; REQUESTED=''; BUNDLE=''; APPROVED=0; ID=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --trigger) TRIGGER="$2"; check_name "$TRIGGER"; shift 2 ;;
      --commit) REQUESTED="$2"; shift 2 ;;
      --bundle) BUNDLE="$2"; shift 2 ;;
      --uploaded-bundle) BUNDLE="$SDIR/incoming.bundle"; shift ;;
      --id) ID="$2"; shift 2 ;;
      --approved) APPROVED=1; shift ;;
      *) die "unknown option: $1" ;;
    esac
  done
  do_deploy
}

cmd_approve() {
  load_site "$1"
  pending="$(read_val pending)"
  [ -n "$pending" ] || die "nothing is waiting for approval"
  shift
  cmd_deploy "$SITE" --commit "$pending" --approved --trigger approve "$@"
}

cmd_rollback() {
  load_site "$1"
  check_id "$2"
  target_id="$2"; shift 2
  target_commit="$(history_commit_of "$target_id")"
  [ -n "$target_commit" ] || die "no successful deploy with id $target_id"
  if [ "$LAYOUT" = inplace ]; then
    cmd_deploy "$SITE" --commit "$target_commit" --approved --trigger rollback "$@"
    return
  fi
  TRIGGER=rollback; REQUESTED="$target_commit"; ID=''; RESULT_NOTE="to $target_id"
  [ "${1:-}" = --id ] && ID="${2:-}"
  release="$DEPLOY_ROOT/releases/$target_id"
  acquire_lock || { printf 'busy\n' >&2; exit $EXIT_BUSY; }
  start_deploy_log activate "$(count_steps "$SDIR/steps.activate")"
  COMMIT="$target_commit"
  [ -d "$release" ] || { RESULT_NOTE="release $target_id is no longer kept"; finish failed; return 1; }
  log "rolling back to $target_id ($COMMIT)"
  activate_release "$release" "$(read_val current_release)"
  outcome=$?
  case "$outcome" in
    0)
      write_val current_release "$release"
      write_val current "$COMMIT"
      if [ "$WARNINGS" -gt 0 ]; then finish warning; else finish success; fi ;;
    2) finish reverted; return 1 ;;
    *) finish failed; return 1 ;;
  esac
}

cmd_apply() {
  load_site "$1"; shift
  TRIGGER=env; ID=''; RESULT_NOTE="env file changed"
  [ "${1:-}" = --id ] && ID="${2:-}"
  COMMIT="$(read_val current)"
  live="$(read_val current_release)"
  [ -n "$COMMIT" ] && [ -d "$live" ] || die "nothing is deployed yet"
  REQUESTED="$COMMIT"
  acquire_lock || { printf 'busy\n' >&2; exit $EXIT_BUSY; }
  start_deploy_log activate "$(count_steps "$SDIR/steps.activate")"
  log "running after-going-live commands in $live"
  if run_steps "$SDIR/steps.activate" "$live" && health_ok; then
    if [ "$WARNINGS" -gt 0 ]; then finish warning; else finish success; fi
    return 0
  fi
  finish failed
  return 1
}

commits_behind() {
  live_commit="$(read_val current)"; newest_commit="$(read_val remote_head)"
  [ -n "$live_commit" ] && [ -n "$newest_commit" ] && [ -d "$MIRROR" ] || return 0
  [ -n "$(resolve_commit "$live_commit")" ] && [ -n "$(resolve_commit "$newest_commit")" ] || return 0
  git --git-dir="$MIRROR" rev-list --count "$live_commit..$newest_commit" 2>/dev/null
}

clock_minutes() {
  hours="${1%:*}"; minutes="${1#*:}"
  hours="${hours#0}"; minutes="${minutes#0}"
  echo $((${hours:-0} * 60 + ${minutes:-0}))
}

in_quiet_hours() {
  case "$QUIET_HOURS" in
    [0-2][0-9]:[0-5][0-9]-[0-2][0-9]:[0-5][0-9]) ;;
    *) return 1 ;;
  esac
  from="$(clock_minutes "${QUIET_HOURS%-*}")"
  until_minute="$(clock_minutes "${QUIET_HOURS#*-}")"
  at="$(clock_minutes "$(date +%H:%M)")"
  if [ "$from" -le "$until_minute" ]; then
    [ "$at" -ge "$from" ] && [ "$at" -lt "$until_minute" ]
  else
    [ "$at" -ge "$from" ] || [ "$at" -lt "$until_minute" ]
  fi
}

cmd_tick() {
  load_site "$1"
  [ "$SOURCE_MODE" = auto ] || return 0
  ticked="$(now)"
  beat="$(read_val heartbeat)"
  failures="$(read_val check_failures)"
  failures="${failures:-0}"
  [ "$failures" -gt 5 ] && failures=5
  backoff=$((1 << failures))
  if [ -n "$beat" ] && [ $((ticked - beat)) -lt $((POLL_MINUTES * 60 * backoff - 10)) ]; then
    return 0
  fi
  write_val heartbeat "$ticked"
  is_busy && return 0
  use_deploy_key
  head="$(with_timeout 60 git ls-remote -- "$REPO_URL" "refs/heads/$BRANCH" 2>/dev/null | cut -f1)"
  if [ -z "$head" ]; then
    write_val check_failures "$((failures + 1))"
    return 0
  fi
  rm -f "$SDIR/check_failures"
  write_val remote_head "$head"
  in_quiet_hours && return 0
  [ "$head" = "$(read_val last_attempted)" ] && return 0
  [ "$head" = "$(read_val current)" ] && return 0
  write_val last_attempted "$head"
  TRIGGER=auto; REQUESTED=''; BUNDLE=''; APPROVED=0; ID=''
  do_deploy
}

cmd_tick_all() {
  [ -d "$ROOT/sites" ] || return 0
  for dir in "$ROOT"/sites/*/; do
    [ -f "$dir/site.conf" ] || continue
    (cmd_tick "$(basename "$dir")")
  done
  return 0
}

cmd_status() {
  load_site "$1"
  mirror_head=''
  [ -d "$MIRROR" ] && mirror_head="$(resolve_commit "refs/heads/$BRANCH")"
  busy=0; is_busy && busy=1
  release="$(read_val current_release)"
  printf 'CURRENT=%s\n' "$(read_val current)"
  printf 'CURRENT_RELEASE=%s\n' "${release##*/}"
  printf 'LAST_ATTEMPTED=%s\n' "$(read_val last_attempted)"
  printf 'REMOTE_HEAD=%s\n' "$(read_val remote_head)"
  printf 'HEARTBEAT=%s\n' "$(read_val heartbeat)"
  printf 'MIRROR_HEAD=%s\n' "$mirror_head"
  printf 'PENDING=%s\n' "$(read_val pending)"
  printf 'BEHIND=%s\n' "$(commits_behind)"
  printf 'BUSY=%s\n' "$busy"
  printf 'CURRENT_SUBJECT=%s\n' "$(commit_subject "$(read_val current)")"
  if [ "$busy" = 1 ]; then
    [ -f "$SDIR/progress" ] && grep -v '^STEP_PID=' "$SDIR/progress"
    cancel_requested && printf 'CANCELLING=1\n'
  fi
  printf 'NOW=%s\n' "$(now)"
}

commit_subject() {
  [ -n "$1" ] && [ -d "$MIRROR" ] || return 0
  git --git-dir="$MIRROR" log -1 --format=%s "$1" -- 2>/dev/null | tr '\t' ' '
}

all_signalable() {
  for pid in $1; do kill -0 "$pid" 2>/dev/null || return 1; done
  return 0
}

stop_step() {
  step_tree="$(process_tree "$1" "$2")"
  all_signalable "$step_tree" || return 1
  stop_tree "$step_tree"
}

refuse_cancel() {
  rm -f "$SDIR/cancel"
  die "$1"
}

cmd_cancel() {
  load_site "$1"
  is_busy || die "no deploy is running"
  : > "$SDIR/cancel"
  progress="$(cat "$SDIR/progress" 2>/dev/null)"
  stage="$(progress_field "$progress" STAGE)"
  step_pid="$(progress_field "$progress" STEP_PID)"
  case "$stage" in
    ''|fetch|build) ;;
    *) refuse_cancel "this deploy is already going live and can't be stopped now" ;;
  esac
  [ "$LAYOUT" = inplace ] && [ "$stage" = build ] \
    && refuse_cancel "this site updates in place and its code has already changed; stopping now would leave it half-built"
  owner="$(cat "$SDIR/lock/pid" 2>/dev/null)"
  if [ -z "$step_pid" ] || [ -z "$owner" ] || stop_step "$step_pid" "$owner"; then
    printf 'cancelling\n'
  else
    printf 'cancelling after the current command finishes\n'
  fi
}

cron_running() {
  command -v pgrep >/dev/null 2>&1 || command -v systemctl >/dev/null 2>&1 || return 0
  for process in $CRON_PROCESSES; do
    pgrep -x "$process" >/dev/null 2>&1 && return 0
    systemctl is-active --quiet "$process" >/dev/null 2>&1 && return 0
  done
  return 1
}

read_remote_head() {
  use_deploy_key
  err_file="$SDIR/ls-remote.err"
  out="$(with_timeout 60 git ls-remote -- "$REPO_URL" "refs/heads/$BRANCH" 2>"$err_file")"
  listed=$?
  err="$(cat "$err_file" 2>/dev/null)"
  rm -f "$err_file"
  [ "$listed" = 0 ] || die "${err:-could not read $REPO_URL}"
  REMOTE_HEAD="$(printf '%s\n' "$out" | awk -F "$TAB" -v ref="refs/heads/$BRANCH" '$2 == ref { print $1; exit }')"
  [ -n "$REMOTE_HEAD" ] || die "branch $BRANCH not found"
}

cmd_resume() {
  load_site "$1"
  [ "$SOURCE_MODE" = auto ] || die "only sites that deploy automatically on the server have a server check"
  cmd_cron_install || die "could not add the schedule to the crontab"
  cron_running || die "the schedule is in place, but the cron service is not running on this server"
  read_remote_head
  rm -f "$SDIR/check_failures"
  write_val remote_head "$REMOTE_HEAD"
  write_val heartbeat "$(($(now) - POLL_MINUTES * 60))"
  printf '%s\n' "$REMOTE_HEAD"
}

cmd_history() {
  load_site "$1"
  [ -f "$SDIR/history.tsv" ] && tail -n "${2:-200}" "$SDIR/history.tsv"
  return 0
}

cmd_dump() {
  [ -d "$ROOT/sites" ] || return 0
  for dir in "$ROOT"/sites/*/; do
    [ -f "$dir/site.conf" ] || continue
    name="$(basename "$dir")"
    printf '@@SITE %s\n@@CONF\n' "$name"
    cat "$dir/site.conf"
    printf '@@BUILD\n'
    [ -f "$dir/steps.build" ] && cat "$dir/steps.build"
    printf '@@ACTIVATE\n'
    [ -f "$dir/steps.activate" ] && cat "$dir/steps.activate"
    printf '@@STATUS\n'
    (cmd_status "$name")
    printf '@@HISTORY\n'
    (cmd_history "$name" 200)
    printf '@@END\n'
  done
}

cmd_log() {
  load_site "$1"
  check_id "$2"
  offset="${3:-0}"
  case "$offset" in ''|*[!0-9]*) die "invalid offset" ;; esac
  [ -f "$SDIR/logs/$2.log" ] && tail -c +"$((offset + 1))" "$SDIR/logs/$2.log"
  return 0
}

cmd_keygen() {
  load_site "$1"
  if [ ! -f "$SDIR/deploy_key" ]; then
    ssh-keygen -q -t ed25519 -N '' -C "shellway-deploy:$SITE@$(hostname)" -f "$SDIR/deploy_key" || die "ssh-keygen failed"
  fi
  chmod 600 "$SDIR/deploy_key"
  cat "$SDIR/deploy_key.pub"
}

cmd_check_remote() {
  load_site "$1"
  read_remote_head
  rm -f "$SDIR/check_failures"
  printf '%s\n' "$REMOTE_HEAD"
}

cron_line() { printf '* * * * * "%s/bin/shellway-deploy" tick-all >/dev/null 2>&1 %s\n' "$ROOT" "$CRON_MARKER"; }

cmd_cron_install() {
  existing="$("$CRONTAB_BIN" -l 2>/dev/null)"
  printf '%s\n' "$existing" | grep -qF "$CRON_MARKER" && return 0
  { [ -n "$existing" ] && printf '%s\n' "$existing"; cron_line; } | "$CRONTAB_BIN" -
}

cmd_cron_remove() {
  existing="$("$CRONTAB_BIN" -l 2>/dev/null)"
  printf '%s\n' "$existing" | grep -qF "$CRON_MARKER" || return 0
  printf '%s\n' "$existing" | grep -vF "$CRON_MARKER" | "$CRONTAB_BIN" -
}

path_kind() {
  if [ -L "$SITE_PATH" ]; then
    if [ "$(readlink "$SITE_PATH")" = "$DEPLOY_ROOT/current" ]; then echo symlink; else echo foreign-symlink; fi
  elif [ -d "$SITE_PATH" ]; then echo dir
  elif [ -e "$SITE_PATH" ]; then echo file
  else echo missing
  fi
}

flag() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi; }

doctor_sudo() {
  for steps_file in "$SDIR/steps.build" "$SDIR/steps.activate"; do
    [ -f "$steps_file" ] || continue
    while IFS="$TAB" read -r kind cmd || [ -n "${kind:-}" ]; do
      case "${cmd:-}" in "sudo "*) ;; *) continue ;; esac
      rest="${cmd#sudo }"
      case "$rest" in -*) continue ;; esac
      program="${rest%% *}"
      args=''
      [ "$program" != "$rest" ] && args=" ${rest#* }"
      resolved="$(command -v "$program" 2>/dev/null || printf '%s' "$program")"
      full="$resolved$args"
      if sudo -n -l $full </dev/null >/dev/null 2>&1; then
        printf 'SUDO_OK\t%s\n' "$full"
      else
        printf 'SUDO_NEEDS\t%s\n' "$full"
      fi
    done < "$steps_file"
  done
}

cmd_doctor() {
  load_site "$1"
  printf 'USER=%s\n' "$(id -un)"
  printf 'GIT=%s\n' "$(flag command -v git)"
  printf 'CURL=%s\n' "$(flag command -v curl)"
  printf 'WGET=%s\n' "$(flag command -v wget)"
  printf 'CRONTAB=%s\n' "$(flag command -v "$CRONTAB_BIN")"
  printf 'SSH_KEYGEN=%s\n' "$(flag command -v ssh-keygen)"
  printf 'SITE_PATH_KIND=%s\n' "$(path_kind)"
  printf 'PARENT_WRITABLE=%s\n' "$(flag test -w "$(dirname "$SITE_PATH")")"
  printf 'SITE_WRITABLE=%s\n' "$(flag test -w "$SITE_PATH")"
  printf 'DEPLOY_KEY=%s\n' "$(flag test -f "$SDIR/deploy_key")"
  doctor_sudo
}

cmd_env_path() {
  load_site "$1"
  if [ "$LAYOUT" = inplace ]; then
    printf '%s/%s\n' "$SITE_PATH" "$ENV_FILE"
  else
    printf '%s/shared/%s\n' "$DEPLOY_ROOT" "$ENV_FILE"
  fi
}

any_auto_site() { grep -l "^SOURCE_MODE='auto'" "$ROOT"/sites/*/site.conf >/dev/null 2>&1; }

cmd_sync_cron() {
  if any_auto_site; then cmd_cron_install; else cmd_cron_remove; fi
}

cmd_remove() {
  load_site "$1"
  is_busy && die "a deploy is running"
  rm -rf "$SDIR"
  cmd_sync_cron
  log "removed site $SITE; $SITE_PATH and $DEPLOY_ROOT were left untouched"
}

main() {
  command="${1:-}"
  [ $# -gt 0 ] && shift
  case "$command" in
    version) echo "$RUNNER_VERSION" ;;
    deploy) [ $# -ge 1 ] || die "usage: deploy <site> [options]"; cmd_deploy "$@" ;;
    approve) [ $# -ge 1 ] || die "usage: approve <site>"; cmd_approve "$@" ;;
    rollback) [ $# -ge 2 ] || die "usage: rollback <site> <id>"; cmd_rollback "$@" ;;
    apply) [ $# -ge 1 ] || die "usage: apply <site>"; cmd_apply "$@" ;;
    tick) [ $# -ge 1 ] || die "usage: tick <site>"; cmd_tick "$1" ;;
    tick-all) cmd_tick_all ;;
    status) [ $# -ge 1 ] || die "usage: status <site>"; cmd_status "$1" ;;
    history) [ $# -ge 1 ] || die "usage: history <site> [n]"; cmd_history "$@" ;;
    dump) cmd_dump ;;
    log) [ $# -ge 2 ] || die "usage: log <site> <id> [offset]"; cmd_log "$@" ;;
    keygen) [ $# -ge 1 ] || die "usage: keygen <site>"; cmd_keygen "$1" ;;
    check-remote) [ $# -ge 1 ] || die "usage: check-remote <site>"; cmd_check_remote "$1" ;;
    cancel) [ $# -ge 1 ] || die "usage: cancel <site>"; cmd_cancel "$1" ;;
    resume) [ $# -ge 1 ] || die "usage: resume <site>"; cmd_resume "$1" ;;
    cron-install) cmd_cron_install ;;
    cron-remove) cmd_cron_remove ;;
    sync-cron) cmd_sync_cron ;;
    doctor) [ $# -ge 1 ] || die "usage: doctor <site>"; cmd_doctor "$1" ;;
    env-path) [ $# -ge 1 ] || die "usage: env-path <site>"; cmd_env_path "$1" ;;
    remove) [ $# -ge 1 ] || die "usage: remove <site>"; cmd_remove "$1" ;;
    *) die "usage: shellway-deploy <version|deploy|approve|rollback|apply|tick|tick-all|status|history|dump|log|keygen|check-remote|cancel|resume|cron-install|cron-remove|sync-cron|doctor|env-path|remove>" ;;
  esac
}

main "$@"
