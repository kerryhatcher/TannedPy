"""Tests for the tannedpy guard decision engine."""

import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
GUARD_PATH = REPO / "hooks" / "scripts" / "tannedpy_guard.py"

_spec = importlib.util.spec_from_file_location("tannedpy_guard", GUARD_PATH)
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

PATTERNS = json.loads((REPO / "shared" / "patterns.json").read_text())


# --- split_segments -------------------------------------------------------

@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("python3 foo.py", ["python3 foo.py"]),
        ("cd /tmp && python3 foo.py", ["cd /tmp", "python3 foo.py"]),
        ("a; b | c || d", ["a", "b", "c", "d"]),
        ("echo 'a && b'", ["echo 'a && b'"]),
        ('echo "x; y"', ['echo "x; y"']),
        ("line1\nline2", ["line1", "line2"]),
    ],
)
def test_split_segments(command, expected):
    assert guard.split_segments(command) == expected


# --- extract_invocation ----------------------------------------------------

WRAPPERS = frozenset(PATTERNS["wrapper_commands"])
WRAPPER_VALUE_FLAGS = PATTERNS["wrapper_value_flags"]


@pytest.mark.parametrize(
    ("segment", "word", "args"),
    [
        ("python3 foo.py", "python3", ["foo.py"]),
        ("/usr/bin/python3 foo.py", "python3", ["foo.py"]),
        ("FOO=1 BAR=2 python x.py", "python", ["x.py"]),
        ("sudo python3 x.py", "python3", ["x.py"]),
        ("sudo -u root python3 x.py", "python3", ["x.py"]),
        ("env python x.py", "python", ["x.py"]),
        ("grep python file.txt", "grep", ["python", "file.txt"]),
        ("", None, []),
    ],
)
def test_extract_invocation(segment, word, args):
    assert guard.extract_invocation(segment, WRAPPERS, WRAPPER_VALUE_FLAGS) == (word, args)


def test_extract_invocation_unparseable_returns_none():
    # Unclosed quote makes shlex raise; we must not crash.
    assert guard.extract_invocation("echo 'unclosed", WRAPPERS, WRAPPER_VALUE_FLAGS) == (None, [])


# --- evaluate: denials -----------------------------------------------------

@pytest.mark.parametrize(
    "command",
    [
        "python3 foo.py",
        "python foo.py",
        "python3.12 foo.py",
        "/usr/bin/python3 foo.py",
        "pip install requests",
        "pip3 install requests",
        "cd /tmp && python3 foo.py",
        "ls; python x.py",
        "python -m venv .venv",
        "python3 -m pip install x",
        "virtualenv env",
        "easy_install thing",
        "sudo python3 x.py",
        "FOO=1 python x.py",
        "sudo -u root python3 evil.py",
        "nice -n 10 python3 evil.py",
        "xargs -n 1 python3",
    ],
)
def test_denied(command):
    deny, _note = guard.evaluate(command, PATTERNS)
    assert deny is not None


# --- evaluate: allowed -----------------------------------------------------

@pytest.mark.parametrize(
    "command",
    [
        "uv run python foo.py",
        "uv run python -c 'print(1)'",
        "uv add requests",
        "uvx ruff check",
        "python --version",
        "python3 -V",
        "which python3",
        "command -v python",
        "type python3",
        "grep python file.txt",
        "echo 'python3 is old'",
        'echo "run: pip install x"',
        "cat requirements.txt",
        "python3 x.py  # tannedpy: allow",
        "pip install x  # tannedpy: allow",
        "git commit -m 'fix python handling'",
        "sudo -u root uv run x.py",
        "",
    ],
)
def test_allowed(command):
    deny, _note = guard.evaluate(command, PATTERNS)
    assert deny is None


# --- evaluate: version-probe recognition (US1, FR-001/FR-008) --------------


@pytest.mark.parametrize(
    "command",
    [
        "python3 --version 2>&1",  # F12 regression
        "python3 --version",
        "python3 -V",
        "pip3 -V 2>&1",
        "python3 --version > /tmp/v.txt",
        "python3 --version >> log 2>&1",
        "sudo python3 --version 2>&1",
        "python3 --version | grep 3",
    ],
)
def test_version_probe_is_allowed(command):
    deny, _note = guard.evaluate(command, PATTERNS)
    assert deny is None


@pytest.mark.parametrize(
    "command",
    [
        "python3 script.py",
        "python3",
        "python3 --version --unknown-flag foo",
        "python3 --version && python3 train.py",
    ],
)
def test_non_probe_still_denied(command):
    deny, _note = guard.evaluate(command, PATTERNS)
    assert deny is not None


