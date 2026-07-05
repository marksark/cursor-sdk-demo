// Simulates a production incident. In real life this is a Sentry/Datadog webhook.
// Here we actually hit the buggy endpoint, capture the 500, and POST a
// Sentry-shaped event to the orchestrator. Swap this file for a real Sentry MCP
// or webhook and NOTHING downstream changes — that's the point.

const APP_URL = process.env.APP_URL ?? "http://localhost:3001";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:3000";
const MULTI = process.argv.includes("--multi");

// Sentry-ish event shape (trimmed to what the orchestrator reads).
interface IncidentEvent {
  id: string;
  level: "error" | "warning";
  title: string;
  culprit: string;
  message: string;
  stack: string;
  tags: { service: string; environment: string; compliance?: string };
  implicatedServices: string[]; // triage uses this to decide single vs. fan-out
}

async function reproduceRealIncident(): Promise<IncidentEvent> {
  const target = `${APP_URL}/api/invoices/INV-1002/summary`;
  const res = await fetch(target);
  const body = (await res.json()) as any;
  if (res.status !== 500) {
    throw new Error(`Expected a 500 from ${target}, got ${res.status}. Is the bug fixed already?`);
  }
  return {
    id: `evt_${Date.now()}`,
    level: "error",
    title: `${body.error}: ${body.message}`,
    culprit: body.culprit,
    message: body.message,
    stack: body.stack,
    tags: { service: "billing-api", environment: "production" },
    implicatedServices: ["billing-api"],
  };
}

function fabricateMultiServiceIncident(): IncidentEvent {
  // A payments-adjacent failure that fans out AND crosses a compliance path.
  return {
    id: `evt_${Date.now()}`,
    level: "error",
    title: "TypeError: Cannot read properties of undefined (reading 'rate') across billing + payments",
    culprit: "at summarizeInvoice (/demo-app/src/services/pricing.ts:24)",
    message: "Discounted total miscomputed; downstream payment capture rejected",
    stack: "(cross-service trace elided for demo)",
    tags: { service: "billing-api", environment: "production", compliance: "PCI" },
    implicatedServices: ["billing-api", "payments-api"],
  };
}

async function main() {
  const event = MULTI ? fabricateMultiServiceIncident() : await reproduceRealIncident();

  console.log(`\n🚨 Incident captured: ${event.title}`);
  console.log(`   culprit: ${event.culprit}`);
  console.log(`   services: ${event.implicatedServices.join(", ")}${event.tags.compliance ? `  [${event.tags.compliance}]` : ""}`);
  console.log(`   -> POST ${ORCHESTRATOR_URL}/webhooks/incident\n`);

  const res = await fetch(`${ORCHESTRATOR_URL}/webhooks/incident`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  console.log(`Orchestrator responded ${res.status}:`);
  console.log(await res.text());
}

main().catch((e) => {
  console.error("incident-source failed:", e.message);
  process.exit(1);
});
