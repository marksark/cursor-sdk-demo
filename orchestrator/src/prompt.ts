import type { IncidentEvent, RemediationPlan } from "./triage.js";

// Builds the remediation prompt for one service. Deliberately terse: the "how"
// lives in .cursor/skills/incident-triage/SKILL.md, which the agent auto-loads.
// This keeps the prompt about the WHAT (this incident, this scope) and lets the
// Skill enforce the enterprise procedure (repro -> failing test -> minimal fix).
export function buildRemediationPrompt(
  event: IncidentEvent,
  plan: RemediationPlan,
  service: string,
): string {
  return [
    `A production incident fired in "${service}".`,
    ``,
    `Title:   ${event.title}`,
    `Culprit: ${event.culprit}`,
    `Message: ${event.message}`,
    ``,
    `Stack trace:`,
    event.stack,
    ``,
    `Follow the "incident-triage" skill in this repository exactly.`,
    `Scope every change to the "${service}" service and its tests only.`,
    plan.requiresHumanApproval
      ? `Open the PR as a DRAFT and do not mark it ready — a human must approve before merge.`
      : `Open a normal PR when the fix is verified.`,
    ``,
    `Do not touch secrets, environment files, CI config, or infrastructure.`,
  ].join("\n");
}
