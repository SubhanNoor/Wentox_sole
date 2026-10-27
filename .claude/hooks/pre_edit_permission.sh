#!/usr/bin/env bash
# PreToolUse hook: forces an explicit permission ask before any Edit/Write/MultiEdit.
# - Data-entry page files (frontend/src/pages/*.tsx) get asked about ONE PAGE AT A TIME,
#   naming that exact page in the prompt.
# - Everything else gets a generic "can I change this file" ask.
set -euo pipefail

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"

case "$tool_name" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *)
    # Not an edit-type tool, let it through untouched.
    exit 0
    ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"

if [ -z "$file_path" ]; then
  exit 0
fi

reason=""

if printf '%s' "$file_path" | grep -qE '/frontend/src/pages/[A-Za-z0-9_]+\.tsx$'; then
  page_name="$(basename "$file_path")"
  reason="Permission needed: edit data-entry page '${page_name}' (${file_path}). Confirm this specific page may be changed before proceeding — each page needs its own yes."
else
  reason="Permission needed: modify '${file_path}'. This is outside the data-entry pages — confirm this exact file may be changed before proceeding."
fi

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: $reason
  }
}'
