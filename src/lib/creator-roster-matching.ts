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
