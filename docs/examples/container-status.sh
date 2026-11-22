#!/usr/bin/env bash
# Publish a sanitised, read-only container list for Sofa Launcher's Docker tile.
#
# Run it as a system service under an account in the docker group (never the TV user).
# It writes only: name, image, state, status, health, the compose project and service,
# a description, CPU and memory use, and (optional) whether a newer image is available.
# Never env, mounts, commands or other labels.
#
# Update: if an update checker writes SOFA_UPDATES_FILE (a JSON object keyed by container name,
# each {Available, Current, Latest, Kind, Checked}), each container's entry is passed on as
# Update. Without that file nothing is added.
#
# A service labelled  sofa.restart: "false"  (and any container that is not running) is published as not restartable (see
# container-restart/, which refuses it whatever this file says). A compose service labelled
#  sofa.update: "true"  is published as Updatable: the launcher may then offer to update it
# (container-restart/'s update socket, which checks the label itself).
#
# Description: the compose label `sofa.description` if a service sets one, otherwise the
# image's own `org.opencontainers.image.description` label, otherwise empty.
#
#   services:
#     sonarr:
#       labels:
#         sofa.description: "Finds new TV episodes and files them in the library."
set -euo pipefail
# Keep the interval well under a minute: the launcher treats a file older than 60 s as stale
# and records no history from it.
out=${SOFA_STATUS_FILE:-/var/lib/docker-status/containers.json}
updates=${SOFA_UPDATES_FILE:-/var/lib/docker-status/updates.json}
interval=${SOFA_STATUS_INTERVAL:-15}
# `docker stats` costs a second or two, so usage is sampled less often than status.
stats_every=${SOFA_STATS_EVERY:-4}
stats='[]'
n=0
tmp=''
trap '[[ -z $tmp ]] || rm -f "$tmp"' EXIT

# "12.3MiB" -> bytes; CPU "1.25%" -> 1.25.
jq_defs='
def bytes: (capture("^(?<n>[0-9.]+)\\s*(?<u>[A-Za-z]*)$")? // null) as $m
  | if $m == null then null else (($m.n | tonumber) * ({"B":1,"kB":1000,"KB":1000,"KiB":1024,"MB":1e6,"MiB":1048576,
      "GB":1e9,"GiB":1073741824,"TB":1e12,"TiB":1099511627776}[$m.u] // 1) | floor) end;
def pct: (rtrimstr("%") | tonumber?) // null;'

while :; do
  if (( n % stats_every == 0 )); then
    stats=$(timeout 30 docker stats --no-stream --no-trunc --format '{{json .}}' 2>/dev/null |
      jq -sc "$jq_defs"'[.[] | {id: .ID, cpu: (.CPUPerc | pct), mem: (.MemUsage | split(" / ")[0] | bytes)}]') || stats='[]'
  fi
  n=$((n + 1))
  [ -s "$updates" ] && jq -e 'type == "object"' "$updates" >/dev/null 2>&1 && upd=$updates || upd=/dev/null
  tmp=$(mktemp "$out.XXXXXX")
  fmt='{"c":{{json .}},"p":{{json (.Label "com.docker.compose.project")}},"s":{{json (.Label "com.docker.compose.service")}},"d":{{json (.Label "sofa.description")}},"i":{{json (.Label "org.opencontainers.image.description")}},"r":{{json (.Label "sofa.restart")}},"u":{{json (.Label "sofa.update")}}}'
  # Health is also in the Status text ("Up 2 hours (healthy)"), which the launcher reads when
  # this docker version has no HealthStatus field.
  if timeout 30 docker ps -a --no-trunc --format "$fmt" |
     jq -s --argjson stats "$stats" --slurpfile upd "$upd" '
       ($stats | map({key: .id, value: .}) | from_entries) as $use
       | ($upd[0] // {}) as $updates
       | [.[] | .c as $c | ($use[$c.ID] // {}) as $u
           | {Id: $c.ID, Names: ["/" + $c.Names], Image: $c.Image, State: $c.State, Status: $c.Status,
              Health: {Status: ($c.HealthStatus // "none")}, Project: .p, Service: .s,
              Description: ((if .d != "" then .d else .i end) | gsub("\\s+"; " ") | .[0:240])}
             + (if $c.State == "running" and $u.cpu != null then {Cpu: $u.cpu} else {} end)
             + (if $c.State == "running" and $u.mem != null then {Mem: $u.mem} else {} end)
             + (if $updates[$c.Names] then {Update: ($updates[$c.Names] | {Available, Current, Latest, Kind, Checked})} else {} end)
             # Updatable: the compose file opts in with  sofa.update: "true"  (the update service checks it too).
             + (if (.u | ascii_downcase | gsub("\\s"; "") | IN("true", "yes", "on", "1")) and .p != "" and .s != "" then {Updatable: true} else {} end)
             + (if (.r | ascii_downcase | gsub("\\s"; "") | IN("false", "no", "off", "0")) or $c.State != "running" then {Restartable: false} else {} end)]
       | sort_by(.Names[0])' >"$tmp"; then
    chmod 644 "$tmp"; mv -f "$tmp" "$out"; tmp=''
  else
    rm -f "$tmp"; tmp=''; echo "docker ps failed" >&2
  fi
  sleep "$interval"
done
