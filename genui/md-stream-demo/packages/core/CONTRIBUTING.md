# Contributing

Issues and PRs welcome. Before contributing, please:

1. Run `pnpm install` at repo root
2. Run `pnpm test` and `pnpm build` inside `packages/core/` — both must pass
3. For protocol changes, add a property test guarding the new behavior
4. For new adapters, include at least one mock-fetch test

## Tests

```bash
cd packages/core
pnpm test          # vitest run
pnpm test:watch    # watch mode
```

## Build

```bash
pnpm build         # tsup → dist/
```

## Releasing

Releases are managed via Changesets (TODO). For 0.x phase, manual versioning in `package.json` + `CHANGELOG.md`.

```bash
pnpm build
npm publish --access public  # scoped package requires --access public
```

## Invariants

PRs that break the three documented invariants (stream-equivalence / partial-safe / abort-no-loss) will not be merged without explicit versioning rationale.
