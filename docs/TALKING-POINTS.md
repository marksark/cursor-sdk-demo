# Talking points — 20-min demo + Q&A

## 1. The problem, in one breath
Every engineer now ships more code with AI, but review, monitoring, and incident
response didn't speed up to match. The expensive, after-hours part of the SDLC is
the triage-to-fix loop. I built a pipeline where a production error triggers a
cloud agent that reproduces it, writes a failing test, fixes it in a scoped diff,
and opens a PR — with a human still at the merge gate. On the Cursor SDK, because
the hard parts (sandboxing, indexing, durable runs) are the harness, not my code.

## 2. Architecture in one breath
Three parts: an incident source (stands in for Sentry), the demo billing API with
a realistic bug, and the orchestrator — the SDK service that triages the incident
into a plan and launches cloud agent(s) that open PRs. The orchestrator is the
control plane; the billing repo is the target the agent clones and fixes.

## 3. Three design decisions and their trade-offs
- **Cloud runtime, not local.** Cloud agents get a dedicated sandboxed VM, survive
  my laptop sleeping, and can open a PR directly. Trade-off: latency and I don't
  control the box — so I added a DRY_RUN mode to make the walkthrough deterministic
  and reserve one live run for the finale.
- **A Skill carries the "how", the prompt carries the "what".** The remediation
  procedure lives in `.cursor/skills/`, so prompts stay short and every run follows
  the same enterprise discipline. Trade-off: another artifact to maintain, but it's
  version-controlled with the code it governs.
- **Guardrails as hooks, not as prompt politeness.** A `preToolUse` hook blocks
  edits to secrets/CI/infra regardless of what the agent decides. Trade-off: hooks
  are beta and the schema may shift — I verify against the docs and treat the
  orchestrator as a second enforcement layer.

## 4. The mental model to hand them — one runtime, a product ladder
This is the frame that answers most "why not X" questions at once. Cursor exposes
the *same cloud-agent runtime* at three levels of control:

- **Bugbot** — the packaged product. One job: review PRs, catch real bugs, autofix.
  Zero config. You buy it.
- **Automations** — no-code, config-driven. One event (Slack, Linear, GitHub PR,
  PagerDuty, cron, webhook) → one agent task. Great for single-step workflows.
- **SDK** — code. Orchestration, multi-agent fan-out, chaining, custom state, and
  embedding an agent inside your own product or backend.

Each rung trades convenience for control. **The Field Engineer's job is placing the
customer on the right rung** — and knowing when *not* to reach for the SDK is what
makes the recommendation credible.

## 5. Objection answers
**"Why not just Bugbot?"** If the need is *review PRs + autofix bugs*, I'd sell them
Bugbot — and note Bugbot's autofix already runs on this same cloud runtime. The SDK
is for the workflows Cursor hasn't packaged: a different trigger (an incident, not a
PR), a different shape (fan-out, chaining), or a different home (inside your product).

**"Why not just an Automation? The trigger can be a webhook."** Correct — and for a
single-step flow, use the Automation; the SDK adds nothing there. The SDK earns its
place the moment "everything else" becomes a *program*. Point at `triage.ts`: the
`if` that ships a contained fix on a cheap model but fans out per-service on a
stronger model and holds at the merge gate when the blast radius crosses a compliance
boundary — that branch is control flow a config form can't hold. A form vs. a program.

**"Why not a simple script when the pipeline breaks?"** A script detects that the
build went red; it can't reason about *why*, traverse the codebase, write a verified
fix, or open a reviewable PR. Detection without cognition. The harness supplies the
cognition.

## 6. Why the SDK over a raw model API
The harness is the product: codebase indexing, semantic search, sandboxing, durable
runs, hooks, subagents, and model routing — none of which I want to build or
re-tune every time a new model ships. Independent benchmarks make the point: the
same frontier model scores far higher inside Cursor's harness than called natively.

## 7. Honest limitations + how I'd evolve it
- **Beta surface.** Tool-call/stream-event and `hooks.json` schemas can shift; I'd
  pin versions and add contract tests around the SDK boundary.
- **One repo per cloud request (v1).** My "fan-out across services" models modules
  today; real multi-repo fan-out is a per-repo agent orchestrated by the same code.
- **Stateless agents.** No cross-run memory by default. I'd add a store keyed by
  incident fingerprint so recurring incidents get faster, more confident fixes.
- **Trust ramp.** Start read-only (triage + comment), earn autofix on low-risk
  services, expand scope as resolution rate proves out — the same path teams took
  with Bugbot.

## 8. Pre-canned "extend it live" moves (pick the smallest that fits the ask)
- *"Post the result to Slack"* → add the Slack server in `.cursor/mcp.json`, tell
  the agent to post its PR summary. (One file.)
- *"Never let it touch auth code"* → add a pattern to `guard-paths.mjs`. (One line.)
- *"Route trivial fixes cheaper"* → already in `triage.ts`; extend the heuristic.
- *"Fan this across more services"* → add to `implicatedServices`; the loop already
  handles N.
- *"Require two approvals on PCI"* → extend the plan with an approval count the
  orchestrator enforces before it un-drafts the PR.
