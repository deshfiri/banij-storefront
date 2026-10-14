#!/usr/bin/env bash
# DEVELOPMENT ONLY. Stops whatever listens on the given local ports (Next renames its process to
# "next-server", so matching on the launch command misses it).
for port in "$@"; do
  for pid in $(ss -ltnpH "sport = :$port" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
    kill "$pid" 2>/dev/null
  done
done
sleep 1
