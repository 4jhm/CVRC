#!/usr/bin/env bash
# Regenerates data/avatar_database.json from the shared Gofile folder that backs the
# in-app Avatar Database tool. Requires GOFILE_PREMIUM_TOKEN — Gofile's official folder
# listing endpoint is Premium-only, and this script is the ONLY place that token is ever
# used; it is never shipped in the app (see main/AvatarDatabaseController.cs for why).
#
# Run from the repo root, e.g.:
#   GOFILE_PREMIUM_TOKEN=xxx ./scripts/refresh-avatar-db.sh
set -euo pipefail

CONTENT_ID="dLV8UU"
OUT_FILE="data/avatar_database.json"
PAGE_SIZE=1000

if [ -z "${GOFILE_PREMIUM_TOKEN:-}" ]; then
  echo "GOFILE_PREMIUM_TOKEN is not set" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

page=1
all_files='[]'

while :; do
  resp=$(curl -sS -G "https://api.gofile.io/contents/${CONTENT_ID}" \
    -H "Authorization: Bearer ${GOFILE_PREMIUM_TOKEN}" \
    --data-urlencode "page=${page}" \
    --data-urlencode "pageSize=${PAGE_SIZE}" \
    --data-urlencode "sortField=name" \
    --data-urlencode "sortDirection=1")

  status=$(echo "$resp" | jq -r '.status')
  if [ "$status" != "ok" ]; then
    echo "Gofile API error on page ${page}: ${status}" >&2
    echo "$resp" >&2
    exit 1
  fi

  # Deliberately no download link here: the manifest is a public, permanently-versioned
  # GitHub file, and the shared folder is public anyway — the app opens the folder page for
  # downloads instead of shipping a ready-made bulk link-dump of every file in it.
  page_files=$(echo "$resp" | jq '[.data.children[]? | select(.type == "file") | {name: .name, sizeBytes: .size, createTime: .createTime}]')
  all_files=$(jq -c -n --argjson a "$all_files" --argjson b "$page_files" '$a + $b')

  has_next=$(echo "$resp" | jq -r '.metadata.hasNextPage // false')
  [ "$has_next" = "true" ] || break
  page=$((page + 1))
done

jq -n --argjson files "$all_files" --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{generatedAt: $generatedAt, files: $files}' > "$OUT_FILE"

echo "Wrote $(echo "$all_files" | jq 'length') entries to ${OUT_FILE}"
