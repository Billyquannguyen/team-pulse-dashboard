import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type CapabilityExpectation = {
  file: string;
  exportName: string;
  guard: "requireDashboardAuth" | "requireWritableDashboardAuth" | "requireAdminAuth";
};

const memberCapabilities: CapabilityExpectation[] = [
  { file: "src/lib/apollo.ts", exportName: "searchApolloContacts", guard: "requireDashboardAuth" },
  { file: "src/lib/apollo.ts", exportName: "enrichApolloContacts", guard: "requireDashboardAuth" },
  {
    file: "src/lib/contact-database.ts",
    exportName: "addContactDatabaseContact",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/contact-database.ts",
    exportName: "updateContactDatabaseContact",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/contact-database.ts",
    exportName: "deleteContactDatabaseContact",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/contact-database.ts",
    exportName: "upsertContactDatabaseContacts",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/contact-database.ts",
    exportName: "deduplicateContactDatabase",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/contract-review.ts",
    exportName: "reviewContractPdf",
    guard: "requireDashboardAuth",
  },
  {
    file: "src/lib/creator-profiles.ts",
    exportName: "createCreatorProfile",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/creator-profiles.ts",
    exportName: "updateCreatorProfile",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/bulk-sender.ts",
    exportName: "submitBulkSenderJob",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/bulk-follow-up.ts",
    exportName: "fetchGmailFollowUpLabels",
    guard: "requireDashboardAuth",
  },
  {
    file: "src/lib/bulk-follow-up.ts",
    exportName: "fetchFollowUpCandidates",
    guard: "requireDashboardAuth",
  },
  {
    file: "src/lib/bulk-follow-up.ts",
    exportName: "saveFollowUpTemplate",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/bulk-follow-up-queue.ts",
    exportName: "submitBulkFollowUpJob",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/billy-assistant-hub.ts",
    exportName: "saveMeetingTopic",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/notion-knowledge.ts",
    exportName: "askBillyGpt",
    guard: "requireDashboardAuth",
  },
  {
    file: "src/lib/slack-notifications.ts",
    exportName: "markSlackNotificationDone",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/slack-notifications.ts",
    exportName: "dismissSlackNotification",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/slack-notifications.ts",
    exportName: "snoozeSlackNotification",
    guard: "requireWritableDashboardAuth",
  },
  {
    file: "src/lib/team-members.ts",
    exportName: "updateTeamMemberProfile",
    guard: "requireWritableDashboardAuth",
  },
];

const adminCapabilities: CapabilityExpectation[] = [
  { file: "src/lib/goal-settings.ts", exportName: "saveGoalSettings", guard: "requireAdminAuth" },
  {
    file: "src/lib/team-assets.ts",
    exportName: "addTeamAssetLink",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/team-assets.ts",
    exportName: "updateTeamAssetLink",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/team-assets.ts",
    exportName: "removeTeamAssetLink",
    guard: "requireAdminAuth",
  },
  { file: "src/lib/team-members.ts", exportName: "addTeamMember", guard: "requireAdminAuth" },
  {
    file: "src/lib/team-members.ts",
    exportName: "updateTeamMember",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/team-members.ts",
    exportName: "offboardTeamMember",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/bulk-follow-up.ts",
    exportName: "deleteFollowUpTemplate",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/bulk-follow-up-queue.ts",
    exportName: "fetchBulkFollowUpAudit",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/notion-knowledge.ts",
    exportName: "syncNotionKnowledge",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/slack-notifications.ts",
    exportName: "createTestSlackNotification",
    guard: "requireAdminAuth",
  },
  {
    file: "src/lib/slack-notifications.ts",
    exportName: "forceRefreshSlackNotifications",
    guard: "requireAdminAuth",
  },
];

function exportedCapabilitySource(file: string, exportName: string) {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const startMarker = `export const ${exportName}`;
  const start = source.indexOf(startMarker);
  expect(start, `${startMarker} should exist in ${file}`).toBeGreaterThanOrEqual(0);
  const nextExport = source.indexOf("\nexport const ", start + startMarker.length);
  return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

for (const capability of memberCapabilities) {
  test(`${capability.exportName} remains available to approved members`, () => {
    const source = exportedCapabilitySource(capability.file, capability.exportName);
    expect(source).toContain(capability.guard);
    expect(source).not.toContain("requireAdminAuth");
  });
}

for (const capability of adminCapabilities) {
  test(`${capability.exportName} remains an admin operation`, () => {
    const source = exportedCapabilitySource(capability.file, capability.exportName);
    expect(source).toContain(capability.guard);
  });
}

test("monthly opportunity refresh remains an admin-triggered team operation", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/monthly-opportunity-refresh-start.server.ts"),
    "utf8",
  );
  expect(source).toContain("startMonthlyOpportunityRefreshServer");
  expect(source).toContain("requireAdminAuth");
});
