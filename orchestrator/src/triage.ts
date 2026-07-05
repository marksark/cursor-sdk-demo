// TRIAGE: turn a raw incident into a remediation PLAN.
//
// ▸▸ This file is the demo's centerpiece. ◂◂
// The branch below — "if one service, ship a scoped fix on a cheap model;
// if the blast radius crosses services or a compliance boundary, fan out a
// subagent per service AND require human approval" — is control flow you can
// only express in code. A no-code Automation fires ONE agent per trigger with
// ONE fixed config. The moment you need this `if` + this `for`, you're in SDK
// territory. Point at these lines when they ask "why not just an Automation?"

export interface IncidentEvent {
  id: string;
  level: string;
  title: string;
  culprit: string;
  message: string;
  stack: string;
  tags: { service: string; environment: string; compliance?: string };
  implicatedServices: string[];
}

export interface RemediationPlan {
  strategy: "single-service" | "fan-out";
  services: string[];
  model: string;                 // route cost vs. capability per plan
  autoOpenPR: boolean;           // false when a human must approve first
  requiresHumanApproval: boolean;
  reason: string;
}

const COMPLIANCE_SENSITIVE = new Set(["PCI", "SOC2", "HIPAA"]);

export function triage(event: IncidentEvent): RemediationPlan {
  const services = [...new Set(event.implicatedServices)];
  const crossesCompliance = !!event.tags.compliance && COMPLIANCE_SENSITIVE.has(event.tags.compliance);

  // ── THE FORK ──────────────────────────────────────────────────────────────
  if (services.length <= 1 && !crossesCompliance) {
    // Small, contained blast radius: cheap model, auto-open the PR, no human gate.
    return {
      strategy: "single-service",
      services,
      model: "composer-2",
      autoOpenPR: true,
      requiresHumanApproval: false,
      reason: "Single service, no compliance boundary — safe to auto-remediate and open a PR.",
    };
  }

  // Wide or compliance-sensitive blast radius: fan out one agent per service,
  // use a stronger model for cross-service reasoning, and hold at the merge gate.
  return {
    strategy: "fan-out",
    services,
    model: "gpt-5.5",
    autoOpenPR: false,
    requiresHumanApproval: true,
    reason: crossesCompliance
      ? `Crosses a ${event.tags.compliance} boundary — fan out per service and require human approval before merge.`
      : "Multiple services implicated — fan out per service and require human approval before merge.",
  };
  // ──────────────────────────────────────────────────────────────────────────
}
