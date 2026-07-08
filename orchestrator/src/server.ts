import express, { type Response } from "express";
import { buildAgentContextPreview } from "./agent-context.js";
import {
  appendLog,
  createIncidentRecord,
  findActiveIncidentByFingerprint,
  fingerprintEvent,
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

// Idempotent entry point for every incident trigger. If an identical error is
// already being worked (same fingerprint, not yet finished), we attach the
// caller to that in-flight run instead of spinning up another agent. This is
// what makes "click the button ten times" fire exactly one cloud agent.
function acceptIncident(event: IncidentEvent, res: Response): void {
  const fingerprint = fingerprintEvent(event);
  const active = findActiveIncidentByFingerprint(fingerprint);

  if (active) {
    appendLog(
      active.id,
      "info",
      `Duplicate trigger ${event.id} collapsed into in-flight incident ${active.id} — no new agent started (idempotent).`,
    );
    console.log(
      `\n♻️  Duplicate trigger for "${event.title}" collapsed into ${active.id} — no new cloud agent started.`,
    );
    res.status(202).json({
      accepted: true,
      deduped: true,
      incident: active.id,
      plan: active.plan,
      dryRun: active.dryRun,
      agentContext: active.agentContext,
      statusUrl: `/api/incidents/${active.id}`,
    });
    return;
  }

  const plan = triage(event);
  const agentContext = buildAgentContextPreview(plan);
  createIncidentRecord(event, plan, DRY_RUN, agentContext);

  res.status(202).json({
    accepted: true,
    deduped: false,
    incident: event.id,
    plan,
    dryRun: DRY_RUN,
    agentContext,
    statusUrl: `/api/incidents/${event.id}`,
  });

  void runRemediation(event);
}

async function runRemediation(event: IncidentEvent): Promise<void> {
  const plan = triage(event);
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

app.post("/webhooks/incident", async (req, res) => {
  const event = req.body as IncidentEvent;
  if (!event?.id || !event?.implicatedServices) {
    return res.status(400).json({ error: "malformed_incident" });
  }

  acceptIncident(event, res);
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

  acceptIncident(event, res);
});

app.listen(PORT, () => {
  console.log(`[orchestrator] listening on http://localhost:${PORT}  (DRY_RUN=${DRY_RUN})`);
  console.log(`  POST /webhooks/incident`);
  console.log(`  POST /api/trigger-from-error`);
  console.log(`  GET  /api/incidents/:id`);
});
