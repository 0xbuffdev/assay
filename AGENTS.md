# Assay repository instructions

Follow the [public Assay specification](https://github.com/0xbuffdev/context/blob/main/repos/assay/specs/0001-evaluation-core.md) and [AY implementation tickets](https://github.com/0xbuffdev/context/blob/main/repos/assay/tickets.md). Those accepted planning documents do not establish implemented APIs or published releases.

## Architecture and authority

Assay evaluates bounded, explicitly defined technical evidence. It does not execute submitted code, authenticate a person, approve formal assessment admission, award academic credit or issue credentials. The root core must work without OEE, 0xNAND, model providers, accounts, React, network APIs or a runner.

Never default missing required references, empty criteria, truncation or comparator failure to `pass`. Keep `pass`, `fail`, `inconclusive`, `invalid_definition`, `invalid_evidence` and `evaluation_error` distinct. Host identity, execution provenance, secret reference protection and formal decisions stay outside the public library.

Do not commit internal product context, protected grader cases, learner data, secrets or personal identifiers. No compatibility bridge for previously unshipped APIs.

## Development

Use Node 24+ and pinned pnpm 11.2.2. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`; add typecheck/build, security and external consumer tests when implementation tickets introduce those capabilities.

Use one focused branch/PR per ticket, add reproducible positive/negative cases, update docs, and record exactly which checks ran. Do not change repository visibility/ownership, approve a license, publish a package, tag, merge or deploy without explicit maintainer authorization.

This foundation exports no evaluation API; AY-I01 is the first runtime implementation.
