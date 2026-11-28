# Release policy

Assay uses Apache-2.0 and Semantic Versioning. The package is configured for public npm access. Before 1.0.0, consumers should pin the version they tested.

The [release preparation decision](https://github.com/0xbuffdev/context/blob/main/repos/assay/reviews/2026-11-28-release-preparation.md) authorizes metadata and documentation changes. The [publication hold](https://github.com/0xbuffdev/context/blob/main/repos/assay/reviews/2026-11-22-release-decision.md) remains in force.

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

The verifier checks package metadata, licensing, no runtime dependencies, no lifecycle scripts, and known synthetic canaries in compiled payloads. It packs locally, installs offline with scripts disabled in an independent temporary directory, runs the ESM scenarios and typechecks the installed declarations. It removes the temporary archive and consumer on exit. Set `ASSAY_ARCHIVE_DIR` to a new absolute directory to retain the verified tarball and manifest. Main-push quality runs retain the Ubuntu archive for 30 days; PR runs exercise the same retention path without uploading it. The verifier does not publish anything.

## Publication checklist

- Confirm the npm scope `@0xbuff`, package name, version availability and publisher identity.
- Confirm contributor rights, Apache-2.0 attribution and third-party notices.
- Review the exact candidate commit, tarball contents, source map, digest and CI results. A passing automated scan does not replace independent inspection.
- Approve a separate protected release workflow and verify the actual npm account configuration.
- Approve the exact release version and release date. Move the changelog's Unreleased changes to a dated version section before verifying the final archive. If the intended publication date changes, update the date and repeat verification and inspection.
- Obtain explicit authorization before creating a tag, staging or publishing.

For a public package, prefer [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) with a protected GitHub environment and stage-only permission. A maintainer must approve the staged package through npm using its required authentication. Keep quality CI read-only; never introduce a long-lived npm token to it.

## Protected staging

The `Stage npm package` workflow (`.github/workflows/release.yml`) runs only by manual dispatch on `main`. It uses the existing successful main quality run and stages its verified archive without rebuilding it. The environment must be configured before use.

1. In repository Settings > Environments, create `npm-stage`. Restrict deployments to `main`, require reviewers and disallow administrator bypass. Enable prevention of self-review if another reviewer is available.
2. After independent inspection and explicit release approval, set environment variables `ASSAY_STAGE_COMMIT`, `ASSAY_STAGE_RUN_ID` and `ASSAY_STAGE_SHA256` to the approved current main SHA, successful main quality run ID and tarball digest. Leave them unset until approval. Finalize dated release notes and reverify any resulting changes before setting these values.
3. When package settings are available and staging is authorized, configure a GitHub Actions trusted publisher for `0xbuffdev/assay`, workflow `release.yml`, environment `npm-stage`. Allow staging only; disable direct publish and dist-tag changes. Use a GitHub-hosted runner. No npm token is required in GitHub. Configure the publisher close to use; npm expires new configurations that are not validated within two days.
4. Dispatch the workflow with the approved quality run ID. Review and approve the environment job. The workflow checks the approved commit, successful quality run, archive metadata, actual digest and dated changelog before requesting staging. It does not publish or tag anything.
5. Inspect the staged package in npm and compare its tarball digest to the approved artifact. Approve the staged version using npm's required human 2FA only after separate publication authorization. Clear the environment approval variables when done.

For a new package, the owner may stage the first inspected tarball from an authenticated npm session before configuring package-level trusted publishing. npm creates a public `0.0.0-stage` placeholder automatically; the staged contents remain unavailable until approved. This registry change requires explicit authorization, too. Do not create a placeholder manually. Use npm CLI 11.15.0 or later and enable account 2FA. See [staged publishing](https://docs.npmjs.com/staged-publishing/) for details.

Actual release execution requires a separate maintainer decision. Host authorization, execution isolation and formal grading remain outside Assay.
