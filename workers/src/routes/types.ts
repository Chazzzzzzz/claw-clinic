export interface TreatmentStep {
  id: string;
  action: string;
  description: string;  // For AI-generated steps, this is the executable command
  requiresUserInput: boolean;
  inputPrompt?: string;
  expectedOutput?: string;
  next?: string;  // "run_next_step" | "verify_fix" | "done"
}
