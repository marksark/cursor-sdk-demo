# Auto-Remediation Pipeline (Cursor SDK)

A production error triggers a **Cursor cloud agent** that reproduces it, writes a
failing test, fixes it in a scoped diff, and opens a PR — guided by a repo
**Skill** and gated by **hooks**. Built on `@cursor/sdk`.

The enterprise problem: teams ship faster with AI, but code review, monitoring,
and incident response haven't sped up to match. This closes the loop on the
after-code-is-written half of the SDLC — the triage-to-fix-to-PR path — while
keeping a human at the merge gate.

## The three moving parts

```
 incident-source            orchestrator (Cursor SDK)              demo-app
 ───────────────            ─────────────────────────              ────────
 reproduces the 500,   ──▶  POST /webhooks/incident           the B2B billing API
 ships a Sentry-shaped      │                                  with a planted
 event                      ├─ triage()  ── the branch/fork    schema-drift bug
                            │                                  (GET .../INV-1002
 (swap for a real          └─ remediate() ─▶ Cursor cloud       /summary → 500)
  Sentry MCP later)            agent ─▶ opens a PR on GitHub
```

- **demo-app/** — an Express + TypeScript billing API. `INV-1002` has a line item
  the datastore never gave a discount, but the type says every line item has one.
  Compiles clean, throws `TypeError` in prod → HTTP 500. Realistic schema drift.
- **incident-source/** — stands in for Sentry/Datadog. Hits the broken endpoint,
  captures the 500, and POSTs a Sentry-shaped event to the orchestrator.
- **orchestrator/** — the SDK service. Receives the incident, **triages** it into
  a plan, and **remediates** by launching cloud agent(s) that open PRs.

## Setup

Requires Node ≥ 22.13 and a personal Cursor account.

```bash
npm install
cp .env.example .env          # works as-is in DRY_RUN; add your key for a live run
```

## Run the demo (DRY_RUN — no credits, fully deterministic)

Three terminals:

```bash
npm run app            # 1) the buggy billing API on :3001
npm run orchestrator   # 2) the SDK pipeline on :3000 (DRY_RUN=true by default)
npm run incident       # 3) fire a real 500  → single-service auto-PR plan
```

Then show the fork that a no-code Automation can't express:

```bash
npm run incident:multi # cross-service + PCI → fan-out + human merge gate
```

In DRY_RUN the orchestrator prints the exact plan and the exact prompt each cloud
agent would receive. This is your safe walkthrough — flip to live for the finale.

## The live "money shot"

1. Push this repo to your own GitHub.
2. In `.env`: set `CURSOR_API_KEY`, set `GITHUB_REPO_URL` to your repo, set
   `DRY_RUN=false`.
3. `npm run orchestrator`, then `npm run incident`.
4. The cloud agent clones the repo, follows the `incident-triage` skill, fixes
   `pricing.ts`, and opens a PR. Open it on GitHub — that's the finale.

## The Cursor harness pieces (all real, all in `.cursor/`)

- **Skill** — `.cursor/skills/incident-triage/SKILL.md`. The agent auto-loads it
  and follows a reproduce-first, test-first, minimal-diff procedure.
- **Hooks** — `.cursor/hooks.json` + `.cursor/hooks/guard-paths.mjs`. Policy as
  code: the agent is blocked from editing secrets / CI / infra no matter what it
  decides to do.
- **MCP** — `.cursor/mcp.json.example`. Wire Sentry (real trigger) or Slack (post
  the PR summary). Great "extend it live" surface.
- **Model routing** — `triage.ts` picks `composer-2` for contained fixes and
  `gpt-5.5` for cross-service reasoning. One field, big cost lever at CI scale.

## Honest limitations (see TALKING-POINTS.md)

Beta SDK, TS-only, cloud v1 is one repo per agent request, agents are stateless
by default, and the exact `hooks.json` / stream-event schema should be verified
against the live docs before you demo. These are features to speak to, not hide.
