import { Hono } from "hono";
import { cors } from "hono/cors";
import consultRouter from "./routes/consult.js";
import casesRouter from "./routes/cases.js";
import forumRouter from "./routes/forum.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ status: "ok", version: "0.1.0" });
});

app.route("/", consultRouter);
app.route("/", casesRouter);
app.route("/", forumRouter);

export { app };
