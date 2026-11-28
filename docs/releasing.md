# Release policy

Assay uses Apache-2.0 and Semantic Versioning. Version 0.0.1 is the first intended public npm package. The package manifest is prepared for public access; no package has been published. Before 1.0.0, consumers should pin the version they tested.

The [release preparation decision](https://github.com/0xbuffdev/context/blob/main/repos/assay/reviews/2026-11-28-release-preparation.md) authorizes metadata and documentation changes. The [AY-I09 publication hold](https://github.com/0xbuffdev/context/blob/main/repos/assay/reviews/2026-11-22-release-decision.md) remains in force.

## Candidate verification

Use Node.js 24+ and pnpm 11.2.2:

```sh
git rev-parse HEAD
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

The read-only quality workflow runs the equivalent checks on Ubuntu and Windows. Preserve the run, tested commit and tree identity. Package verification builds on the source checks and records the local tarball SHA-256, size and file manifest.

The package must contain exactly:

- `package.json`, `README.md`, `CHANGELOG.md`
- `LICENSE`, `COPYRIGHT.md`
- `dist/index.js`, `dist/index.js.map`, `dist/index.d.ts`

The verifier checks package metadata, licensing, no runtime dependencies, no lifecycle scripts, and known synthetic canaries in compiled payloads. It packs locally, installs offline with scripts disabled in an independent temporary directory, runs the ESM scenarios and typechecks the installed declarations. It removes the temporary archive and consumer on exit. The verifier does not publish anything.

## Publication checklist

- Confirm the npm scope `@0xbuff`, package name, version availability and publisher identity.
- Confirm contributor rights, Apache-2.0 attribution and third-party notices.
- Review the exact candidate commit, tarball contents, source map, digest and CI results. A passing automated scan does not replace independent inspection.
- Approve a separate protected release workflow and verify the actual npm account configuration.
- Approve the exact release version and release date. Move the changelog's Unreleased changes to the dated version section when the release occurs.
- Obtain explicit authorization before creating a tag, staging or publishing.

For a public package, prefer [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with a protected GitHub environment and stage-only permission. A maintainer must approve the staged package through npm using its required authentication. Keep quality CI read-only; never introduce a long-lived npm token to it.

Actual release execution requires a separate maintainer decision. Host authorization, execution isolation and formal grading remain outside Assay.
