export {
  generateHealthyTrace,
  generateLoopTrace,
  generateConfabulationTrace,
  generateContextRotTrace,
  generateCostExplosionTrace,
  generateToolFailureTrace,
  generateHighErrorRateTrace,
  generateMultiDiseaseTrace,
} from "./trace-generator.js";

export { runEval, formatEvalReport } from "./reporter.js";
export type { EvalReport } from "./reporter.js";
