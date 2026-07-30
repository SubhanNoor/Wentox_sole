#!/usr/bin/env bash
# PreToolUse hook (matcher: Write|Edit)
# Enforces CLAUDE.md workflow rule #1: state the task + plan and get explicit
# approval before making code changes. Forces the built-in permission prompt
# ("ask") so the user always sees and approves the pending edit.

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: "Workflow rule (CLAUDE.md): before this change, present a short plan under headings (Goal / Approach / Benefit), in plain language a non-coder can follow. Get one of three explicit outcomes from the user: approved, not approved, or approved with changes. If not yet approved, stop and confirm; if changes are requested, revise the plan and re-confirm before touching code."
  }
}'
