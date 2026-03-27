import { Hono } from "hono";
import { cors } from "hono/cors";
import diagnoseRouter from "./routes/diagnose.js";
import treatRouter from "./routes/treat.js";
import verifyRouter from "./routes/verify.js";
import consultRouter from "./routes/consult.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ status: "ok", version: "0.1.0" });
});

app.route("/", diagnoseRouter);
app.route("/", consultRouter);

app.route("/treat", treatRouter);

app.route("/verify", verifyRouter);

export { app };
