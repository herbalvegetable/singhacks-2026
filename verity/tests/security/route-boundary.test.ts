import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const protectedRoutes = [
  "app/api/audit/citation/route.ts",
  "app/api/chat/route.ts",
  "app/api/chat/openers/route.ts",
  "app/api/narrative/[signalId]/route.ts",
  "app/api/diversify/[signalId]/route.ts",
  "app/api/priorities/route.ts",
  "app/api/decisions/route.ts",
] as const;

test("protected route handlers authenticate before sensitive work", () => {
  for (const path of protectedRoutes) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const handlers = source
      .split(/(?=export async function (?:GET|POST|PUT|PATCH|DELETE))/)
      .filter((part) => part.startsWith("export async function"));
    assert.ok(handlers.length > 0, `${path} has no route handlers`);
    for (const handler of handlers) {
      const auth = handler.indexOf("await requireApiSession()");
      const firstDatabaseOrAgent = handler.search(
        /\b(?:new Repository|getDb|answerClientQuestion|generate[A-Z]|resolveDecisionTarget)\b/,
      );
      assert.ok(auth >= 0, `${path} has a handler without requireApiSession`);
      if (firstDatabaseOrAgent >= 0) {
        assert.ok(
          firstDatabaseOrAgent > auth,
          `${path} accesses protected work before authentication`,
        );
      }
    }
  }
});

test("protected pages authenticate before database access", () => {
  for (const path of ["app/page.tsx", "app/client/[clientId]/page.tsx"]) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const auth = source.indexOf("await requirePageSession()");
    const database = source
      .slice(auth)
      .search(/\b(?:new Repository|getDb)\b/);
    assert.ok(auth > 0, `${path} is missing requirePageSession`);
    assert.ok(database > 0, `${path} opens the database before authentication`);
  }
});
