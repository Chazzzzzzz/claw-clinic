import { Hono } from "hono";
import { getSupabase, type CaseRecord } from "../db/supabase.js";

const casesRouter = new Hono();

// GET /cases — list community cures, optionally filtered by ICD-AI code
casesRouter.get("/cases", async (c) => {
  const db = getSupabase();
  if (!db) return c.json({ error: "Database not configured" }, 503);

  const code = c.req.query("icd_ai_code");
  const search = c.req.query("q");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);

  let query = db
    .from("cases")
    .select("*")
    .order("success_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (code) {
    query = query.eq("icd_ai_code", code);
  }
  if (search) {
    query = query.or(`disease_name.ilike.%${search}%,symptoms_text.ilike.%${search}%,icd_ai_code.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ cases: data || [] });
});

// GET /cases/:id — single case
casesRouter.get("/cases/:id", async (c) => {
  const db = getSupabase();
  if (!db) return c.json({ error: "Database not configured" }, 503);

  const { data, error } = await db
    .from("cases")
    .select("*")
    .eq("id", c.req.param("id"))
    .single();

  if (error || !data) return c.json({ error: "Case not found" }, 404);
  return c.json(data);
});

// POST /cases — submit a community cure
casesRouter.post("/cases", async (c) => {
  const db = getSupabase();
  if (!db) return c.json({ error: "Database not configured" }, 503);

  const body = await c.req.json<{
    icd_ai_code: string;
    disease_name: string;
    symptoms_text: string;
    evidence_summary?: string;
    treatment_steps: Array<{ label: string; command?: string; description: string }>;
    outcome?: "cured" | "partial" | "failed";
    framework?: string;
    created_by?: string;
  }>();

  if (!body.icd_ai_code || !body.disease_name || !body.symptoms_text || !body.treatment_steps?.length) {
    return c.json({ error: "Missing required fields: icd_ai_code, disease_name, symptoms_text, treatment_steps" }, 400);
  }

  const { data, error } = await db
    .from("cases")
    .insert({
      icd_ai_code: body.icd_ai_code,
      disease_name: body.disease_name,
      symptoms_text: body.symptoms_text,
      evidence_summary: body.evidence_summary || null,
      treatment_steps: body.treatment_steps,
      outcome: body.outcome || "cured",
      framework: body.framework || null,
      created_by: body.created_by || null,
    })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ case_id: data.id, status: "accepted" }, 201);
});

// POST /cases/:id/success — mark a cure as successfully reused
casesRouter.post("/cases/:id/success", async (c) => {
  const db = getSupabase();
  if (!db) return c.json({ error: "Database not configured" }, 503);

  const caseId = c.req.param("id");
  const body = await c.req.json<{ clinic_id?: string }>();

  // Upsert into case_successes (idempotent)
  if (body.clinic_id) {
    await db.from("case_successes").upsert({
      case_id: caseId,
      clinic_id: body.clinic_id,
    }, { onConflict: "case_id,clinic_id" });
  }

  // Increment success_count
  const { error } = await db.rpc("increment_success_count", { case_id_param: caseId });
  if (error) {
    // Fallback: manual increment
    const { data: existing } = await db.from("cases").select("success_count").eq("id", caseId).single();
    if (existing) {
      await db.from("cases").update({
        success_count: (existing.success_count || 0) + 1,
        last_verified_at: new Date().toISOString(),
      }).eq("id", caseId);
    }
  }

  return c.json({ status: "ok" });
});

export default casesRouter;
