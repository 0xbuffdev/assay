import type { ObservationPortReport } from "../contracts/observation";
import type { ValidationResult } from "../contracts/validation";
import { validateObservations, validateProvenance } from "./evidence";
import { definitionRef, digest, finish, object } from "./shared";

/** Validate the scoped provider report; origin is derived only for its returned facts. */
export function parseObservationPortReport(
  input: unknown,
): ValidationResult<ObservationPortReport> {
  return finish(input, "invalid_evidence", (data, issues) => {
    const required = ["schemaVersion", "definition", "provenance", "observations"];
    if (!object(data, "$", [...required, "artifactDigest"], required, issues)) return;
    if (data.schemaVersion !== 2) issues.add("$.schemaVersion", "UNSUPPORTED_VERSION");
    definitionRef(data.definition, "$.definition", issues);
    if (Object.hasOwn(data, "artifactDigest"))
      digest(data.artifactDigest, "$.artifactDigest", issues);
    validateProvenance(data.provenance, "$.provenance", issues);
    validateObservations(data.observations, data.artifactDigest, issues, true);
  });
}
