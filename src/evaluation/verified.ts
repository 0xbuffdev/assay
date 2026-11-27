import type { EvaluationResponse } from "../contracts/result";
import { verifyAssessmentDefinition } from "../integrity/definition";
import { evaluate } from "./evaluate";

/**
 * Guarded technical evaluation. evaluate() remains the unverified, pure
 * comparison primitive for caller-supplied definition identity claims.
 */
export function evaluateVerified(
  definitionInput: unknown,
  evidenceInput: unknown,
): EvaluationResponse {
  const checked = verifyAssessmentDefinition(definitionInput);
  if (!checked.ok) {
    return Object.freeze({ outcome: "invalid_definition", diagnostics: checked.diagnostics });
  }
  return evaluate(checked.value, evidenceInput);
}
