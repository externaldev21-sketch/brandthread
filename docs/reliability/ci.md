# CI

`.github/workflows/ci.yml` runs on every pull request and push to `dev` / `main`. `.gitignore` excludes `.github/workflows/`, so the file was added with `git add -f`.

| Job | What it runs | Suggested as required? |
| --- | --- | --- |
| `typecheck` | `pnpm run typecheck` (shared libs, API server, mobile, portals, scripts) | Yes |
| `api-tests` | `pnpm --filter @workspace/api-server run test` against a throwaway Postgres 16 service container (`TEST_DATABASE_URL`) | Yes |
| `mobile-tests` | `pnpm --filter @workspace/mobile run test` | No. `continue-on-error` until the existing failures below are fixed |

## Baseline measured on dev @ `631b424`

- `pnpm run typecheck`: passes.
- API tests: the suites touched by the reliability PRs pass against a local Postgres 16 (rate limiting, password reset, communities). The full API suite was not run end to end.
- Mobile tests: 345 of 375 files pass; 30 files / 35 tests fail on an untouched `dev`. Failures: `SyntaxError: Unexpected token 'typeof'` and `Parse failure: Expected 'from', got 'typeOf'` in native-module imports, `Cannot read properties of undefined (reading 'EventEmitter')` from `expo-modules-core`, all of `services/aiService.test.ts`, `tests/no-hardcoded-theme-color-lint.test.ts`, the source check in `lib/__tests__/devPreview.test.ts`, and `tests/buyer-bottom-navigation-layout.test.ts`. They may be specific to the sandbox this was measured in; the first CI run will show whether they fail there too.

## Notes

Dev approved running this. The workflow uses only `actions/checkout`, `actions/setup-node` and `pnpm/action-setup`, and needs no secrets. The API tests use a database created inside the job, never a real one. Optionally add `typecheck` and `api-tests` as required checks under Settings -> Branches. Pushing a workflow file needs a credential with `workflow` scope.
