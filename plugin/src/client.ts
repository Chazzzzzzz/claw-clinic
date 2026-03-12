import type { Evidence, DiagnosisResponse, TreatmentResponse } from "./types.js";

export class ClawClinicClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async healthCheck(): Promise<{ status: string; version: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`Backend health check failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<{ status: string; version: string }>;
  }

  async diagnose(evidence: Evidence[], symptoms?: string): Promise<DiagnosisResponse> {
    const res = await fetch(`${this.baseUrl}/diagnose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidence, symptoms }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Diagnosis failed: ${res.status} — ${body}`);
    }
    return res.json() as Promise<DiagnosisResponse>;
  }

  async treat(sessionId: string, stepId: string, stepResult: {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }): Promise<TreatmentResponse> {
    const res = await fetch(`${this.baseUrl}/treat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, stepId, stepResult }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Treatment failed: ${res.status} — ${body}`);
    }
    return res.json() as Promise<TreatmentResponse>;
  }
}
