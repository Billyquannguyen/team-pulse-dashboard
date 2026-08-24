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

function compactIdentity(value?: string) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function socialUsername(value?: string) {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";

  try {
    const withProtocol = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, "");
    const segments = url.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) return "";

    if (host.includes("tiktok.com")) {
      return compactIdentity(segments.find((segment) => segment.startsWith("@")) ?? segments[0]);
    }

    if (host.includes("instagram.com")) {
      return compactIdentity(segments[0]);
    }

    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      const handle = segments.find((segment) => segment.startsWith("@"));
      return compactIdentity(handle ?? segments.at(-1));
    }

    return "";
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

function creatorCompletenessScore(creator: Creator) {
  const socialScore = creatorSocialKeys(creator).length * 1_000_000;
  const followerScore = creator.followers;
  const profileScore =
    Number(Boolean(creator.base?.trim())) * 10_000 +
    Number(Boolean(creator.niche?.trim())) * 10_000 +
    Number(Boolean(creator.owner?.trim())) * 1_000;
  return socialScore + followerScore + profileScore;
}

function creatorSocialLinks(creator: Creator) {
  return [
    { platform: "TikTok", url: creator.tiktokLink },
    { platform: "Instagram", url: creator.instagramLink },
    { platform: "YouTube", url: creator.youtubeLink },
  ].filter((link): link is { platform: string; url: string } => Boolean(link.url?.trim()));
}

function profileSocialKeys(profile: CreatorProfile) {
  return [
    normalizedSocialKey("tiktok", profile.ttLink),
    normalizedSocialKey("instagram", profile.instaLink),
    normalizedSocialKey("youtube", profile.ytLink),
  ].filter(Boolean);
}

function creatorIdentityKeys(creator: Creator) {
  return [compactIdentity(creator.handle), compactIdentity(creator.id)].filter(Boolean);
}

export function dedupeCurrentRosterExclusiveCreators(currentCreators: Creator[]) {
  const result: Creator[] = [];
  currentCreators
    .filter((creator) => creator.relationship === "Exclusive")
    .forEach((creator) => {
      const socialKeys = creatorSocialKeys(creator);
      const identityKeys = creatorIdentityKeys(creator);
      const duplicateIndex = result.findIndex((existing) => {
        const existingSocialKeys = creatorSocialKeys(existing);
        const existingIdentityKeys = creatorIdentityKeys(existing);
        return (
          socialKeys.some((key) => existingSocialKeys.includes(key)) ||
          identityKeys.some((key) => existingIdentityKeys.includes(key))
        );
      });

      if (duplicateIndex >= 0) {
        const existing = result[duplicateIndex];
        if (creatorCompletenessScore(creator) > creatorCompletenessScore(existing)) {
          result[duplicateIndex] = creator;
        }
      } else {
        result.push(creator);
      }
    });

  return result;
}

function profileIdentityKeys(profile: CreatorProfile) {
  return [
    compactIdentity(profile.creatorName),
    compactIdentity(profile.creatorId),
    socialUsername(profile.ttLink),
    socialUsername(profile.instaLink),
    socialUsername(profile.ytLink),
  ].filter(Boolean);
}

function isLikelySameCreator(creator: Creator, profile: CreatorProfile) {
  const profileKeys = new Set(profileIdentityKeys(profile));
  return creatorIdentityKeys(creator).some((key) => profileKeys.has(key));
}

function profileMatchesRosterCreator(profile: CreatorProfile, creator: Creator) {
  const profileKeys = profileSocialKeys(profile);
  if (profileKeys.length === 0) return false;
  return (
    creatorSocialKeys(creator).some((key) => profileKeys.includes(key)) &&
    isLikelySameCreator(creator, profile)
  );
}

export function findMatchingRosterCreatorProfile(
  profiles: CreatorProfile[],
  creator: Creator,
): CreatorProfile | undefined {
  return profiles.find((profile) => profileMatchesRosterCreator(profile, creator));
}

export type UnmatchedRosterExclusive = {
  creatorId: string;
  creatorName: string;
  reason: "missing-social-link" | "no-matching-profile" | "profile-name-conflict";
  rosterLinks: Array<{ platform: string; url: string }>;
  matchedProfileNames?: string[];
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
  return currentCreators
    .filter((creator) => creator.relationship === "Exclusive")
    .flatMap((creator) => {
      const socialKeys = creatorSocialKeys(creator);
      if (socialKeys.length === 0) {
        return [
          {
            creatorId: creator.id,
            creatorName: creator.handle || creator.id,
            reason: "missing-social-link",
            rosterLinks: [],
          } satisfies UnmatchedRosterExclusive,
        ];
      }

      const profilesWithSharedLinks = profiles.filter((profile) =>
        profileSocialKeys(profile).some((key) => socialKeys.includes(key)),
      );
      if (profilesWithSharedLinks.some((profile) => isLikelySameCreator(creator, profile))) {
        return [];
      }

      return [
        {
          creatorId: creator.id,
          creatorName: creator.handle || creator.id,
          reason:
            profilesWithSharedLinks.length > 0 ? "profile-name-conflict" : "no-matching-profile",
          rosterLinks: creatorSocialLinks(creator),
          matchedProfileNames: profilesWithSharedLinks.map(
            (profile) => profile.creatorName || profile.creatorId,
          ),
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
    const matchedRosterNames = Array.from(
      new Set(
        exclusiveCreators
          .filter((creator) => profileMatchesRosterCreator(profile, creator))
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
  const exclusiveCreators = currentCreators.filter((creator) => creator.relationship === "Exclusive");

  return new Set(
    profiles
      .filter((profile) =>
        exclusiveCreators.some((creator) => profileMatchesRosterCreator(profile, creator)),
      )
      .map((profile) => profile.creatorId),
  );
}
