# Testing Patterns

**Analysis Date:** 2026-07-29

## Test Framework

**Runner:**
- Vitest `^2.1.0` — declared as a devDependency in `apps/api/package.json`, `apps/web/package.json`. **Not present** in `apps/shop/package.json` or `packages/schemas/package.json` or `packages/utils/package.json` (no `vitest` dependency, no `test` script in those four packages).
- **No `vitest.config.ts` exists anywhere in the repo.** Vitest runs entirely on defaults (jsdom is NOT configured, so DOM-dependent tests would fail in `apps/web` unless a config is added). Both `apps/api` and `apps/web` invoke `vitest run` directly against default Node environment.

**Assertion Library:**
- Vitest's built-in `expect` (Chai/Jest-compatible API) — no separate assertion library.

**Run Commands:**
```bash
pnpm --filter @order/web test          # apps/web: vitest run (single pass)
pnpm --filter @order/web test:watch    # apps/web: vitest (watch mode)
pnpm --filter @order/api test          # apps/api: vitest run — currently 0 test files, exits with "no tests found"
turbo test                              # root: runs `test` task for every package that defines one (turbo.json)
```
- No coverage command/script configured anywhere (`--coverage` flag not wired into any package.json script).

## Test File Organization

**Location:**
- Colocated with source, NOT a separate `__tests__/` or `test/` directory: `apps/web/src/lib/menu-search.test.ts` sits next to `apps/web/src/lib/menu-search.ts`.

**Naming:**
- `<module-name>.test.ts` — matches the filename of the module under test exactly, swapping `.ts` for `.test.ts`.

**Current coverage reality (critical context for planning new work):**
- **Exactly one test file exists in the entire repository**: `apps/web/src/lib/menu-search.test.ts`, testing `apps/web/src/lib/menu-search.ts` (Vietnamese-aware fuzzy menu search/scoring logic).
- `apps/api` has zero test files despite Vitest being installed and a `test` script defined — NestJS modules, services, controllers, guards, entities, and the `GlobalExceptionFilter` are entirely untested today.
- `apps/shop` has no test tooling installed at all.
- `packages/schemas` and `packages/utils` have no test tooling installed at all — Zod schemas and the `apiOk` helper are untested (verified only by TypeScript compilation and manual/integration use).
- A comment in `packages/utils/src/index.ts:5` explicitly documents this history: a shared `packages/ui` package was rejected specifically because "repo có 0 test" (repo has 0 tests) — indicates the team is aware test coverage is minimal and uses that fact as a real constraint on refactoring decisions.

## Test Structure

**Suite Organization (actual pattern from `apps/web/src/lib/menu-search.test.ts`):**
```typescript
import { describe, expect, it } from 'vitest';
import { filterMenuBySearch, menuSearchScore } from './menu-search.ts';

const MENU = [
  { code: 'M001', name: 'Khoai tây lắc' },
  // ...fixture array defined once at top of file, reused across all `it` blocks
];

const names = (q: string) => filterMenuBySearch(MENU, q).map((i) => i.name);
// local helper wrapping the function under test, reducing repetition in assertions

describe('viết tắt', () => {
  it('ktl → khoai tây lắc', () => {
    expect(names('ktl')).toContain('Khoai tây lắc');
  });
  // ...
});

describe('gõ không dấu / đủ tên', () => { /* ... */ });
describe('xếp hạng và biên', () => { /* ... */ });
```

**Patterns:**
- `describe` blocks group by **behavior/scenario in Vietnamese**, not by function name (`'viết tắt'` = abbreviations, `'gõ không dấu / đủ tên'` = typing without diacritics, `'xếp hạng và biên'` = ranking and edge cases) — mirrors the business-language commenting style seen in `CONVENTIONS.md`. Follow this when writing new suites: group by user-facing behavior, describe titles in Vietnamese matching the domain language used elsewhere in the codebase.
- No `beforeEach`/`afterEach`/setup-teardown used — the single fixture array (`MENU`) is a plain module-level `const`, safe because the function under test is pure and doesn't mutate input.
- Assertions favor `toContain`, `toEqual`, `toBeNull`, `toBeGreaterThan` — direct value comparisons, no snapshot testing used anywhere.

## Mocking

**Framework:** None configured (no `vi.mock`, `jest.mock`, `sinon`, `msw`, or similar found anywhere in the repo).

**Patterns:**
- No mocking patterns exist yet — the one existing test (`menu-search.test.ts`) tests a pure function with no external dependencies (no DB, no HTTP, no React rendering).
- **When adding tests for NestJS services/controllers** (currently untested), there is no established in-repo pattern to follow for mocking `Repository<T>` (TypeORM) or `DataSource`. Introducing NestJS `Test.createTestingModule` + manual repository mocks (e.g. `{ provide: getRepositoryToken(Entity), useValue: mockRepo }`) would be a new pattern for this codebase — check with the team/plan before assuming a specific mocking library.
- **When adding tests for React components** (currently untested), no React Testing Library or similar is installed — `@testing-library/react` is absent from `apps/web/package.json` and `apps/shop/package.json`. Adding component tests requires first installing this dependency and configuring `jsdom` as the Vitest environment (via a new `vitest.config.ts`, since none exists).

**What to Mock:**
- Not established by precedent. Given the existing test only covers pure utility functions, the safest default for new tests is to mimic that: extract pure logic (parsing, formatting, business-rule calculations) into standalone functions in `lib/` (web/shop) or plain exported functions in service files (api), and unit test those directly without mocking, following the `menu-search.ts` model.

**What NOT to Mock:**
- N/A — no precedent.

## Fixtures and Factories

**Test Data:**
- Inline plain-object arrays defined at the top of the test file (see `MENU` constant above) — no factory library (`fishery`, `rosie`, etc.) or shared fixtures directory used.

**Location:**
- No shared fixtures directory exists. Test data lives inline in the single test file that needs it.

## Coverage

**Requirements:** None enforced — no coverage tool wired into any script, no CI gate found (no `.github/workflows` directory detected in this repo).

**View Coverage:**
```bash
# Not configured. To get coverage, would need: vitest run --coverage
# and installing @vitest/coverage-v8 (not currently a dependency anywhere).
```

## Test Types

**Unit Tests:**
- The only test type present. Scope: pure function logic (menu search/fuzzy-matching scoring in `apps/web/src/lib/menu-search.ts`).

**Integration Tests:**
- None exist. No supertest/NestJS e2e test setup for `apps/api` HTTP endpoints (no `test/app.e2e-spec.ts` or similar NestJS-standard e2e folder, despite this being a common NestJS convention — this project has NOT adopted it).

**E2E Tests:**
- Not used. No Playwright/Cypress config or dependency found anywhere in the repo.

## Common Patterns

**Async Testing:**
- No async test examples exist yet in the codebase (the one test file tests only synchronous pure functions). When testing NestJS services (which are async/Promise-based), use standard Vitest `async () => { ... }` test callbacks with `await` — no existing precedent to deviate from Vitest defaults.

**Error Testing:**
- No precedent for testing thrown exceptions exists yet. For future API tests, `expect(() => fn()).toThrow(...)` (sync) or `await expect(promise).rejects.toThrow(...)` (async) are the standard Vitest idioms to reach for, matching how NestJS controllers/services throw `HttpException` subclasses (`BadRequestException`, `ConflictException`, `NotFoundException`) per the error-handling conventions in `CONVENTIONS.md`.

---

*Testing analysis: 2026-07-29*
