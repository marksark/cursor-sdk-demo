import express from "express";
import { buildAgentContextPreview } from "./agent-context.js";
import { computeIncidentFingerprint } from "./incident-fingerprint.js";
import {
  appendLog,
  createIncidentRecord,
  findIncidentByFingerprint,
  getIncident,
  listIncidents,
  markTriaged,
} from "./incident-store.js";
import { remediate } from "./remediate.js";
import { triage, type IncidentEvent } from "./triage.js";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 3000);
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.options("*", (_req, res) => res.sendStatus(204));

app.get("/healthz", (_req, res) =>
  res.json({ ok: true, dryRun: DRY_RUN, hasApiKey: !!process.env.CURSOR_API_KEY }),
);

app.get("/api/incidents", (_req, res) => {
  res.json({ incidents: listIncidents() });
});

app.get("/api/incidents/:id", (req, res) => {
  const record = getIncident(req.params.id);
  if (!record) return res.status(404).json({ error: "incident_not_found" });
  res.json(record);
});

async function runRemediation(event: IncidentEvent, plan: ReturnType<typeof triage>): Promise<void> {
  markTriaged(event.id);

  appendLog(
    event.id,
    "triaged",
    `Plan: ${plan.strategy} — ${plan.reason} (model=${plan.model}, autoPR=${plan.autoOpenPR}, humanGate=${plan.requiresHumanApproval})`,
  );

  console.log(`\n📋 Plan for ${event.id}: ${plan.strategy.toUpperCase()}`);
  console.log(`   ${plan.reason}`);
  console.log(`   model=${plan.model}  autoOpenPR=${plan.autoOpenPR}  humanApproval=${plan.requiresHumanApproval}`);

  try {
    const results = await remediate(event, plan);
    const prs = results.filter((r) => r.prUrl).map((r) => r.prUrl);
    const dryRuns = results.filter((r) => r.status === "dry-run").length;
    const started = results.filter((r) => r.status === "started" || r.status === "completed").length;

    if (dryRuns > 0 && started === 0) {
      console.log(`\n✅ Remediation finished for ${event.id}. (dry run — no cloud agents started)`);
      appendLog(event.id, "completed", "Dry run complete — prompts logged, no cloud agents started");
    } else if (prs.length) {
      console.log(`\n✅ Remediation finished for ${event.id}. PRs: ${prs.join(", ")}`);
      appendLog(event.id, "completed", `Cloud agents completed. PRs: ${prs.join(", ")}`);
    } else if (started > 0) {
      console.log(`\n✅ Remediation finished for ${event.id}. Cloud agent(s) kicked off.`);
      appendLog(event.id, "completed", "Cloud agent run(s) completed");
    } else {
      console.log(`\n✅ Remediation finished for ${event.id}.`);
      appendLog(event.id, "completed", "Remediation finished");
    }

    if (plan.requiresHumanApproval) {
      console.log(`⏸  Held at merge gate — a human must approve before merge.`);
      appendLog(event.id, "info", "Held at merge gate — human approval required before merge");
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Remediation failed for ${event.id}:`, message);
    appendLog(event.id, "error", `Remediation failed: ${message}`);
  }
}

interface IngestedIncident {
  duplicate: boolean;
  incident: string;
  plan: ReturnType<typeof triage>;
  agentContext: ReturnType<typeof buildAgentContextPreview>;
}

function ingestIncident(event: IncidentEvent): IngestedIncident {
  const fingerprint = computeIncidentFingerprint(event);
  const existing = findIncidentByFingerprint(fingerprint);
  if (existing) {
    console.log(
      `[orchestrator] Duplicate incident for fingerprint ${fingerprint} — reusing ${existing.id} (status=${existing.status})`,
    );
    return {
      duplicate: true,
      incident: existing.id,
      plan: existing.plan,
      agentContext: existing.agentContext,
    };
  }

  const plan = triage(event);
  const agentContext = buildAgentContextPreview(plan);
  createIncidentRecord(event, plan, DRY_RUN, agentContext, fingerprint);

  return { duplicate: false, incident: event.id, plan, agentContext };
}

app.post("/webhooks/incident", async (req, res) => {
  const event = req.body as IncidentEvent;
  if (!event?.id || !event?.implicatedServices) {
    return res.status(400).json({ error: "malformed_incident" });
  }

  const ingested = ingestIncident(event);

  res.status(202).json({
    accepted: true,
    duplicate: ingested.duplicate,
    incident: ingested.incident,
    plan: ingested.plan,
    dryRun: DRY_RUN,
    agentContext: ingested.agentContext,
    statusUrl: `/api/incidents/${ingested.incident}`,
    ...(ingested.duplicate && {
      message: "Remediation already triggered for this error — reusing existing incident.",
    }),
  });

  if (!ingested.duplicate) {
    void runRemediation(event, ingested.plan);
  }
});

// Convenience endpoint for the demo UI: build an incident from a 500 response body.
app.post("/api/trigger-from-error", async (req, res) => {
  const body = req.body as {
    error?: string;
    message?: string;
    culprit?: string;
    stack?: string;
    service?: string;
  };

  if (!body?.message || !body?.stack) {
    return res.status(400).json({ error: "missing_error_fields" });
  }

  const event: IncidentEvent = {
    id: `evt_${Date.now()}`,
    level: "error",
    title: `${body.error ?? "Error"}: ${body.message}`,
    culprit: body.culprit ?? "unknown",
    message: body.message,
    stack: body.stack,
    tags: { service: body.service ?? "billing-api", environment: "production" },
    implicatedServices: [body.service ?? "billing-api"],
  };

  const ingested = ingestIncident(event);

  res.status(202).json({
    accepted: true,
    duplicate: ingested.duplicate,
    incident: ingested.incident,
    plan: ingested.plan,
    dryRun: DRY_RUN,
    agentContext: ingested.agentContext,
    statusUrl: `/api/incidents/${ingested.incident}`,
    ...(ingested.duplicate && {
      message: "Remediation already triggered for this error — reusing existing incident.",
    }),
  });

  if (!ingested.duplicate) {
    void runRemediation(event, ingested.plan);
  }
});

app.listen(PORT, () => {
  console.log(`[orchestrator] listening on http://localhost:${PORT}  (DRY_RUN=${DRY_RUN})`);
  console.log(`  POST /webhooks/incident`);
  console.log(`  POST /api/trigger-from-error`);
  console.log(`  GET  /api/incidents/:id`);
});
