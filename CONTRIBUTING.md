# Contributing to market-intelligence

Thanks for your interest in improving this project. This document covers the
development workflow, code standards, and review expectations.

## Prerequisites

- **Node.js >= 20** (Node 22 LTS recommended)
- **pnpm 9.x** — pinned via the `packageManager` field; enable with
  `corepack enable` or install globally

## Getting started

```bash
git clone https://github.com/shubhamtaywade82/market-intelligence.git
cd market-intelligence
pnpm install
pnpm run build     # MUST run before test/typecheck (workspace types resolve via dist/)
pnpm run test
```

## Workspace layout

This is a pnpm monorepo. Dependencies flow strictly downward — no package
imports upward:

```
market-data          → (market-events)
market-events        → (nothing internal)
market-research      → market-events
research-agent       → market-events + market-research + market-data
market-stream        → market-data + market-events
...higher layers     → the above
```

Before adding a cross-package import, verify it does not violate this
direction. The LLM layer (`research-agent`) must never become a dependency of
the deterministic packages (`market-events`, `market-research`).

## Development workflow

1. **Branch** from `main` using a descriptive name:
   - `feat/<short-description>` — new capability
   - `fix/<short-description>` — bug fix
   - `chore/<short-description>` — tooling, deps, docs
   - `test/<short-description>` — test-only changes
2. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   `feat(market-events): add sweep detection on lower highs`
   Scope = package name without the `@nemesis-oss/` prefix.
3. **Before opening a PR**, all of these must pass locally:

   ```bash
   pnpm run build    # compiles every package
   pnpm run test     # full test suite — must be green
   pnpm run lint     # eslint — must be clean (warnings allowed, errors not)
   ```

4. **Open a PR** against `main` with:
   - What changed and why
   - For behavior changes: which tests cover them
   - For new detectors/statistics: the methodology reference

## Code standards

- **TypeScript strict mode** is on repo-wide (`tsconfig.base.json`):
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
  Do not weaken these flags.
- **Zero lookahead** in event detection: every lifecycle index must satisfy
  `originIndex <= formedAtIndex <= confirmedAtIndex <= availableAtIndex`.
  Any detector change must preserve this — it is the core guarantee.
- **Determinism in the research kernel**: statistical outputs must be
  reproducible. If you introduce randomness, seed it and expose the seed.
- **Tests are required** for new logic. Place them in the package's `test/`
  directory; mirror the source file name (`fvg.ts` → `fvg.test.ts`).
- **No new runtime dependencies** in the deterministic packages without
  discussion — `market-events` is intentionally dependency-free.
- **Docs**: user-facing behavior changes update the relevant package README.

## Testing notes

- Tests use [vitest](https://vitest.dev/) and run from the repo root.
- Network-dependent tests must be skippable without network (see
  `ollama.integration.test.ts` for the pattern).
- When fixing a test, preserve the *intent* of the test. If the intent is
  unclear, ask in the PR rather than adjusting assertions to pass.

## CI

GitHub Actions runs `install → build → test` on Node 20 and 22 for every PR
to `main`, plus CodeQL security analysis. Dependabot opens weekly grouped
dependency PRs; major-version bumps to pinned packages require manual review.

## Reporting bugs / security issues

- Bugs: open a GitHub issue with reproduction steps, Node version, and
  relevant logs.
- Security: do NOT open a public issue. Use GitHub's private vulnerability
  reporting on this repository.
