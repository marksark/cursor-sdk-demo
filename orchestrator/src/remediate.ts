import { createHash } from "node:crypto";
import { buildRemediationPrompt } from "./prompt.js";
import type { IncidentEvent, RemediationPlan } from "./triage.js";
import {
  appendLog,
  appendServiceEvent,
  fingerprintEvent,
  getIncident,
  markCompleted,
  markRemediating,
  upsertServiceRemediation,
} from "./incident-store.js";

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const REPO_URL = process.env.GITHUB_REPO_URL ?? "https://github.com/YOUR_USER/cursor-incident-agent";
const CURSOR_API_KEY = process.env.CURSOR_API_KEY;
// Rehearsal aid: replay a scripted agent stream in DRY_RUN so the UI drawer can
// be exercised (stays open, updates live) without spending credits. Off by default.
const SIMULATE_STREAM = (process.env.SIMULATE_STREAM ?? "false").toLowerCase() === "true";
// Pace of the rehearsal stream. Slower reads better on screen during a demo.
const SIMULATE_STREAM_DELAY_MS = Number(process.env.SIMULATE_STREAM_DELAY_MS ?? 900);

export interface RemediationResult {
  service: string;
  status: "dry-run" | "started" | "completed" | "error";
  prompt: string;
  runId?: string;
  prUrl?: string;
  error?: string;
}

// Minimal structural view of a stream event. The SDK's `SDKMessage` union is a
// beta surface (see AGENTS.md #3), so we read it defensively instead of coupling
// the typecheck to the optional `@cursor/sdk` types.
interface StreamEventLike {
  type?: string;
  subtype?: string;
  status?: string;
  name?: string;
  text?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
}

