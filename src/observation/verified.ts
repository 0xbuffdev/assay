import type { ObservationCollectionResult, ObservationPort } from "../contracts/observation";
import { verifyAssessmentDefinition } from "../integrity/definition";
import { collectObservations } from "./collect";

/** Reject content changes before calling an injected observation provider. */
export async function collectVerifiedObservations(
  definitionInput: unknown,
  evidenceInput: unknown,
  port: ObservationPort,
): Promise<ObservationCollectionResult> {
  const checked = verifyAssessmentDefinition(definitionInput);
  if (!checked.ok) {
    return Object.freeze({
      ok: false,
      outcome: "invalid_definition",
      diagnostics: checked.diagnostics,
    });
  }
  return collectObservations(checked.value, evidenceInput, port);
}
