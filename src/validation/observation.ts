import { SCHEMA_VERSION } from "../contracts/version";
import type { ObservationPortReport } from "../contracts/observation";
import type { ValidationResult } from "../contracts/validation";
import { validateObservations, validateProvenance } from "./evidence";
import { choice, definitionRef, digest, finish, object } from "./shared";

/** Validate the scoped provider report; origin is derived only for its returned facts. */
export function parseObservationPortReport(
  input: unknown,
): ValidationResult<ObservationPortReport> {
  return finish(input, "invalid_evidence", (data, issues) => {
    const required = ["schemaVersion", "definition", "provenance", "observations"];
    if (!object(data, "$", [...required, "artifactDigest", "termination"], required, issues))
      return;
    if (data.schemaVersion !== SCHEMA_VERSION) issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    validateProvenance(data.provenance, "$.provenance", issues);
    if (Object.hasOwn(data, "termination")) {
      choice(data.termination, ["exited", "timeout", "crash"], "$.termination", issues);
    } else if (
      Array.isArray(data.observations) &&
      data.observations.some(
        (item) => item !== null && typeof item === "object" && Object.hasOwn(item, "executionFact"),
      )
    ) {
      issues.add("$.termination", "MISSING_FIELD");
    }
    validateObservations(data.observations, data.artifactDigest, issues, true);
  });
}
