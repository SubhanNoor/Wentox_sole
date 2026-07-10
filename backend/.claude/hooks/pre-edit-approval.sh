#!/usr/bin/env bash
# PreToolUse hook (matcher: Write|Edit)
# Enforces CLAUDE.md workflow rule #1: state the task + plan and get explicit
# approval before making code changes. Forces the built-in permission prompt
# ("ask") so the user always sees and approves the pending edit.

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: "Workflow rule (CLAUDE.md): state the task + plan and get explicit approval before this change. If not yet approved, stop and confirm with the user; if they request edits, revise the plan first."
  }
}'
