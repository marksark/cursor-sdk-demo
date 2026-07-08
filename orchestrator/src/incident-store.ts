import type { IncidentEvent, RemediationPlan } from "./triage.js";
import type { AgentContextPreview } from "./agent-context.js";
import type { RemediationResult } from "./remediate.js";

export type IncidentPhase =
  | "received"
  | "triaged"
  | "remediating"
  | "completed"
  | "error";

export interface IncidentLogEntry {
  ts: string;
  phase: IncidentPhase | "info";
  message: string;
}

export interface ServiceRemediationState {
  service: string;
  status: RemediationResult["status"];
  prompt: string;
  runId?: string;
  prUrl?: string;
  error?: string;
  events: Array<{ ts: string; type: string; message: string }>;
}

export interface IncidentRecord {
  id: string;
  status: IncidentPhase;
  event: IncidentEvent;
  plan: RemediationPlan;
  dryRun: boolean;
  agentContext: AgentContextPreview;
  remediations: ServiceRemediationState[];
  logs: IncidentLogEntry[];
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

const incidents = new Map<string, IncidentRecord>();

// Once an incident reaches one of these, a fresh identical error is treated as a
// new occurrence rather than a duplicate of an in-flight run.
const TERMINAL_PHASES = new Set<IncidentPhase>(["completed", "error"]);

function now(): string {
  return new Date().toISOString();
}

// Group incidents the way an error tracker (Sentry/Datadog) groups issues: the
// same culprit frame + message + service is "the same problem". This is what
// lets repeated triggers for one production error collapse into a single run
// instead of spawning an agent per click. Keep it stable and normalized.
export function fingerprintEvent(event: IncidentEvent): string {
  const service = event.tags?.service ?? event.implicatedServices?.[0] ?? "unknown";
  return [service, event.culprit, event.message]
    .map((part) => (part ?? "").trim().toLowerCase())
    .join("::");
}

// Returns an existing incident with the same fingerprint that has not yet
// finished. Callers use this to dedupe duplicate triggers onto one in-flight run.
export function findActiveIncidentByFingerprint(
  fingerprint: string,
): IncidentRecord | undefined {
  for (const record of incidents.values()) {
    if (record.fingerprint === fingerprint && !TERMINAL_PHASES.has(record.status)) {
      return record;
    }
  }
  return undefined;
}

export function createIncidentRecord(
  event: IncidentEvent,
  plan: RemediationPlan,
  dryRun: boolean,
  agentContext: AgentContextPreview,
): IncidentRecord {
  const record: IncidentRecord = {
    id: event.id,
    status: "received",
    event,
    plan,
    dryRun,
    agentContext,
    remediations: [],
    logs: [
      {
        ts: now(),
        phase: "received",
        message: `Incident received: ${event.title}`,
      },
    ],
    fingerprint: fingerprintEvent(event),
    createdAt: now(),
    updatedAt: now(),
  };
  incidents.set(event.id, record);
  return record;
}

export function getIncident(id: string): IncidentRecord | undefined {
  return incidents.get(id);
}

export function listIncidents(): IncidentRecord[] {
  return [...incidents.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}

export function appendLog(
  id: string,
  phase: IncidentLogEntry["phase"],
  message: string,
): void {
  const record = incidents.get(id);
  if (!record) return;
  record.logs.push({ ts: now(), phase, message });
  record.updatedAt = now();
}

export function markTriaged(id: string): void {
  const record = incidents.get(id);
  if (!record) return;
  record.status = "triaged";
  record.updatedAt = now();
}

export function markRemediating(id: string): void {
  const record = incidents.get(id);
  if (!record) return;
  record.status = "remediating";
  record.updatedAt = now();
}

export function upsertServiceRemediation(
  id: string,
  state: ServiceRemediationState,
): void {
  const record = incidents.get(id);
  if (!record) return;
  const idx = record.remediations.findIndex((r) => r.service === state.service);
  if (idx >= 0) {
    record.remediations[idx] = state;
  } else {
    record.remediations.push(state);
  }
  record.updatedAt = now();
}

export function appendServiceEvent(
  id: string,
  service: string,
  type: string,
  message: string,
): void {
  const record = incidents.get(id);
  if (!record) return;
  const svc = record.remediations.find((r) => r.service === service);
  if (!svc) return;
  svc.events.push({ ts: now(), type, message });
  record.updatedAt = now();
}

export function markCompleted(id: string, hadError: boolean): void {
  const record = incidents.get(id);
  if (!record) return;
  record.status = hadError ? "error" : "completed";
  record.updatedAt = now();
}
