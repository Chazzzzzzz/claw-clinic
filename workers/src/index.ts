import { serve } from "@hono/node-server";
import { app } from "./server.js";

const port = Number(process.env.PORT) || 8080;

serve({ fetch: app.fetch, port }, () => {
  console.log(`Claw Clinic API listening on port ${port}`);
});
