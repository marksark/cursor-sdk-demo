---
name: incident-triage
description: >
  Procedure for safely remediating a production incident in this repository.
  Use whenever you are handed a stack trace, error event, or failing endpoint
  and asked to fix it. Enforces reproduce-first, test-first, minimal-diff.
---

# Incident triage & remediation

You are remediating a live production incident. Optimize for a **small, correct,
reviewable** change — not a clever one. A human owns the merge; your job is to
make their decision easy.

## Procedure (do these in order)

1. **Reproduce first.** Locate the failing behavior from the stack trace and the
   `culprit` frame. Confirm you can trigger the error before changing anything.
   For this repo, hit the affected endpoint (e.g. `GET /api/invoices/INV-1002/summary`).
2. **Write a failing test.** Add a test that reproduces the incident and fails
   for the current code. This becomes the proof your fix works.
3. **Localize.** Use codebase search to find the root cause. Name the exact file
   and line in your PR. Do not fix symptoms downstream of the real cause.
4. **Make the minimal fix.** Change the smallest surface that resolves the root
   cause. Prefer a guard/normalization over a rewrite. Keep the public API stable.
5. **Verify.** Run the test suite. The new test must pass and no others may break.
6. **Stay in scope.** Only edit files belonging to the implicated service and its
   tests. Never modify secrets, `.env*`, CI config, or infrastructure.

## PR requirements

Open a PR titled `[auto-remediation] <one-line root cause>` containing:

- **Root cause** — what actually broke and where (file:line).
- **Fix** — what you changed and why it is minimal and safe.
- **Risk note** — blast radius, and anything a reviewer should double-check.
- **Test evidence** — the failing-then-passing test you added.

If asked to open a draft, open the PR as a **draft** and do not mark it ready.
