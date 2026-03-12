import { Hono } from "hono";
import { cors } from "hono/cors";
import diagnoseRouter from "./routes/diagnose.js";
import treatRouter from "./routes/treat.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ status: "ok", version: "0.1.0" });
});

app.route("/", diagnoseRouter);

app.route("/treat", treatRouter);

export { app };
