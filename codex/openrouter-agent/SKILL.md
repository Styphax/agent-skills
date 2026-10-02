---
name: openrouter-agent
description: Use an isolated OpenRouter-backed Codex process for explicitly requested OpenRouter or open-weight model consultations, second opinions and model comparisons. Keep the parent Codex Desktop session on OpenAI. Reviewing or editing this skill does not authorize a paid consultation.
metadata:
  version: "1.1.0"
---

# OpenRouter Agent

Run one bounded advisory Codex session through OpenRouter. The helper uses a
separate Codex home and an ephemeral session. The parent session keeps its
provider, configuration and model catalog.

## Invocation and limits

Use this skill for an explicit OpenRouter consultation. One consultation is
one agent run, which can contain several model requests as the child reads
files or uses tools. It is not a promise of one billable API request.

The defaults are **25 minutes and at most eight Responses requests**. A
smaller user limit takes precedence. Increase a limit, run another consultation
or compare several models only when the user authorizes that scope. Automatic
HTTP and interrupted-stream retries are disabled. Stop on failure and report
the error without retrying or substituting another model.

The request cap counts requests forwarded by the local helper. OpenRouter
server tools may do additional work and incur charges within a request, so
this is not a monetary cap. The current standard preset includes date/time,
web search and web fetch. Preflight reports its current tool configuration.

## Workflow

1. Read [setup and verification](references/setup.md) when dependencies are
   missing, the configuration changed or this is a new installation.
2. Resolve `scripts/invoke-openrouter-agent.ps1` relative to this skill.
   Run it with `-ValidateOnly` first. This reads the live model catalog and,
   for a preset, its active configuration. It makes no inference request.
3. Use the user's named model. Otherwise keep `@preset/z-ai-glm-5-3-flash`,
   expected model `z-ai/glm-5.3-flash`, with `max` effort. For another model,
   use its supported effort and default as reported by preflight. Preserve
   explicit choices or stop if they are unsupported.
4. Give the child a bounded, self-contained task with relevant context and
   file paths. Exclude credentials and unrelated private information. Pass
   the task's directory as `-WorkingDirectory`.
5. Read the returned JSON. Report the actual verified model, effort and
   request count. Treat the answer as advisory and verify consequential
   findings against relevant files or primary sources.

```powershell
& "<skill-dir>/scripts/invoke-openrouter-agent.ps1" -ValidateOnly -WorkingDirectory "<task-dir>"
& "<skill-dir>/scripts/invoke-openrouter-agent.ps1" -Task "<bounded task>" -WorkingDirectory "<task-dir>"
```

Optional parameters: `-Model`, `-ExpectedModel`, `-Effort`, `-MaxRequests`
and `-TimeoutSeconds`. Use `-ExpectedModel` when the selected preset needs an
explicit model identity. It must agree with the model intended by the user.
Preflight is repeated before each real run.

## Execution boundaries

- The child is an external Codex process with `read-only` sandbox and no
  approval escalation. It proposes changes. The parent makes authorized edits.
- The helper pins OpenRouter, model, effort and retry settings for each run.
  It sends supported effort values unchanged, including `max`.
- A per-run loopback gateway enforces the request cap and checks model
  identity in upstream Responses events. A model mismatch, missing model
  evidence, timeout or failed request causes an error, not a verified answer.
- Only the helper holds the real OpenRouter credential for forwarding. The
  Codex child authenticates to the loopback gateway with a temporary token.
  Do not print the auth hook's output or save credentials in files.
- On timeout the helper aborts its requests and terminates its own child
  process tree. It does not cancel unrelated Codex jobs.
- Request the network and isolated-home write permissions needed for the
  helper. Do not request write access to the parent Codex home or change its
  environment or provider. The child's model requests can access files it
  is allowed to read, so supply a narrowly scoped task directory.

The old persistent proxy on port 43128 is not part of this version. A local
test with Codex CLI 0.155.1 confirmed native `max` transmission. Offline tests
exercise the wrapper and gateway; they do not prove current provider behavior.
