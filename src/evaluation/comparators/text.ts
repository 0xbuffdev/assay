import type { Criterion, TextNormalization } from "../../contracts/definition";
import type { Observation } from "../../contracts/evidence";
import { type Comparison, FAILED, finding, PASSED, REFERENCE_UNAVAILABLE } from "./finding";

/**
 * All transformations are opt-in, in this fixed order: line endings,
 * locale-independent Unicode lowercasing, Unicode normalization, whitespace
 * collapsing, then trimming. "fold" is ECMAScript lowercasing rather than
 * the full Unicode CaseFolding mapping.
 */
function normalizeText(value: string, policy: TextNormalization): string {
  let output = value;
  if (policy.lineEndings === "lf") output = output.replace(/\r\n?/g, "\n");
  if (policy.case === "fold") output = output.toLowerCase();
  if (policy.unicode !== "none") output = output.normalize(policy.unicode);
  if (policy.whitespace === "collapse") output = output.replace(/\s+/gu, " ");
  if (policy.trim === "both") output = output.trim();
  return output;
}

export function compareExactText(
  criterion: Extract<Criterion, { kind: "exact_text" }>,
  observation: Observation,
): Comparison {
  if (observation.kind !== "text") return finding("error", "COMPARATOR_ERROR");
  const { expected } = criterion.parameters;
  if (expected.type === "reference") return REFERENCE_UNAVAILABLE;
  // Exact equality is UTF-16 code-unit equality, without normalization.
  return observation.value === expected.value ? PASSED : FAILED;
}

export function compareNormalizedText(
  criterion: Extract<Criterion, { kind: "normalized_text" }>,
  observation: Observation,
): Comparison {
  if (observation.kind !== "text") return finding("error", "COMPARATOR_ERROR");
  const { expected, normalization } = criterion.parameters;
  if (expected.type === "reference") return REFERENCE_UNAVAILABLE;
  return normalizeText(observation.value, normalization) ===
    normalizeText(expected.value, normalization)
    ? PASSED
    : FAILED;
}
