import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invoiceRouter } from "./routes/invoices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.APP_PORT ?? 3001);
const SERVICE = "billing-api";

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true, service: SERVICE }));
app.use("/api/invoices", invoiceRouter);
app.use(express.static(path.join(__dirname, "../public")));

// Structured error handler. In a real deployment this is where Sentry's SDK
// captures the exception. Here we surface the same fields (message, stack,
// culprit frame) so the local incident-source can build an equivalent event.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const stack = err.stack ?? "";
  const culprit =
    stack
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("at ") && l.includes("/demo-app/")) ?? "unknown";

  console.error(`[${SERVICE}] 500 on ${req.method} ${req.originalUrl}: ${err.message}`);

  res.status(500).json({
    service: SERVICE,
    error: err.name,
    message: err.message,
    culprit,
    stack,
    route: `${req.method} ${req.route?.path ?? req.originalUrl}`,
  });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE}] listening on http://localhost:${PORT}`);
  console.log(`  dashboard: http://localhost:${PORT}/`);
  console.log(`  healthy:   GET /api/invoices/INV-1001/summary`);
  console.log(`  broken:    GET /api/invoices/INV-1002/summary  (throws 500)`);
});
