# spike/rewire.py — trỏ toàn bộ PreToolUse về một script duy nhất, giữ nguyên event khác.
import json, sys, pathlib
script = sys.argv[1]
node = "/Users/haiduong/.nvm/versions/node/v20.19.2/bin/node"
p = pathlib.Path.home() / ".codex" / "hooks.json"
cfg = json.loads(p.read_text())
cfg["hooks"]["PreToolUse"] = [
    {"hooks": [{"type": "command", "command": f'"{node}" "{script}"'}]}
]
p.write_text(json.dumps(cfg, indent=2) + "\n")
print("PreToolUse ->", script)
