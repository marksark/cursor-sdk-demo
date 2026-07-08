# Demo run-of-show (~20 min)

Present from this doc. It covers **what to say**, **what to run**, and **what to
point at** — including how the app works, how the SDK is configured, the skill,
and the guardrails. Use `TALKING-POINTS.md` for the Q&A that follows.

---

## Before you start (setup checklist)
- [ ] Three terminals open in the repo root.
- [ ] `.env` present. For the walkthrough keep `DRY_RUN=true`.
- [ ] For the live finale: repo pushed to your GitHub, `CURSOR_API_KEY` set,
      `GITHUB_REPO_URL` pointed at it, and a browser tab on that repo's PRs.
- [ ] Editor open on `orchestrator/src/triage.ts` (your centerpiece).

---

## 0 · Frame the problem — 60–90 sec (say it, no slides)
"Every engineer now ships more code with AI, but review, monitoring, and incident
response didn't speed up to match. The expensive, after-hours part of the SDLC is
the triage-to-fix loop. I built a pipeline where a production error triggers a
Cursor cloud agent that reproduces it, writes a failing test, fixes it in a scoped
diff, and opens a PR — with a human still at the merge gate."

---

## 1 · Show the incident is real — ~2 min
```bash
npm run app
curl -s localhost:3001/api/invoices/INV-1001/summary   # 200 + totals
curl -s localhost:3001/api/invoices/INV-1002/summary   # 500
```
Say: "INV-1002 has a line item the datastore never gave a discount — but our type
says every line item has one. It **compiles clean and throws in prod**. Schema
drift: the most boring and most common way money math breaks. This 500 is exactly
what Sentry or Datadog would capture and alert on."

**How the app works (point at the files):**
- `demo-app/src/data/invoices.ts` — data loaded from a 'datastore' and cast to the
  type; one row is missing its discount. That's the drift.
- `demo-app/src/services/pricing.ts:20` — reads `item.discount.rate` unguarded →
  the throw. This is the root cause the agent will find.

---

## 2 · Fire the pipeline (DRY_RUN) — ~3 min
```bash
npm run orchestrator     # note the banner: DRY_RUN=true
npm run incident
```
Walk the output as it scrolls:
- "Incident captured" — the incident source reproduced the 500 and shipped a
  **Sentry-shaped event**. (Point: `incident-source/src/simulate.ts` — swap this
  for a real Sentry MCP and nothing downstream changes.)
- "202 accepted" — the orchestrator acks immediately and works **async**, like a
  real on-call pipeline.
- The **plan**: `single-service`, model `composer-2`, `autoOpenPR: true`.
- The printed **prompt** the agent would receive — short, because the *how* lives
  in the skill.

Say: "DRY_RUN prints exactly what would run — deterministic, zero credits. It
de-risks the demo; the live run is one flag away."

---

## 3 · Architecture walkthrough — ~4–5 min (the core of the eval)
Frame it as **control plane vs. target repo**: the orchestrator is my code; the
billing repo is what the agent clones and fixes.

**How the SDK is configured** — open `orchestrator/src/remediate.ts`:
```ts
const agent = await Agent.create({
  apiKey: CURSOR_API_KEY,
  model: { id: plan.model },                 // composer-2 or gpt-5.5, chosen in triage
  cloud: {
    repos: [{ url: REPO_URL, startingRef: "main" }],
    autoCreatePR: plan.autoOpenPR,           // false when a human must approve first
  },
});
const run = await agent.send(prompt, { idempotencyKey });   // dedupe duplicate sends
if (run.supports("stream")) {
  for await (const e of run.stream()) { /* live progress -> UI drawer */ }
}
const done = await run.wait();                               // result lives on the run
const prUrl = done.git?.branches?.[0]?.prUrl;
```
Say: "Cloud runtime, not local — the agent runs in a dedicated sandboxed VM,
survives my laptop sleeping, and opens the PR itself. I stream events so you can
watch it work, then read the PR URL off the result. The `idempotencyKey` is
derived from the incident fingerprint, so a duplicate trigger can't spawn a
second agent."

**The Skill** — open `.cursor/skills/incident-triage/SKILL.md`:
"The agent auto-loads this. It enforces the enterprise procedure: reproduce first,
write a failing test, make the minimal fix, stay scoped to the service, and open a
PR with root cause + risk note + test evidence. The prompt says *what*; the skill
says *how* — and it's version-controlled with the code it governs."

**The guardrails** — open `.cursor/hooks.json` + `.cursor/hooks/guard-paths.mjs`:
"A `preToolUse` hook inspects every edit and **denies** any touch to secrets, CI,
or infra — policy as code, not a polite request in the prompt. The orchestrator
prompt is a second layer. This is the answer to the enterprise safety question."

**Model routing** — open `orchestrator/src/triage.ts`:
"`composer-2` for contained fixes, `gpt-5.5` for cross-service reasoning. One
field, and it's a real cost lever at CI scale."

---

## 4 · The fork — "why not just an Automation?" — ~2 min
```bash
npm run incident:multi
```
Output: `fan-out`, `gpt-5.5`, `autoOpenPR: false`, one draft PR per service, and
"Held at merge gate." Point at the `if` in `triage.ts`:

Say: "A no-code Automation fires one agent per trigger with one fixed config. This
branch — contained fix on a cheap model, but fan out per service on a stronger
model and hold at the merge gate when the blast radius crosses a PCI boundary — is
control flow a config form can't hold. A form versus a program. **That's** when you
reach for the SDK."

---

## 5 · The live money shot — ~3–4 min
```bash
# .env: DRY_RUN=false, CURSOR_API_KEY + GITHUB_REPO_URL set
npm run orchestrator
npm run incident
```
Watch the stream, then open the PR on GitHub. Show the diff (the guard on
`pricing.ts`), the failing-then-passing test, and the PR body.

**If it breaks:** own it, fall back to the DRY_RUN walkthrough, and narrate what
would have happened. They said they're evaluating thinking, not polish — a clean
recovery is a positive signal.

---

## 6 · Limitations + evolution — ~1–2 min → hand into Q&A
Name them yourself (it's one of their five scoring criteria): beta SDK schema,
one repo per cloud request in v1, stateless agents, `hooks.json` schema to verify.
Then how you'd evolve it — read-only trust ramp, incident-fingerprint memory,
real multi-repo fan-out. Full detail in `TALKING-POINTS.md`.

---

## The one-line map of the repo (say if asked "where's what")
- `demo-app/` — the app with the bug (the target repo)
- `incident-source/` — the Sentry stand-in (the trigger)
- `orchestrator/triage.ts` — the plan + **the fork**
- `orchestrator/remediate.ts` — the **SDK config** + cloud run
- `.cursor/skills/…/SKILL.md` — the **how** (procedure)
- `.cursor/hooks*` — the **guardrails** (policy as code)
