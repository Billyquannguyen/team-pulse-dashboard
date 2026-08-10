import type { Creator } from "@/data/creators";
import type { CreatorProfile } from "@/lib/creator-profiles";

function normalizedSocialKey(platform: string, value?: string) {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";

  try {
    const withProtocol = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    if (!host || !path) return "";
    return `${platform}:${host}${path}`;
  } catch {
    return "";
  }
}

function creatorSocialKeys(creator: Creator) {
  return [
    normalizedSocialKey("tiktok", creator.tiktokLink),
    normalizedSocialKey("instagram", creator.instagramLink),
    normalizedSocialKey("youtube", creator.youtubeLink),
  ].filter(Boolean);
}

function profileSocialKeys(profile: CreatorProfile) {
  return [
    normalizedSocialKey("tiktok", profile.ttLink),
    normalizedSocialKey("instagram", profile.instaLink),
    normalizedSocialKey("youtube", profile.ytLink),
  ].filter(Boolean);
}

export type UnmatchedRosterExclusive = {
  creatorId: string;
  creatorName: string;
  reason: "missing-social-link" | "no-matching-profile";
};

export type RosterExclusiveProfileConflict = {
  profileId: string;
  profileName: string;
  rosterCreatorNames: string[];
};

export function diagnoseUnmatchedRosterExclusives(
  profiles: CreatorProfile[],
  currentCreators: Creator[],
): UnmatchedRosterExclusive[] {
  const profileKeys = new Set(profiles.flatMap(profileSocialKeys));

  return currentCreators
    .filter((creator) => creator.relationship === "Exclusive")
    .flatMap((creator) => {
      const socialKeys = creatorSocialKeys(creator);
      if (socialKeys.some((key) => profileKeys.has(key))) return [];

      return [
        {
          creatorId: creator.id,
          creatorName: creator.handle || creator.id,
          reason: socialKeys.length === 0 ? "missing-social-link" : "no-matching-profile",
        } satisfies UnmatchedRosterExclusive,
      ];
    });
}

export function diagnoseRosterExclusiveProfileConflicts(
  profiles: CreatorProfile[],
  currentCreators: Creator[],
): RosterExclusiveProfileConflict[] {
  const exclusiveCreators = currentCreators.filter(
    (creator) => creator.relationship === "Exclusive",
  );

  return profiles.flatMap((profile) => {
    const profileKeys = profileSocialKeys(profile);
    const matchedRosterNames = Array.from(
      new Set(
        exclusiveCreators
          .filter((creator) => creatorSocialKeys(creator).some((key) => profileKeys.includes(key)))
          .map((creator) => creator.handle || creator.id),
      ),
    );

    if (matchedRosterNames.length < 2) return [];
    return [
      {
        profileId: profile.creatorId,
        profileName: profile.creatorName,
        rosterCreatorNames: matchedRosterNames,
      },
    ];
  });
}

export function matchCurrentRosterExclusiveProfileIds(
  profiles: CreatorProfile[],
  currentCreators: Creator[],
) {
  const exclusiveSocialKeys = new Set(
    currentCreators
      .filter((creator) => creator.relationship === "Exclusive")
      .flatMap(creatorSocialKeys),
  );

  return new Set(
    profiles
      .filter((profile) => profileSocialKeys(profile).some((key) => exclusiveSocialKeys.has(key)))
      .map((profile) => profile.creatorId),
  );
}
