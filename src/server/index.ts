import { Hono } from "hono";
import type { AppConfig } from "../shared/auth";
import type { AppEnv } from "./env";
import { requireUser } from "./middleware/requireUser";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
import { invites } from "./routes/invites";
import { ocr } from "./routes/ocr";
import { ocrLab } from "./routes/ocrLab";

const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.get("/config", (c) => c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID } satisfies AppConfig));
app.route("/auth", auth);
app.route("/invites", invites);
app.get("/me", requireUser, (c) => c.json(c.get("user")));
app.route("/admin", admin);
app.route("/ocr", ocr);
app.route("/lab/ocr", ocrLab);

app.notFound((c) => c.json({ error: "Not Found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "サーバーでエラーが発生しました" }, 500);
});

export default app;
