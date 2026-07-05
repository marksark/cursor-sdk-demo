#!/usr/bin/env node
// preToolUse guard: deny edits to sensitive paths regardless of what the agent
// "wants" to do. This is the programmatic enforcement point enterprises ask
// about — policy as code, not policy as a prompt suggestion.
//
// Hooks receive the pending tool call on stdin and signal allow/deny via the
// response. Confirm the exact I/O contract against cursor.com/docs/sdk; the
// intent (inspect target path -> block or allow) is what matters for the demo.

const DENY = [/^\.env/, /(^|\/)\.env/, /(^|\/)secrets?\//i, /(^|\/)\.github\//, /(^|\/)infra(structure)?\//i, /\.pem$/, /\.key$/];

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let path = "";
  try {
    const payload = JSON.parse(raw || "{}");
    path = payload?.args?.path ?? payload?.path ?? payload?.input?.path ?? "";
  } catch {
    /* fall through to allow if we cannot parse */
  }

  const blocked = DENY.some((re) => re.test(path));
  if (blocked) {
    process.stdout.write(
      JSON.stringify({ decision: "deny", reason: `Policy: edits to '${path}' are not permitted by auto-remediation.` }),
    );
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ decision: "allow" }));
});
