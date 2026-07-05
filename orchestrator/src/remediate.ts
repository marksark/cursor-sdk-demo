import { buildRemediationPrompt } from "./prompt.js";
import type { IncidentEvent, RemediationPlan } from "./triage.js";

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

// Runs one cloud agent per service in the plan (fan-out) or a single agent.
export async function remediate(
  event: IncidentEvent,
  plan: RemediationPlan,
): Promise<RemediationResult[]> {
  const results: RemediationResult[] = [];

  for (const service of plan.services) {
    const prompt = buildRemediationPrompt(event, plan, service);

    if (DRY_RUN || !CURSOR_API_KEY) {
      // Deterministic demo path: show exactly what WOULD run. Zero credits, no
      // network flakiness. Great for the walkthrough; flip DRY_RUN=false for the
      // one live "money shot" run.
      console.log(`\n── DRY RUN · ${service} · model=${plan.model} · autoPR=${plan.autoOpenPR} ──`);
      console.log(prompt);
      results.push({ service, status: "dry-run", prompt });
      continue;
    }

    try {
      // Lazy import so DRY_RUN works even before `npm i @cursor/sdk`.
      const { Agent } = await import("@cursor/sdk");

      const agent = await Agent.create({
        apiKey: CURSOR_API_KEY,
        model: { id: plan.model },
        cloud: {
          repos: [{ url: REPO_URL, startingRef: "main" }],
          autoCreatePR: plan.autoOpenPR,
        },
      });

      const run = await agent.send(prompt);
      console.log(`[${service}] cloud run started: ${run.id}`);

      // Stream progress so the demo shows the agent working live.
      for await (const streamEvent of run.stream()) {
        const kind = (streamEvent as any)?.type ?? "event";
        console.log(`[${service}] ${kind}`);
      }

      const finished = await (
        await Agent.getRun(run.id, { runtime: "cloud", agentId: run.agentId })
      ).wait();

      const prUrl = (finished as any)?.git?.branches?.[0]?.prUrl;
      console.log(`[${service}] done. PR: ${prUrl ?? "(branch pushed, no PR)"}`);
      results.push({ service, status: "completed", prompt, runId: run.id, prUrl });
    } catch (err: any) {
      console.error(`[${service}] remediation error:`, err?.message ?? err);
      results.push({ service, status: "error", prompt, error: err?.message ?? String(err) });
    }
  }

  return results;
}