function clip(text: string, max = 180): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Turns a raw stream event into a short, human-readable line for the UI drawer.
function describeStreamEvent(event: StreamEventLike): { type: string; message: string } {
  const type = event.type ?? "event";
  switch (type) {
    case "assistant": {
      const text = (event.message?.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join(" ")
        .trim();
      return { type, message: text ? clip(text) : "(assistant message)" };
    }
    case "thinking":
      return { type, message: event.text ? clip(event.text) : "(thinking)" };
    case "tool_call":
      return { type, message: `${event.name ?? "tool"} — ${event.status ?? "running"}` };
    case "status":
      return { type, message: event.status ?? "(status)" };
    case "task":
      return { type, message: event.text ?? event.status ?? "(task)" };
    case "usage":
      return { type, message: "token usage reported" };
    case "system":
      return { type, message: event.subtype === "init" ? "session initialized" : "(system)" };
    case "user":
      return { type, message: "prompt delivered to agent" };
    default:
      // Unknown/new event type — surface it rather than dropping it.
      return { type, message: clip(JSON.stringify(event)) };
  }
}

// A stable per-service key derived from the incident fingerprint. Handed to the
// SDK so a duplicate create/send collapses to one cloud agent server-side — the
// second, defense-in-depth layer behind the orchestrator's own dedup.
function idempotencyKeyFor(fingerprint: string, service: string): string {
  return createHash("sha256").update(`${fingerprint}::${service}`).digest("hex").slice(0, 32);
}

function logDryRunBanner(service: string, plan: RemediationPlan): void {
  console.log(`\n── DRY RUN · ${service} · model=${plan.model} · autoPR=${plan.autoOpenPR} ──`);
}

function logAgentContext(service: string, plan: RemediationPlan): void {
  console.log(`\n┌─ Agent context · ${service} ─────────────────────────────────`);
  console.log(`│  runtime:     cloud`);
  console.log(`│  repository:  ${REPO_URL} (ref: main)`);
  console.log(`│  model:       ${plan.model}`);
  console.log(`│  autoCreatePR: ${plan.autoOpenPR}`);
  console.log(`│  skill:        incident-triage (.cursor/skills/incident-triage/SKILL.md)`);
  console.log(`│  hooks:        guard-paths (.cursor/hooks/guard-paths.mjs)`);
  console.log(`└──────────────────────────────────────────────────────────────`);
}

const SIMULATED_STREAM: Array<{ type: string; message: string }> = [
  { type: "status", message: "CREATING — provisioning cloud VM and cloning repo" },
  { type: "status", message: "RUNNING — agent loop started" },
  { type: "thinking", message: "Reproducing: GET /api/invoices/INV-1002/summary returns 500" },
  { type: "tool_call", message: "read pricing.ts — running" },
  { type: "assistant", message: "Root cause: pricing.ts reads item.discount.rate unguarded; a line item has no discount (schema drift)." },
  { type: "tool_call", message: "write pricing.test.ts — failing test first" },
  { type: "tool_call", message: "edit pricing.ts — minimal guard for the missing discount" },
  { type: "assistant", message: "Regression test passes; change scoped to the service and its tests." },
  { type: "status", message: "FINISHED — pushing branch and opening PR" },
];

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Replays SIMULATED_STREAM over a few seconds so the drawer updates live during
// a dry run. Emits events only — it never claims a cloud agent ran or a PR opened.
async function replaySimulatedStream(incidentId: string, service: string): Promise<void> {
  for (const event of SIMULATED_STREAM) {
    await delay(SIMULATE_STREAM_DELAY_MS);
    console.log(`[${service}] sim-stream: ${event.type}`);
    appendServiceEvent(incidentId, service, event.type, event.message);
  }
}

// Runs one cloud agent per service in the plan (fan-out) or a single agent.
export async function remediate(
  event: IncidentEvent,
  plan: RemediationPlan,
): Promise<RemediationResult[]> {
  const results: RemediationResult[] = [];
  const incidentId = event.id;
  const fingerprint = getIncident(incidentId)?.fingerprint ?? fingerprintEvent(event);
  markRemediating(incidentId);

  for (const service of plan.services) {
    const prompt = buildRemediationPrompt(event, plan, service);

    upsertServiceRemediation(incidentId, {
      service,
      status: "dry-run",
      prompt,
      events: [],
    });

    if (DRY_RUN || !CURSOR_API_KEY) {
      logDryRunBanner(service, plan);
      logAgentContext(service, plan);
      console.log(`\n── Prompt sent to Cursor agent ──\n`);
      console.log(prompt);
      console.log(`\n── End prompt ──\n`);

      appendLog(
        incidentId,
        "info",
        `[${service}] DRY RUN — prompt built, no cloud agent started (DRY_RUN=${DRY_RUN}, hasApiKey=${!!CURSOR_API_KEY})`,
      );
      appendServiceEvent(incidentId, service, "dry-run", "Prompt generated — cloud agent not invoked");
      appendServiceEvent(incidentId, service, "prompt", prompt);

      if (SIMULATE_STREAM) {
        appendLog(
          incidentId,
          "info",
          `[${service}] SIMULATE_STREAM=true — replaying a scripted agent stream (no credits, no cloud agent)`,
        );
        await replaySimulatedStream(incidentId, service);
      }

      results.push({ service, status: "dry-run", prompt });
      upsertServiceRemediation(incidentId, {
        service,
        status: "dry-run",
        prompt,
        events: getIncident(incidentId)?.remediations.find((r) => r.service === service)?.events ?? [],
      });
      continue;
    }

    try {
      appendLog(incidentId, "info", `[${service}] Starting cloud agent (model=${plan.model})`);
      appendServiceEvent(incidentId, service, "started", `Cloud agent starting with model ${plan.model}`);

      // Dynamic import: `@cursor/sdk` is an optionalDependency loaded only on a
      // live run, so DRY_RUN works without the (heavy, native) package present.
      const { Agent } = await import("@cursor/sdk");

      const idempotencyKey = idempotencyKeyFor(fingerprint, service);
      const agent = await Agent.create({
        apiKey: CURSOR_API_KEY,
        model: { id: plan.model },
        idempotencyKey,
        cloud: {
          repos: [{ url: REPO_URL, startingRef: "main" }],
          autoCreatePR: plan.autoOpenPR,
        },
      });

      logAgentContext(service, plan);
      console.log(`\n── Prompt sent to Cursor agent ──\n`);
      console.log(prompt);
      console.log(`\n── End prompt ──\n`);

      const run = await agent.send(prompt, { idempotencyKey });
      console.log(`[${service}] cloud run started: ${run.id}`);
      appendLog(incidentId, "info", `[${service}] Cloud run started: ${run.id}`);
      appendServiceEvent(incidentId, service, "run-started", `Run ID: ${run.id}`);

      upsertServiceRemediation(incidentId, {
        service,
        status: "started",
        prompt,
        runId: run.id,
        events: getIncident(incidentId)?.remediations.find((r) => r.service === service)?.events ?? [],
      });

      // Stream live progress into the incident record so the UI drawer updates
      // as the agent works. Guard first: a re-fetched/finished run may not
      // support streaming, in which case we just wait for the terminal result.
      if (run.supports("stream")) {
        for await (const streamEvent of run.stream()) {
          const described = describeStreamEvent(streamEvent as unknown as StreamEventLike);
          console.log(`[${service}] stream: ${described.type}`);
          appendServiceEvent(incidentId, service, described.type, described.message);
        }
      } else {
        const reason = run.unsupportedReason("stream") ?? "streaming not supported on this run";
        appendServiceEvent(incidentId, service, "info", `Live stream unavailable (${reason}); waiting for result`);
      }

      const finished = await run.wait();

      const prUrl = finished.git?.branches?.[0]?.prUrl;
      console.log(`[${service}] done. PR: ${prUrl ?? "(branch pushed, no PR)"}`);
      appendLog(
        incidentId,
        "info",
        `[${service}] Completed${prUrl ? ` — PR: ${prUrl}` : " — branch pushed, no PR"}`,
      );
      appendServiceEvent(
        incidentId,
        service,
        "completed",
        prUrl ? `PR opened: ${prUrl}` : "Run finished — branch pushed, no PR",
      );

      results.push({ service, status: "completed", prompt, runId: run.id, prUrl });
      const existing = getIncident(incidentId)?.remediations.find((r) => r.service === service);
      upsertServiceRemediation(incidentId, {
        service,
        status: "completed",
        prompt,
        runId: run.id,
        prUrl,
        events: existing?.events ?? [],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${service}] remediation error:`, message);
      appendLog(incidentId, "error", `[${service}] Remediation error: ${message}`);
      appendServiceEvent(incidentId, service, "error", message);
      results.push({ service, status: "error", prompt, error: message });
      const existing = getIncident(incidentId)?.remediations.find((r) => r.service === service);
      upsertServiceRemediation(incidentId, {
        service,
        status: "error",
        prompt,
        error: message,
        events: existing?.events ?? [],
      });
    }
  }

  const hadError = results.some((r) => r.status === "error");
  markCompleted(incidentId, hadError);
  return results;
}
