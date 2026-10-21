import { Hono } from "hono";
import type { Env } from "./env";
import { ocrLab } from "./routes/ocrLab";

const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/lab/ocr", ocrLab);

app.notFound((c) => c.json({ error: "Not Found" }, 404));

export default app satisfies ExportedHandler<Env>;
