#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""tannedpy guard — PreToolUse hook that denies system python and redirects to uv.

Reads Claude Code PreToolUse JSON on stdin. On a bare python/pip/virtualenv
invocation, prints a JSON permissionDecision "deny" with a redirect message.
Fails open: every code path exits 0.
"""

import json
import re
import shlex
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def load_patterns() -> dict:
    return json.loads((SCRIPT_DIR.parent.parent / "shared" / "patterns.json").read_text())


def split_segments(command: str) -> list[str]:
    """Split a shell command at unquoted &&, ||, ;, | and newlines."""
    segments: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i, n = 0, len(command)
    while i < n:
        ch = command[i]
        if quote:
            if ch == "\\" and quote == '"' and i + 1 < n:
                buf.append(command[i : i + 2])
                i += 2
                continue
            if ch == quote:
                quote = None
            buf.append(ch)
            i += 1
            continue
        if ch in "'\"":
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            buf.append(command[i : i + 2])
            i += 2
            continue
        if command[i : i + 2] in ("&&", "||"):
            segments.append("".join(buf))
            buf = []
            i += 2
            continue
        if ch in ";|\n":
            segments.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    segments.append("".join(buf))
    return [s.strip() for s in segments if s.strip()]


_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def extract_invocation(
    segment: str,
    wrappers: frozenset[str],
    wrapper_value_flags: dict[str, list[str]] | None = None,
) -> tuple[str | None, list[str]]:
    """Return (command word basename, args), skipping env assignments and wrappers."""
    try:
        tokens = shlex.split(segment, posix=True)
    except ValueError:
        return None, []
    idx = 0
    while idx < len(tokens):
        tok = tokens[idx]
        if _ASSIGNMENT.match(tok):
            idx += 1
            continue
        if tok in wrappers:
            value_flags = (wrapper_value_flags or {}).get(tok, [])
            idx += 1
            while idx < len(tokens) and tokens[idx].startswith("-"):
                if tokens[idx] in value_flags:
                    idx += 2
                else:
                    idx += 1
            continue
        break
    if idx >= len(tokens):
        return None, []
    word = tokens[idx].rsplit("/", 1)[-1]
    return word, tokens[idx + 1 :]


def _pick_message(word: str, args: list[str], messages: dict) -> str:
    if word.startswith("pip") or word == "easy_install":
        return messages["install"]
    if word == "virtualenv" or args[:2] == ["-m", "venv"]:
        return messages["venv"]
    if args[:2] == ["-m", "pip"]:
        return messages["install"]
    return messages["run"]


def evaluate(command: str, patterns: dict) -> str | None:
    """Return a deny reason, or None if the command is allowed."""
    if patterns["escape_hatch"] in command:
        return None
    deny_re = re.compile(patterns["deny_command_pattern"])
    wrappers = frozenset(patterns["wrapper_commands"])
    wrapper_value_flags = patterns.get("wrapper_value_flags")
    lookups = frozenset(patterns["lookup_commands"])
    version_args = [list(v) for v in patterns["version_args"]]
    for segment in split_segments(command):
        word, args = extract_invocation(segment, wrappers, wrapper_value_flags)
        if word is None or word == "uv" or word in lookups:
            continue
        if deny_re.match(word):
            if args in version_args:
                continue
            return _pick_message(word, args, patterns["messages"])
    return None


def main() -> None:
    data = json.loads(sys.stdin.read())
    if data.get("tool_name") != "Bash":
        return
    command = (data.get("tool_input") or {}).get("command") or ""
    reason = evaluate(command, load_patterns())
    if reason:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    }
                }
            )
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # fail open: never break the agent's shell
        print(f"tannedpy-guard: internal error, failing open: {exc}", file=sys.stderr)
    sys.exit(0)
