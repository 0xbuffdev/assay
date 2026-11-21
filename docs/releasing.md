# Release policy

**There is no Assay release.** The repository currently sets `version: 0.0.0`, `private: true` and `license: UNLICENSED`; the generated `dist/index.js` and `dist/index.d.ts` are foundation smoke artifacts, **not** a released or supported evaluation API.

AY-I04 must establish and verify a real release procedure:

1. Obtain explicit open-source license and contribution authorization; check source and dependency rights.
2. Finish accepted contracts, comparator semantics, error states and hostile-input limits.
3. Run pinned tsdown ESM/declaration builds, Vitest and Biome checks, and verify the exact locked dependency tree.
4. Inspect the package archive for secrets, protected references, private modules and unexpected files.
5. Install and test that exact archive in an independent consumer with no OEE, 0xNAND, AI or executor runtime.
6. Require exact-commit CI evidence, an explicitly approved verified tag and separate controlled publication.

Passing unit tests, creating a public repository or merging source code is not publication approval.
