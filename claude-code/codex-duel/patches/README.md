# Optional max effort for Codex Companion 1.0.6

Codex Duel 1.4.0 accepts `--effort max`. The unmodified OpenAI Codex plugin
1.0.6 rejects that value before it reaches Codex. This patch adds `max` to
the plugin's accepted values, usage text and error message. The runtime
passes the selected effort through unchanged.

The patch targets `scripts/codex-companion.mjs` in plugin version 1.0.6.
It is optional for the default `xhigh` effort. Apply it only when the selected
Codex model and client support `max`.

Find the plugin version folder under
`~/.claude/plugins/cache/openai-codex/codex/1.0.6/`. Back up
`scripts/codex-companion.mjs` outside the plugin cache. Replace the paths
below with absolute paths, then check the patch before applying it:

```text
git -C "<plugin-1.0.6-folder>" apply --check --ignore-space-change "<this-folder>/codex-companion-1.0.6-max.patch"
git -C "<plugin-1.0.6-folder>" apply --ignore-space-change "<this-folder>/codex-companion-1.0.6-max.patch"
```

If the check fails, stop and inspect the installed version. Do not force the
patch onto another version. Plugin updates can replace this local change.
Before a later `max` run, check whether the current plugin already accepts
`max` or still needs a compatible patch. Never substitute `xhigh` silently.

Local checks covered argument parsing, background requests, session resume
and forwarding `max` to `turn/start` with mocked I/O. No live model call was
made for this update.
