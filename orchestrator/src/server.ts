import express from "express";
import { triage, type IncidentEvent } from "./triage.js";
import { remediate } from "./remediate.js";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 3000);
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, dryRun: DRY_RUN }));

app.post("/webhooks/incident", async (req, res) => {
  const event = req.body as IncidentEvent;
  if (!event?.id || !event?.implicatedServices) {
    return res.status(400).json({ error: "malformed_incident" });
  }

  const plan = triage(event);
  console.log(`\n📋 Plan for ${event.id}: ${plan.strategy.toUpperCase()}`);
  console.log(`   ${plan.reason}`);
  console.log(`   model=${plan.model}  autoOpenPR=${plan.autoOpenPR}  humanApproval=${plan.requiresHumanApproval}`);

  // Respond immediately (async, multi-step): remediation runs in the background,
  // exactly like a real on-call pipeline that acks the alert then works.
  res.status(202).json({ accepted: true, incident: event.id, plan });

  try {
    const results = await remediate(event, plan);
    const prs = results.filter((r) => r.prUrl).map((r) => r.prUrl);
    console.log(
      `\n✅ Remediation finished for ${event.id}. ` +
        (prs.length ? `PRs: ${prs.join(", ")}` : `(dry run — no PRs opened)`),
    );
    if (plan.requiresHumanApproval) {
      console.log(`⏸  Held at merge gate — a human must approve before merge.`);
    }
  } catch (err: any) {
    console.error(`Remediation failed for ${event.id}:`, err?.message ?? err);
  }
});

app.listen(PORT, () => {
  console.log(`[orchestrator] listening on http://localhost:${PORT}  (DRY_RUN=${DRY_RUN})`);
  console.log(`  POST /webhooks/incident`);
});
