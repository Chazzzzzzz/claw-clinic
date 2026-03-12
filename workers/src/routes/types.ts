export interface TreatmentStep {
  id: string;
  action: string;
  description: string;
  requiresUserInput: boolean;
  inputPrompt?: string;
}
