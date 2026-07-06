import type { RemediationPlan } from "./triage.js";

const REPO_URL = process.env.GITHUB_REPO_URL ?? "https://github.com/YOUR_USER/cursor-incident-agent";

export interface AgentContextPreview {
  runtime: "cloud";
  repository: { url: string; startingRef: string };
  model: string;
  autoCreatePR: boolean;
  requiresHumanApproval: boolean;
  autoLoadedSkills: Array<{ name: string; path: string; summary: string }>;
  policyHooks: Array<{ name: string; path: string; purpose: string }>;
  constraints: string[];
}

export function buildAgentContextPreview(plan: RemediationPlan): AgentContextPreview {
  return {
    runtime: "cloud",
    repository: { url: REPO_URL, startingRef: "main" },
    model: plan.model,
    autoCreatePR: plan.autoOpenPR,
    requiresHumanApproval: plan.requiresHumanApproval,
    autoLoadedSkills: [
      {
        name: "incident-triage",
        path: ".cursor/skills/incident-triage/SKILL.md",
        summary:
          "Reproduce-first, test-first remediation procedure. Enforces minimal diff and scoped changes.",
      },
    ],
    policyHooks: [
      {
        name: "guard-paths",
        path: ".cursor/hooks/guard-paths.mjs",
        purpose: "Blocks edits to secrets, .env*, CI config, and infrastructure files.",
      },
    ],
    constraints: [
      "Scope changes to the implicated service and its tests only.",
      "Do not touch secrets, environment files, CI config, or infrastructure.",
      plan.requiresHumanApproval
        ? "Open PR as DRAFT — human must approve before merge."
        : "Open a normal PR when the fix is verified.",
    ],
  };
}
