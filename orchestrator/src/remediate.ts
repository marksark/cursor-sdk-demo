import { buildRemediationPrompt } from "./prompt.js";
import type { IncidentEvent, RemediationPlan } from "./triage.js";
import {
  appendLog,
  appendServiceEvent,
  getIncident,
  markCompleted,
  markRemediating,
  upsertServiceRemediation,
} from "./incident-store.js";

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const REPO_URL = process.env.GITHUB_REPO_URL ?? "https://github.com/YOUR_USER/cursor-incident-agent";
const CURSOR_API_KEY = process.env.CURSOR_API_KEY;

export interface RemediationResult {
  service: string;
  status: "dry-run" | "started" | "completed" | "error";
  prompt: string;
  runId?: string;
  prUrl?: string;
  error?: string;
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

// Runs one cloud agent per service in the plan (fan-out) or a single agent.
export async function remediate(
  event: IncidentEvent,
  plan: RemediationPlan,
): Promise<RemediationResult[]> {
  const results: RemediationResult[] = [];
  const incidentId = event.id;
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

      results.push({ service, status: "dry-run", prompt });
      upsertServiceRemediation(incidentId, {
        service,
        status: "dry-run",
        prompt,
        events: [
          { ts: new Date().toISOString(), type: "dry-run", message: "Prompt generated — cloud agent not invoked" },
          { ts: new Date().toISOString(), type: "prompt", message: prompt },
        ],
      });
      continue;
    }

    try {
      appendLog(incidentId, "info", `[${service}] Starting cloud agent (model=${plan.model})`);
      appendServiceEvent(incidentId, service, "started", `Cloud agent starting with model ${plan.model}`);

      const { Agent } = await import("@cursor/sdk");

      const agent = await Agent.create({
        apiKey: CURSOR_API_KEY,
        model: { id: plan.model },
        cloud: {
          repos: [{ url: REPO_URL, startingRef: "main" }],
          autoCreatePR: plan.autoOpenPR,
        },
      });

      logAgentContext(service, plan);
      console.log(`\n── Prompt sent to Cursor agent ──\n`);
      console.log(prompt);
      console.log(`\n── End prompt ──\n`);

      const run = await agent.send(prompt);
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

      for await (const streamEvent of run.stream()) {
        const kind = (streamEvent as { type?: string })?.type ?? "event";
        const detail = JSON.stringify(streamEvent).slice(0, 200);
        console.log(`[${service}] stream: ${kind}`);
        appendServiceEvent(incidentId, service, kind, detail);
      }

      const finished = await (
        await Agent.getRun(run.id, { runtime: "cloud", agentId: run.agentId })
      ).wait();

      const prUrl = (finished as { git?: { branches?: Array<{ prUrl?: string }> } })?.git?.branches?.[0]?.prUrl;
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
      upsertServiceRemediation(incidentId, {
        service,
        status: "error",
        prompt,
        error: message,
        events: [{ ts: new Date().toISOString(), type: "error", message }],
      });
    }
  }

  const hadError = results.some((r) => r.status === "error");
  markCompleted(incidentId, hadError);
  return results;
}
