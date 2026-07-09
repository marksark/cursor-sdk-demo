import { createHash } from "node:crypto";
import type { IncidentEvent } from "./triage.js";

/** Stable key for the same production error — used to dedupe remediation runs. */
export function computeIncidentFingerprint(event: Pick<
  IncidentEvent,
  "message" | "stack" | "culprit" | "tags" | "implicatedServices"
>): string {
  const canonical = [
    event.tags.service,
    event.message.trim(),
    event.culprit.trim(),
    event.stack.trim(),
    [...event.implicatedServices].sort().join(","),
    event.tags.compliance ?? "",
  ].join("\n");

  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
