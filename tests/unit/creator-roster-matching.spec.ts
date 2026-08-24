import { expect, test } from "@playwright/test";
import type { Creator } from "../../src/data/creators";
import type { CreatorProfile } from "../../src/lib/creator-profiles";
import {
  dedupeCurrentRosterExclusiveCreators,
  diagnoseUnmatchedRosterExclusives,
  matchCurrentRosterExclusiveProfileIds,
} from "../../src/lib/creator-roster-matching";
import { normalizeCreatorRows } from "../../src/lib/sheet-normalizer";

function creator(overrides: Partial<Creator>): Creator {
  return {
    id: "creator-1",
    handle: "creator",
    owner: "Team",
    platform: "TikTok",
    niche: "Lifestyle",
    followers: 0,
    relationship: "Exclusive",
    status: "Active",
    activeDeals: 0,
    revenue: 0,
    ...overrides,
  };
}

function profile(overrides: Partial<CreatorProfile>): CreatorProfile {
  return {
    creatorId: "profile-1",
    rowNumber: 2,
    creatorName: "creator",
    location: "United States",
    nicheTags: "Lifestyle",
    nicheDetail: "",
    mainPlatform: "TikTok",
    ttFollowing: 0,
    ttLink: "",
    instaFollowing: 0,
    instaLink: "",
    ytFollowing: 0,
    ytLink: "",
    analytics: "",
    type: "Partnered",
    exclusiveTier: "",
    talentManager: "",
    gender: "",
    active: true,
    reviewStatus: "Ready",
    dataIssues: "",
    sourceTabs: "",
    createdAt: "",
    updatedAt: "",
    updatedBy: "",
    ...overrides,
  };
}

test("exclusive matching rejects a shared social link when the profile belongs to another creator", () => {
  const profiles = [
    profile({
      creatorId: "profile-shandae",
      creatorName: "shadaenotadu",
      instaLink: "https://www.instagram.com/shadaenotadu/reels/",
    }),
  ];
  const currentRosterCreators = [
    creator({
      id: "creator-imjustagirl4930",
      handle: "imjustagirl4930",
      tiktokLink: "https://www.tiktok.com/@imjustagirl4930",
      instagramLink: "https://www.instagram.com/shadaenotadu/reels/",
    }),
    creator({
      id: "creator-shandae",
      handle: "shadaenotadu",
      relationship: "Non-exclusive",
      instagramLink: "https://www.instagram.com/shadaenotadu/reels/",
    }),
  ];

  expect(matchCurrentRosterExclusiveProfileIds(profiles, currentRosterCreators)).toEqual(new Set());
  expect(diagnoseUnmatchedRosterExclusives(profiles, currentRosterCreators)).toMatchObject([
    {
      creatorId: "creator-imjustagirl4930",
      creatorName: "imjustagirl4930",
      reason: "profile-name-conflict",
      matchedProfileNames: ["shadaenotadu"],
    },
  ]);
});

test("exclusive matching keeps roster exclusives when the profile name or handle matches", () => {
  const profiles = [
    profile({
      creatorId: "profile-kevnbianca",
      creatorName: "Kevnbianca",
      ttLink: "https://www.tiktok.com/@kevnbianca",
      instaLink: "https://www.instagram.com/kevnbianca/",
      ytLink: "https://www.youtube.com/@kevnbianca",
    }),
    profile({
      creatorId: "profile-planetpaulc",
      creatorName: "planetpaulc",
      ttLink: "https://www.tiktok.com/@planetpaulc",
    }),
  ];
  const currentRosterCreators = [
    creator({
      id: "creator-kevnbianca",
      handle: "kevnbianca",
      tiktokLink: "https://www.tiktok.com/@kevnbianca",
      instagramLink: "https://www.instagram.com/kevnbianca/",
      youtubeLink: "https://www.youtube.com/@kevnbianca",
    }),
    creator({
      id: "creator-planetpaulc",
      handle: "planetpaulc",
      tiktokLink: "https://www.tiktok.com/@planetpaulc",
    }),
  ];

  expect(matchCurrentRosterExclusiveProfileIds(profiles, currentRosterCreators)).toEqual(
    new Set(["profile-kevnbianca", "profile-planetpaulc"]),
  );
});

test("blank partnership type does not become exclusive", () => {
  const creators = normalizeCreatorRows([
    ["Creator", "Owner", "Main Platform", "Partnership Type"],
    ["blank-type-creator", "Team", "TikTok", ""],
    ["exclusive-creator", "Team", "TikTok", "Exclusive"],
    ["partner-creator", "Team", "TikTok", "Partner"],
  ]);

  expect(creators.map((row) => row.relationship)).toEqual([
    "Non-exclusive",
    "Exclusive",
    "Non-exclusive",
  ]);
});

test("current roster exclusives are deduped by social link first", () => {
  const creators = [
    creator({
      id: "creator-kevin-old",
      handle: "kevnbianca",
      followers: 100,
      tiktokLink: "https://www.tiktok.com/@kevnbianca",
    }),
    creator({
      id: "creator-kevin-complete",
      handle: "Kevnbianca",
      base: "United States",
      followers: 428_700,
      tiktokLink: "https://www.tiktok.com/@kevnbianca",
      instagramLink: "https://www.instagram.com/kevnbianca/",
      youtubeLink: "https://www.youtube.com/@kevnbianca",
    }),
  ];

  expect(dedupeCurrentRosterExclusiveCreators(creators).map((row) => row.id)).toEqual([
    "creator-kevin-complete",
  ]);
});

test("current roster exclusives are deduped by normalized handle when links differ", () => {
  const creators = [
    creator({
      id: "creator-paul-tiktok",
      handle: "planetpaulc",
      tiktokLink: "https://www.tiktok.com/@planetpaulc",
    }),
    creator({
      id: "creator-paul-instagram",
      handle: "Planet Paul C",
      instagramLink: "https://www.instagram.com/planetpaulc/",
    }),
    creator({
      id: "creator-other",
      handle: "differentcreator",
      tiktokLink: "https://www.tiktok.com/@differentcreator",
    }),
  ];

  expect(dedupeCurrentRosterExclusiveCreators(creators).map((row) => row.id)).toEqual([
    "creator-paul-tiktok",
    "creator-other",
  ]);
});
