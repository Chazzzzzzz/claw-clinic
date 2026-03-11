import type { TraceRecord } from "../types/index.js";
import { deepEqual } from "./symptom-extraction.js";

export interface LoopDetectionResult {
  detected: boolean;
  confidence: "high" | "medium" | "none";
  looping_tool: string | null;
  loop_length: number;
  argument_match_ratio: number;
  recommendation: string | null;
}

export function detectLoop(trace: TraceRecord[]): LoopDetectionResult {
  const toolCalls = trace.filter((t) => t.type === "tool_call");

  if (toolCalls.length < 3) {
    return {
      detected: false,
      confidence: "none",
      looping_tool: null,
      loop_length: 0,
      argument_match_ratio: 0,
      recommendation: null,
    };
  }

  let bestResult: LoopDetectionResult = {
    detected: false,
    confidence: "none",
    looping_tool: null,
    loop_length: 0,
    argument_match_ratio: 0,
    recommendation: null,
  };

  // Check sliding window of size 3
  for (let i = 0; i <= toolCalls.length - 3; i++) {
    const window = toolCalls.slice(i, i + 3);
    const toolName = window[0].content.tool_name;
    const sameTool = window.every((t) => t.content.tool_name === toolName);

    if (!sameTool) continue;

    // Count matching pairs (3 possible pairs from 3 items)
    let matchingPairs = 0;
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        if (deepEqual(window[a].content.tool_args, window[b].content.tool_args)) {
          matchingPairs++;
        }
      }
    }

    let confidence: "high" | "medium" | "none";
    let argMatchRatio: number;

    if (matchingPairs === 3) {
      confidence = "high";
      argMatchRatio = 1.0;
    } else if (matchingPairs >= 2) {
      confidence = "high";
      argMatchRatio = 0.67;
    } else if (matchingPairs >= 1) {
      confidence = "medium";
      argMatchRatio = 0.33;
    } else {
      continue;
    }

    if (
      (confidence === "high" && bestResult.confidence !== "high") ||
      (confidence === "high" && argMatchRatio > bestResult.argument_match_ratio) ||
      (confidence === "medium" && bestResult.confidence === "none")
    ) {
      bestResult = {
        detected: true,
        confidence,
        looping_tool: toolName ?? null,
        loop_length: 3,
        argument_match_ratio: argMatchRatio,
        recommendation: null,
      };
    }
  }

  // Check longer windows (5, 10) for extended loops
  for (const windowSize of [5, 10]) {
    if (toolCalls.length < windowSize) continue;

    for (let i = 0; i <= toolCalls.length - windowSize; i++) {
      const window = toolCalls.slice(i, i + windowSize);
      const toolName = window[0].content.tool_name;
      const sameTool = window.every((t) => t.content.tool_name === toolName);

      if (sameTool && bestResult.detected) {
        bestResult.loop_length = Math.max(bestResult.loop_length, windowSize);
        bestResult.confidence = "high";
      }
    }
  }

  // Generate recommendation for high confidence loops
  if (bestResult.confidence === "high" && bestResult.looping_tool) {
    bestResult.recommendation =
      `STOP calling ${bestResult.looping_tool}. You have called it ${bestResult.loop_length} times with similar arguments. The results will not change. Try an alternative approach or report the error to the user.`;
  } else if (bestResult.confidence === "medium" && bestResult.looping_tool) {
    bestResult.recommendation =
      `You appear to be repeating calls to ${bestResult.looping_tool}. Consider whether you are making progress or if a different approach would be more effective.`;
  }

  return bestResult;
}
