# Adapters

behalf is a command line, so any agent that can run a shell command can use it.
These files just tell your agent that it exists and how to use it well.

| host | where to put it |
|---|---|
| Claude Code | `claude-code/behalf.md` into `~/.claude/rules/` |
| Codex | append `codex/AGENTS-section.md` to your `AGENTS.md` |
| Cursor | append `cursor/cursorrules-section.md` to `.cursorrules` |
| Zed | `zed/behalf-rules.md` into your rules directory |

For anything else, paste the same text wherever that host keeps its standing
instructions. There is nothing host specific in the tool itself.
