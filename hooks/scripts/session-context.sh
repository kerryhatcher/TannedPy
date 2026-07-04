#!/bin/sh
# tannedpy: inject uv-first context at session start — only when uv exists.
command -v uv >/dev/null 2>&1 || exit 0
cat <<'EOF'
tannedpy is active: use uv for ALL Python work. Ad-hoc/temp scripts: create a .py file starting with `#!/usr/bin/env -S uv run --script` plus a PEP 723 `# /// script` block (requires-python + dependencies), chmod a+x, run it directly (see the uv-scripting skill). Projects: uv init / uv add / uv sync / uv run (see the uv-projects skill). Bare python/pip commands are blocked.
EOF
exit 0
