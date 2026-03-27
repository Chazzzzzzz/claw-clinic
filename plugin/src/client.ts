export interface ConsultMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}

export interface ConsultToolCall {
  id: string;
  name: "run_command" | "propose_fix" | "mark_resolved";
  input: Record<string, string>;
}

export interface ConsultResponse {
  text: string;
  toolCalls: ConsultToolCall[];
  done: boolean;
  assistantContent: unknown[];
}

export class ClawClinicClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async consult(messages: ConsultMessage[]): Promise<ConsultResponse> {
    const res = await fetch(`${this.baseUrl}/consult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Consultation failed: ${res.status} — ${body}`);
    }
    return res.json() as Promise<ConsultResponse>;
  }

  async healthCheck(): Promise<{ status: string; version: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`Backend health check failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<{ status: string; version: string }>;
  }
}
