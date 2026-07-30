#!/usr/bin/env bash
# Stop hook (type: agent wrapper is configured in settings.json; this script
# is kept for reference/manual invocation and documents the prompt used).
#
# Enforces CLAUDE.md workflow rule #2: after finishing a task, run the
# `debugger` subagent (.claude/agents/debugger.md) against the session's
# changes before declaring the task done.
#
# The actual Stop hook in settings.json uses an inline "agent" hook with this
# same prompt (agent-type hooks cannot shell out to a script and get an LLM
# turn back). This file documents that prompt so it stays in sync.

cat <<'PROMPT'
Act as the `debugger` subagent defined in .claude/agents/debugger.md (senior SQL/Node.js debugging specialist). Review the code changes made during this session (check `git diff` / recently modified files) for bugs, root causes, missing transactions on multi-write SQL, N+1 queries, missing indexes, missing `await`/blocking sync calls, and any other issues per that agent's workflow. Reproduce problems where possible, fix the root cause (not just the symptom), and verify the fix. If no application code was changed this session (e.g. docs/planning only), say so and do nothing else.

If a bug is found, report it to the user under short headings — What's wrong / Why it happens / Fix proposed — in plain language a non-coder can follow, then stop and wait for the user to say approved, not approved, or approved with changes before applying further fixes. If no bug is found, say so briefly in the same plain style.
PROMPT
