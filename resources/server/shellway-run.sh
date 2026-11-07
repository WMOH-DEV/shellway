#!/bin/sh
# Shellway run helper. Installed by Shellway; safe to read, do not edit by hand.
# Runs one long server step detached from the SSH session and reports on it.
set -u

RUN_VERSION=1
BASE=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd) || exit 1
RUNS="$BASE/runs"
CHUNK_BYTES=65536

die() { printf 'error: %s\n' "$*" >&2; exit 2; }

check_id() {
  case "$1" in
    ''|-*|*[!A-Za-z0-9-]*) die "invalid run id: $1" ;;
  esac
}

check_number() {
  case "$1" in
    ''|*[!0-9]*) die "invalid number: $1" ;;
  esac
}

SUPERVISOR='runs=$1; id=$2; limit=$3
own() { if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then chown "$SUDO_USER" "$@" 2>/dev/null; fi; }
publish() { printf "%s\n" "$2" > "$runs/$id.$1.tmp"; own "$runs/$id.$1.tmp"; mv -f "$runs/$id.$1.tmp" "$runs/$id.$1"; }
publish pid $$
timeout -k 10 "$limit" sh "$runs/$id.sh" >> "$runs/$id.log" 2>&1 </dev/null &
publish child $!
wait $!
publish exit $?'

is_alive() {
  pid=$(cat "$RUNS/$1.pid" 2>/dev/null) || return 1
  [ -n "$pid" ] || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\000' ' ' < "/proc/$pid/cmdline" | grep -q -- "$1"
    return
  fi
  err=$(kill -0 "$pid" 2>&1) && return 0
  case "$err" in
    *ermitted*) return 0 ;;
  esac
  return 1
}

can_follow() {
  tail --pid=$$ -c 0 /dev/null >/dev/null 2>&1
}

cmd_start() {
  id=$1; limit=$2
  check_id "$id"; check_number "$limit"
  mkdir -p "$RUNS" && chmod 700 "$RUNS" || die "cannot create $RUNS"
  find "$RUNS" -type f -mtime +30 -exec rm -f {} + 2>/dev/null
  [ -e "$RUNS/$id.log" ] && die "run $id already exists"
  (umask 077 && { echo 'rm -f -- "$0"'; cat; } > "$RUNS/$id.sh") || die "cannot write the step script"
  (umask 077 && : > "$RUNS/$id.log") || die "cannot create the log"
  if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then chown "$SUDO_USER" "$RUNS/$id.log"; fi
  detach=''
  if command -v setsid >/dev/null 2>&1; then detach=setsid; fi
  $detach nohup sh -c "$SUPERVISOR" shellway-run "$RUNS" "$id" "$limit" >/dev/null 2>&1 </dev/null &
  waited=0
  while [ ! -s "$RUNS/$id.pid" ] && [ "$waited" -lt 50 ]; do
    sleep 0.1 2>/dev/null || sleep 1
    waited=$((waited + 1))
  done
  [ -s "$RUNS/$id.pid" ] || die "the step did not start"
  echo "pid=$(cat "$RUNS/$id.pid")"
  if can_follow; then echo follow=1; else echo follow=0; fi
}

cmd_read() {
  id=$1; offset=$2
  check_id "$id"; check_number "$offset"
  log="$RUNS/$id.log"
  if [ ! -e "$log" ]; then
    echo "@@status known=0 alive=0 size=0 exit="
    return 0
  fi
  if is_alive "$id"; then alive=1; else alive=0; fi
  code=$(cat "$RUNS/$id.exit" 2>/dev/null)
  size=$(wc -c < "$log" | tr -d ' ')
  echo "@@status known=1 alive=$alive size=$size exit=$code"
  tail -c +"$((offset + 1))" "$log" 2>/dev/null | head -c "$CHUNK_BYTES"
}

cmd_kill() {
  id=$1
  check_id "$id"
  child=$(cat "$RUNS/$id.child" 2>/dev/null)
  if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null; fi
  echo killed
}

case "${1:-}" in
  version) echo "$RUN_VERSION" ;;
  start) cmd_start "${2:-}" "${3:-}" ;;
  read) cmd_read "${2:-}" "${3:-0}" ;;
  kill) cmd_kill "${2:-}" ;;
  *) die "usage: shellway-run version | start <id> <seconds> | read <id> <offset> | kill <id>" ;;
esac
