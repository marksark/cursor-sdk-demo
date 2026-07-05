# AGENTS.md

Context and working agreement for any coding agent (Cursor, etc.) working in this
repo. Read this fully before editing.

## What this is
An autonomous incident-remediation pipeline built on the **Cursor SDK**
(`@cursor/sdk`, v1.0.22). It is a **prototype for a Cursor Field Engineer
interview** — a live ~20-minute demo plus Q&A. Optimize for a clear, opinionated
demo and a credible enterprise story, **not** for production completeness.

## ⚠️ Critical constraints — do not violate
1. **Do NOT fix the planted bug.** `demo-app/src/services/pricing.ts` reads
   `item.discount.rate` unguarded, and `demo-app/src/data/invoices.ts`
   intentionally contains a line item with no discount (schema drift). That HTTP
   500 **is the demo** — the Cursor cloud agent fixes it live. Never add a guard,
   normalize the data, or "clean this up" unless explicitly told to.
2. **Keep the triage fork intact.** In `orchestrator/src/triage.ts`, the
   single-service vs. fan-out-with-human-gate branch is the centerpiece that
   answers "why not a no-code Automation?" Do not collapse, simplify, or refactor
   it away.
3. **Verify SDK-facing code against live docs.** The `.cursor/hooks.json` schema
   and the `run.stream()` event shape are beta. Confirm field names against
   cursor.com/docs/sdk before depending on them. The `as any` seams in
   `remediate.ts` are deliberate placeholders at those boundaries.
4. **Never commit `.env`** or any key. `.env.example` is the template.
5. Keep `npx tsc --noEmit` **clean** — the bug is runtime-only by design.

## Architecture (control plane vs. target repo)
- `demo-app/` — Express + TypeScript billing API. This is the **target repo** the
  cloud agent clones and fixes. Root cause lives at `pricing.ts:20`.
- `incident-source/` — stands in for Sentry/Datadog. Reproduces the 500 and POSTs
  a Sentry-shaped event. Replaceable by a real Sentry MCP with no downstream change.
- `orchestrator/` — the **SDK service / control plane**:
  - `triage.ts` — turns an incident into a plan (**the fork**).
  - `prompt.ts` — builds the *what*; the *how* lives in the skill.
  - `remediate.ts` — `Agent.create({ cloud, model, autoCreatePR })` → run → PR.
- `.cursor/` — the Cursor harness:
  - `skills/incident-triage/SKILL.md` — the remediation procedure (auto-loaded).
  - `hooks.json` + `hooks/guard-paths.mjs` — policy-as-code guardrails.
  - `mcp.json.example` — Sentry/Slack wiring.

## How to run
```bash
npm install
cp .env.example .env
npm run app            # buggy billing API on :3001
npm run orchestrator   # SDK pipeline on :3000 (DRY_RUN=true by default)
npm run incident       # real 500  -> single-service auto-PR plan
npm run incident:multi # cross-service + PCI -> fan-out + human merge gate
```
DRY_RUN prints the plan and the exact agent prompt, spends no credits. Set
`DRY_RUN=false` + `CURSOR_API_KEY` + `GITHUB_REPO_URL` for a live cloud run that
opens a real PR.

## Conventions
- ESM + NodeNext, Node ≥ 22.13, run via `tsx` (no build step). Strict TypeScript,
  two-space indent.
- The SKILL carries procedure; keep agent prompts short and about scope, not steps.

## How we got here (so you don't reverse decisions)
- Chose incident/vulnerability remediation over an onboarding-helper idea — the
  interview prompt explicitly disfavors onboarding helpers and basic integrations.
- Grounded every SDK call on the real API (cloud runtime, PRs, skills, hooks).
- Made the bug a **schema-drift runtime error** so it compiles clean but throws in
  prod — realistic, and it keeps the typecheck green.
- Added **DRY_RUN** so the walkthrough is deterministic and the live run is opt-in.
- Built the **compliance-aware fan-out fork** specifically so the "why not an
  Automation?" objection answers itself on screen.
- Verified: typecheck clean; INV-1001 → 200; INV-1002 → 500; both triage paths fire.

## What to do next (prioritized)
1. **Do one live run.** Push to GitHub, set env, `DRY_RUN=false`, fire an incident,
   confirm a real PR opens. Save the PR URL for the demo.
2. **Verify** `.cursor/hooks.json` schema and stream-event names against live docs;
   remove the `as any` seams once confirmed.
3. **Add a test suite** to `demo-app` (even one test) so the agent's "failing test
   first" step has a home and a CI signal to satisfy.
4. **Wire a real Sentry MCP** in `.cursor/mcp.json` to replace the simulated
   trigger — a strong live-extension moment.
5. **Time-box `DEMO-SCRIPT.md`** to a strict 20 minutes after a dry run; trim the
   architecture section if it runs long.
6. Optional depth: incident-fingerprint memory (agents are stateless by default),
   and real multi-repo fan-out (cloud v1 is one repo per agent request).

## Docs
- `DEMO-SCRIPT.md` — present from this (minute-by-minute run-of-show).
- `TALKING-POINTS.md` — Q&A: the product ladder, objection answers, limitations.
- `README.md` — setup and architecture reference.

## Cursor Cloud specific instructions
- Dependencies refresh via the startup update script (`npm install`). Node ≥ 22.13
  is already present on the VM.
- No database, cache, or other external service is needed — all three processes
  are self-contained Node/tsx servers. There are no `lint` or `test` npm scripts;
  the "clean build" gate is `npx tsc --noEmit` (see constraint #5).
- Run commands are in the `## How to run` section above. `npm run app` (:3001) must
  be started **before** `npm run incident`, because `incident-source` hits the real
  `INV-1002` endpoint to capture the live 500. `npm run incident:multi` fabricates
  its event and does not need the app.
- The pipeline runs fully in `DRY_RUN=true` (the `.env.example` default) with no
  secrets and no credits — the orchestrator prints the plan + exact agent prompt.
  Only the opt-in live run needs `CURSOR_API_KEY` + `GITHUB_REPO_URL` + `DRY_RUN=false`.
