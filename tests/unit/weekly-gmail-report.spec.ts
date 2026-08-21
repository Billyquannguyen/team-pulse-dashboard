import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { MissingMemberTagCandidate } from "../../src/lib/ai/weekly-outreach-report.server";
import type { Creator } from "../../src/data/creators";
import {
  findMentionedExclusiveCreators,
  getReportWindow,
} from "../../src/lib/weekly-gmail-outreach-report.server";

function creator(overrides: Partial<Creator>): Creator {
  return {
    id: "CR-1",
    handle: "Eden Faith",
    owner: "Kim Trang",
    platform: "TikTok",
    niche: "Lifestyle",
    tiktokLink: "https://www.tiktok.com/@tomiwatp",
    instagramLink: "https://www.instagram.com/_edenfaith/",
    followers: 0,
    relationship: "Exclusive",
    status: "Active",
    activeDeals: 0,
    revenue: 0,
    ...overrides,
  };
}

function candidate(emailText: string): MissingMemberTagCandidate {
  return {
    candidateId: "thread-1",
    from: "brand@example.com",
    subject: "Campaign update",
    receivedAt: "2026-08-20T10:00:00.000Z",
    emailText,
  };
}

test("weekly report uses completed Vietnam calendar days", () => {
  const window = getReportWindow(7, new Date("2026-08-21T17:15:00.000Z"));

  expect(new Date(window.startMs).toISOString()).toBe("2026-08-14T17:00:00.000Z");
  expect(new Date(window.endMs).toISOString()).toBe("2026-08-21T17:00:00.000Z");
});

test("exclusive creator detection uses the dashboard creator name", () => {
  const matches = findMentionedExclusiveCreators(
    [candidate("We would like to book Eden Faith for the September campaign.")],
    [creator({ owner: "Kim Trang" })],
  );

  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({
    creatorId: "CR-1",
    creatorName: "Eden Faith",
    ownerName: "Kim Trang",
  });
});

test("creator social handles are valid aliases but partnered creators are excluded", () => {
  const matches = findMentionedExclusiveCreators(
    [candidate("Could you confirm whether @tomiwatp is available?")],
    [
      creator({ id: "CR-exclusive" }),
      creator({
        id: "CR-partnered",
        handle: "Other",
        relationship: "Non-exclusive",
      }),
    ],
  );

  expect(matches.map((match) => match.creatorId)).toEqual(["CR-exclusive"]);
});

test("weekly tagging reads the dashboard creator source, not Creator Profiles", () => {
  const source = readFileSync(
    new URL("../../src/lib/weekly-gmail-outreach-report.server.ts", import.meta.url),
    "utf8",
  );
  const signedCreatorSource = readFileSync(
    new URL("../../src/lib/signed-creators.server.ts", import.meta.url),
    "utf8",
  );

  expect(source).toContain("getExclusiveDashboardCreatorsForServer");
  expect(source).not.toContain('from "@/lib/creator-profiles"');
  expect(signedCreatorSource).toContain("config.creatorSourcingSpreadsheetId");
  expect(signedCreatorSource).not.toContain("TEAM_ASSETS_SPREADSHEET_ID");
});

test("weekly overview assigns overdue replies to Brand inbound and missing tags to tagging", () => {
  const source = readFileSync(
    new URL("../../src/lib/weekly-gmail-outreach-report.server.ts", import.meta.url),
    "utf8",
  );

  expect(source).toContain("memberMetrics.invalidTaggingThreads += 1");
  expect(source).toContain(
    "item.missedInbound = scan.unresolvedByMember.get(item.member.id) ?? 0",
  );
  expect(source).toContain(
    "Brand inbound chưa xử lý (đã tag, chưa reply >48 giờ, AI xác nhận)",
  );
  expect(source).toContain("Tagging sai quy tắc (thiếu member tag)");
  expect(source).not.toContain("Calendly booked");
});
