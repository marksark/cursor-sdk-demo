# PPT Outline — SDK vs Bugbot vs Automations

Companion to `SDK-vs-Bugbot-vs-Automations.pptx` (10 slides + speaker notes).

---

## Slide 1 · Title
**Same Runtime, Three Rungs**  
When & Why: Bugbot · Automations · SDK  
*Incident Remediation Demo · Cursor Field Engineer*

---

## Slide 2 · The product ladder
- **BUGBOT** — Packaged · zero config · "Review my PRs"
- **AUTOMATIONS** — No-code · one trigger → one task
- **SDK** — Code · orchestration · your control plane
- Each rung trades convenience for control

**Speaker note:** Bugbot autofix uses the same cloud runtime as this demo.

---

## Slide 3 · When to use what (table)
| Bugbot | Automations | SDK |
| PR trigger | Single event | Your code first |
| Review + autofix | Fixed agent task | Branching logic |
| Zero config | Webhook enough | Fan-out / state / embed |

---

## Slide 4 · Why each exists (table)
| Offering | Wins | Stops |
| Bugbot | Fast PR review | No incident trigger |
| Automations | Fast webhook → agent | No if/fan-out |
| SDK | Full orchestration | Overkill for one step |

---

## Slide 5 · Objections
- Why not Bugbot? → PR review yes; Sentry/incident no
- Why not Automation? → One step yes; triage fork no
- Why not script? → Detect vs reason

---

## Slide 6 · Why THIS demo is SDK (table)
Point at `orchestrator/src/triage.ts` live.

**Callout:** *A form fires one agent. A program decides which agent, which model, whether a human approves.*

---

## Slide 7 · Real-world examples (table)
Bugbot · Automation · SDK scenarios (PR review, security label, Sentry 500, PCI fan-out, embedded SaaS).

---

## Slide 8 · Trust ramp
Phase 1 read-only → Phase 2 draft PRs (PCI path) → Phase 3 auto-merge (single-service path)

---

## Slide 9 · Speaker script (20 min)
Tied to `DEMO-SCRIPT.md` minute-by-minute.

---

## Slide 10 · Close
Bugbot = packaged PR review  
Automations = no-code one-shot · SDK = when the workflow is code
