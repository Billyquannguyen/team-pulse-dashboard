import { expect, test } from "@playwright/test";
import {
  buildLeaderboardData,
  scopeDashboardDataForMember,
  type DashboardSheetData,
} from "../../src/lib/sheets-public";

function dashboardFixture() {
  const data = {
    team: [
      {
        id: "KTrang",
        name: "Kim Trang",
        initials: "KT",
        role: "Outreach",
        worksheetName: "KTrang",
        commission: 100,
        paidCommission: 80,
        monthCommission: 40,
        pendingOwed: 20,
        dealsClosed: 1,
        revenue: 1_000,
        revenueGoal: 2_000,
        dealsGoal: 2,
        exclusiveCreators: 1,
        nonExclusiveCreators: 0,
      },
      {
        id: "HYen",
        name: "Hoang Yen",
        initials: "HY",
        role: "Outreach",
        worksheetName: "HYen",
        commission: 200,
        paidCommission: 160,
        monthCommission: 60,
        pendingOwed: 40,
        dealsClosed: 1,
        revenue: 2_000,
        revenueGoal: 3_000,
        dealsGoal: 3,
        exclusiveCreators: 1,
        nonExclusiveCreators: 0,
      },
    ],
    deals: [
      {
        id: "deal-ktrang",
        manager: "KTrang",
        brand: "Private K brand",
        creator: "Creator K",
        totalPricingGbp: 1_000,
        creatorTotalGbp: 500,
        managerTotalGbp: 100,
        profitMargin: "50%",
        status: "Posted",
      },
      {
        id: "deal-hyen",
        manager: "HYen",
        brand: "Private H brand",
        creator: "Creator H",
        totalPricingGbp: 2_000,
        creatorTotalGbp: 1_000,
        managerTotalGbp: 200,
        profitMargin: "50%",
        status: "Posted",
      },
    ],
    creators: [
      { id: "creator-k", handle: "Creator K", owner: "KTrang", relationship: "Exclusive" },
      { id: "creator-h", handle: "Creator H", owner: "HYen", relationship: "Exclusive" },
    ],
    outreach: {
      members: [
        {
          memberName: "KTrang",
          initials: "KT",
          totalCreators: 20,
          contacted: 20,
          emailed: 20,
          igOutreach: 0,
          replies: 5,
          bookedCalls: 2,
          signed: 1,
          ended: 0,
          replyRate: 25,
          bookingRate: 10,
          callClosingRate: 50,
          overallClosingRate: 5,
          conversionRate: 5,
          topNiche: "Beauty",
        },
        {
          memberName: "HYen",
          initials: "HY",
          totalCreators: 30,
          contacted: 30,
          emailed: 30,
          igOutreach: 0,
          replies: 6,
          bookedCalls: 3,
          signed: 2,
          ended: 0,
          replyRate: 20,
          bookingRate: 10,
          callClosingRate: 67,
          overallClosingRate: 7,
          conversionRate: 7,
          topNiche: "Fitness",
        },
      ],
      totals: {},
      source: "google-sheet",
    },
    totals: {},
    source: "google-sheet",
    links: {},
    updatedAt: "2026-08-16T00:00:00.000Z",
  } as unknown as DashboardSheetData;

  return data;
}

test("a linked member receives only their detailed rows", () => {
  const scoped = scopeDashboardDataForMember(dashboardFixture(), "KTrang");

  expect(scoped.team.map((member) => member.id)).toEqual(["KTrang"]);
  expect(scoped.deals.map((deal) => deal.id)).toEqual(["deal-ktrang"]);
  expect(scoped.creators.map((creator) => creator.id)).toEqual(["creator-k"]);
  expect(scoped.outreach.members.map((member) => member.memberName)).toEqual(["KTrang"]);
  expect(JSON.stringify(scoped)).not.toContain("Private H brand");
});

test("an approved account without a member link receives no personal rows", () => {
  const scoped = scopeDashboardDataForMember(dashboardFixture(), null);

  expect(scoped.team).toEqual([]);
  expect(scoped.deals).toEqual([]);
  expect(scoped.creators).toEqual([]);
  expect(scoped.outreach.members).toEqual([]);
});

test("leaderboard output contains summaries for all members without raw deal details", () => {
  const leaderboard = buildLeaderboardData(dashboardFixture());

  expect(leaderboard).toHaveLength(2);
  expect(leaderboard.find((member) => member.id === "KTrang")?.profit).toBe(500);
  expect(JSON.stringify(leaderboard)).not.toContain("Private K brand");
  expect(JSON.stringify(leaderboard)).not.toContain("Private H brand");
});