# --- evaluate: message selection -------------------------------------------

def test_pip_gets_install_message():
    reason, _note = guard.evaluate("pip install requests", PATTERNS)
    assert "uv add" in reason


def test_venv_gets_venv_message():
    reason, _note = guard.evaluate("python -m venv .venv", PATTERNS)
    assert "uv init" in reason or "uv sync" in reason


def test_python_m_pip_gets_install_message():
    reason, _note = guard.evaluate("python3 -m pip install x", PATTERNS)
    assert "uv add" in reason


def test_plain_python_gets_run_message():
    reason, _note = guard.evaluate("python3 foo.py", PATTERNS)
    assert "uv run" in reason and "--script" in reason


# --- load_patterns ----------------------------------------------------------

def test_load_patterns_matches_json_file():
    assert guard.load_patterns() == json.loads(
        (REPO / "shared" / "patterns.json").read_text()
    )


# --- patterns.json contract: version_probe ----------------------------------


def test_version_probe_flags_are_non_empty_strings():
    flags = PATTERNS["version_probe"]["flags"]
    assert isinstance(flags, list) and len(flags) > 0
    assert all(isinstance(f, str) and f for f in flags)


def test_version_probe_redirection_pattern_compiles():
    re.compile(PATTERNS["version_probe"]["redirection_pattern"])


def test_version_probe_note_is_non_empty_and_terse():
    note = PATTERNS["messages"]["version_probe_note"]
    assert isinstance(note, str) and note
    assert len(note) <= 300


def test_version_args_key_is_absent():
    assert "version_args" not in PATTERNS


# --- end-to-end: run the hook as Claude Code would --------------------------


def run_guard(stdin_text: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(GUARD_PATH)], input=stdin_text, capture_output=True, text=True, timeout=60
    )


def payload(command: str) -> str:
    return json.dumps(
        {"tool_name": "Bash", "tool_input": {"command": command}, "hook_event_name": "PreToolUse"}
    )


def test_e2e_deny_emits_json_and_exits_zero():
    result = run_guard(payload("python3 foo.py"))
    assert result.returncode == 0
    out = json.loads(result.stdout)
    hso = out["hookSpecificOutput"]
    assert hso["hookEventName"] == "PreToolUse"
    assert hso["permissionDecision"] == "deny"
    assert "uv run" in hso["permissionDecisionReason"]


def test_e2e_allow_emits_nothing():
    result = run_guard(payload("uv run pytest"))
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_e2e_non_bash_tool_ignored():
    result = run_guard(json.dumps({"tool_name": "Write", "tool_input": {"file_path": "python"}}))
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_e2e_malformed_input_fails_open():
    result = run_guard("this is not json {{{")
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_e2e_empty_input_fails_open():
    result = run_guard("")
    assert result.returncode == 0
    assert result.stdout.strip() == ""


# --- e2e: version-probe allow-with-note (US2, FR-003/FR-004/FR-005/FR-006) --


@pytest.mark.parametrize("command", ["python3 --version", "pip --version"])
def test_e2e_probe_emits_defer_with_note(command):
    result = run_guard(payload(command))
    assert result.returncode == 0
    out = json.loads(result.stdout)
    hso = out["hookSpecificOutput"]
    assert hso["hookEventName"] == "PreToolUse"
    assert hso["permissionDecision"] == "defer"
    assert hso["additionalContext"] == PATTERNS["messages"]["version_probe_note"]


@pytest.mark.parametrize(
    "command",
    ["node --version", "which python3", "uv run python --version"],
)
def test_e2e_non_probe_emits_nothing(command):
    result = run_guard(payload(command))
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_e2e_deny_never_carries_additional_context():
    result = run_guard(payload("python3 script.py"))
    assert result.returncode == 0
    out = json.loads(result.stdout)
    assert "additionalContext" not in out["hookSpecificOutput"]


def test_e2e_deny_suppresses_note_even_with_probe_segment():
    result = run_guard(payload("python3 --version && python3 train.py"))
    assert result.returncode == 0
    out = json.loads(result.stdout)
    hso = out["hookSpecificOutput"]
    assert hso["permissionDecision"] == "deny"
    assert "additionalContext" not in hso


def test_e2e_multiple_probe_segments_yield_exactly_one_note():
    result = run_guard(payload("python3 --version 2>&1 && pip -V"))
    assert result.returncode == 0
    out = json.loads(result.stdout)
    hso = out["hookSpecificOutput"]
    assert hso["permissionDecision"] == "defer"
    assert hso["additionalContext"] == PATTERNS["messages"]["version_probe_note"]
