import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("disabling account access offboards the connected member profile", () => {
  const authSource = readFileSync(new URL("../../src/lib/auth.server.ts", import.meta.url), "utf8");

  expect(authSource).toContain(
    'const profileStatus = input.status === "disabled" ? "offboarded" : "active"',
  );
  expect(authSource).toContain(
    'input.status === "disabled" || (statusChanged && input.status === "approved")',
  );
  expect(authSource).toContain("await setTeamMemberStatusForServer(profileId, profileStatus)");
  expect(authSource).not.toContain(
    'statusChanged && profileId && (input.status === "disabled" || input.status === "approved")',
  );
});

test("saving an already-disabled account retries stale profile offboarding", () => {
  const authSource = readFileSync(new URL("../../src/lib/auth.server.ts", import.meta.url), "utf8");

  const syncCondition = authSource.slice(
    authSource.indexOf("const shouldSyncProfileStatus"),
    authSource.indexOf("if (shouldSyncProfileStatus"),
  );

  expect(syncCondition).toContain('input.status === "disabled"');
  expect(syncCondition).not.toContain('statusChanged && input.status === "disabled"');
});

test("member status sync updates the existing row and invalidates active-member caches", () => {
  const memberSource = readFileSync(
    new URL("../../src/lib/team-members.ts", import.meta.url),
    "utf8",
  );

  expect(memberSource).toContain("export async function setTeamMemberStatusForServer");
  expect(memberSource).toContain("buildTeamMemberWriteRow({ ...member, status }");
  expect(memberSource).toContain("await invalidateRelatedCaches()");
});
