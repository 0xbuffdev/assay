import { describe, expect, it } from "vitest";

import * as assay from "../src/index";

describe("Assay repository foundation", () => {
  it("exports no unreviewed evaluation behavior", () => {
    expect(Object.keys(assay)).toEqual([]);
  });

  it("imports the source module without a runner, host or AI provider", async () => {
    const entry = await import("../src/index");
    expect(entry).toBeDefined();
    expect(Object.keys(entry)).toEqual([]);
  });
});
