import type { Creator } from "@/data/creators";
import { isActiveDashboardDeal, type Deal, type Platform } from "@/data/deals";

export type CreatorDealMatchMethod = "handle" | "email" | "name" | "fuzzy";

export type CreatorDealMatch = {
  deal: Deal;
  method: CreatorDealMatchMethod;
  confidence: number;
  matchedAlias: string;
};

export type CreatorPerformance = {
  creator: Creator;
  displayName: string;
  aliases: string[];
  matches: CreatorDealMatch[];
  totalDealValue: number;
  liveDealValue: number;
  totalDeals: number;
  liveDeals: number;
  avgDealValue: number;
  highestValueDeal: Deal | null;
  platformMix: Array<{ platform: Platform; count: number; value: number }>;
  topBrands: Array<{ brand: string; value: number; deals: number }>;
};

export type CreatorMatchingDiagnostics = {
  unmatchedExclusiveCreators: Array<{ creator: string; aliases: string[] }>;
  fuzzyMatchedDeals: Array<{
    dealCreator: string;
    matchedCreator: string;
    brand: string;
    confidence: number;
  }>;
  possibleDuplicateCreators: Array<{ creators: string[]; sharedAlias: string }>;
  dealCreatorsWithoutExclusiveMatch: Array<{ dealCreator: string; brand: string; value: number }>;
};

export type ExclusiveCreatorPerformanceResult = {
  all: CreatorPerformance[];
  topFive: CreatorPerformance[];
  diagnostics: CreatorMatchingDiagnostics;
};

type CreatorIndexEntry = {
  creator: Creator;
  displayName: string;
  handleAliases: Set<string>;
  emailAliases: Set<string>;
  nameAliases: Set<string>;
  allAliases: Set<string>;
};

const LIVE_DEAL_STATUSES = new Set(["Posted"]);

export function isLiveDeal(deal: Deal) {
  return LIVE_DEAL_STATUSES.has(deal.status);
}

function normalizeBasic(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function normalizeAlias(value: string) {
  return normalizeBasic(value)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^@+/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function normalizeName(value: string) {
  return normalizeBasic(value)
    .replace(/^@+/, "")
    .replace(/[._-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addAlias(target: Set<string>, value?: string) {
  if (!value) return;
  const alias = normalizeAlias(value);
  if (alias.length >= 2) target.add(alias);
}

function addNameAlias(target: Set<string>, value?: string) {
  if (!value) return;
  const name = normalizeName(value);
  if (name.length >= 2) target.add(name);
}

function extractSocialHandle(value?: string) {
  if (!value) return "";
  const cleaned = normalizeBasic(value).trim();
  const withoutProtocol = cleaned.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const directHandle = withoutProtocol.match(/^@?([a-z0-9._-]{2,})$/i)?.[1];
  if (directHandle) return normalizeAlias(directHandle);

  const socialMatch = withoutProtocol.match(
    /(?:tiktok\.com\/@|instagram\.com\/|youtube\.com\/@|youtube\.com\/c\/|youtube\.com\/channel\/)([a-z0-9._-]+)/i,
  );
  if (socialMatch?.[1]) return normalizeAlias(socialMatch[1]);

  return "";
}

function displayCreatorName(creator: Creator) {
  return (
    creator.handle ||
    creator.email ||
    creator.tiktokLink ||
    creator.instagramLink ||
    "Unknown creator"
  );
}

function buildCreatorIndex(creators: Creator[]) {
  return creators
    .filter((creator) => creator.relationship === "Exclusive")
    .map((creator): CreatorIndexEntry => {
      const displayName = displayCreatorName(creator);
      const handleAliases = new Set<string>();
      const emailAliases = new Set<string>();
      const nameAliases = new Set<string>();
      const allAliases = new Set<string>();

      for (const value of [
        creator.handle,
        creator.tiktokLink,
        creator.instagramLink,
        creator.youtubeLink,
      ]) {
        addAlias(handleAliases, value);
        addAlias(handleAliases, extractSocialHandle(value));
      }

      addAlias(emailAliases, creator.email);

      for (const value of [
        creator.handle,
        extractSocialHandle(creator.tiktokLink),
        extractSocialHandle(creator.instagramLink),
        extractSocialHandle(creator.youtubeLink),
      ]) {
        addNameAlias(nameAliases, value);
      }

      for (const set of [handleAliases, emailAliases, nameAliases]) {
        for (const alias of set) allAliases.add(alias);
      }

      return { creator, displayName, handleAliases, emailAliases, nameAliases, allAliases };
    });
}

function getDealAliases(deal: Deal) {
  const handleAliases = new Set<string>();
  const nameAliases = new Set<string>();

  addAlias(handleAliases, deal.creator);
  addAlias(handleAliases, extractSocialHandle(deal.creator));
  addNameAlias(nameAliases, deal.creator);
  addNameAlias(nameAliases, extractSocialHandle(deal.creator));

  return { handleAliases, nameAliases };
}

function intersectionValue(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) return value;
  }

  return "";
}

function levenshteinDistance(left: string, right: string) {
  const a = left.length < right.length ? left : right;
  const b = left.length < right.length ? right : left;
  const previous = Array.from({ length: a.length + 1 }, (_, index) => index);

  for (let bIndex = 1; bIndex <= b.length; bIndex += 1) {
    let previousDiagonal = previous[0];
    previous[0] = bIndex;

    for (let aIndex = 1; aIndex <= a.length; aIndex += 1) {
      const temp = previous[aIndex];
      previous[aIndex] = Math.min(
        previous[aIndex] + 1,
        previous[aIndex - 1] + 1,
        previousDiagonal + (a[aIndex - 1] === b[bIndex - 1] ? 0 : 1),
      );
      previousDiagonal = temp;
    }
  }

  return previous[a.length];
}

function nameSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorterLength = Math.min(left.length, right.length);
  const longerLength = Math.max(left.length, right.length);
  if (shorterLength < 4 || longerLength === 0) return 0;

  const containsScore =
    left.includes(right) || right.includes(left) ? shorterLength / longerLength : 0;
  const distanceScore = 1 - levenshteinDistance(left, right) / longerLength;

  return Math.max(containsScore, distanceScore);
}

function findBestMatch(deal: Deal, creatorIndex: CreatorIndexEntry[]) {
  const dealAliases = getDealAliases(deal);

  for (const entry of creatorIndex) {
    const matchedAlias = intersectionValue(dealAliases.handleAliases, entry.handleAliases);
    if (matchedAlias) {
      return { entry, method: "handle" as const, confidence: 1, matchedAlias };
    }
  }

  for (const entry of creatorIndex) {
    const matchedAlias = intersectionValue(dealAliases.handleAliases, entry.emailAliases);
    if (matchedAlias) {
      return { entry, method: "email" as const, confidence: 1, matchedAlias };
    }
  }

  for (const entry of creatorIndex) {
    const matchedAlias = intersectionValue(dealAliases.nameAliases, entry.nameAliases);
    if (matchedAlias) {
      return { entry, method: "name" as const, confidence: 0.98, matchedAlias };
    }
  }

  const fuzzyCandidates = creatorIndex
    .flatMap((entry) =>
      [...dealAliases.nameAliases].flatMap((dealName) =>
        [...entry.nameAliases].map((creatorName) => ({
          entry,
          dealName,
          creatorName,
          confidence: nameSimilarity(dealName, creatorName),
        })),
      ),
    )
    .filter((candidate) => candidate.confidence >= 0.9)
    .sort((a, b) => b.confidence - a.confidence);

  const best = fuzzyCandidates[0];
  const second = fuzzyCandidates.find(
    (candidate) => candidate.entry.creator.id !== best?.entry.creator.id,
  );

  if (best && (!second || best.confidence - second.confidence >= 0.04)) {
    return {
      entry: best.entry,
      method: "fuzzy" as const,
      confidence: best.confidence,
      matchedAlias: best.creatorName,
    };
  }

  return null;
}

function groupPlatformMix(deals: Deal[]) {
  const map = new Map<Platform, { platform: Platform; count: number; value: number }>();

  for (const deal of deals) {
    const current = map.get(deal.platform) ?? {
      platform: deal.platform,
      count: 0,
      value: 0,
    };

    current.count += 1;
    current.value += deal.totalPricingGbp;
    map.set(deal.platform, current);
  }

  return [...map.values()].sort((a, b) => b.value - a.value || b.count - a.count);
}

function groupTopBrands(deals: Deal[]) {
  const map = new Map<string, { brand: string; value: number; deals: number }>();

  for (const deal of deals) {
    const brand = deal.brand || "Unknown brand";
    const current = map.get(brand) ?? { brand, value: 0, deals: 0 };
    current.value += deal.totalPricingGbp;
    current.deals += 1;
    map.set(brand, current);
  }

  return [...map.values()].sort((a, b) => b.value - a.value || b.deals - a.deals).slice(0, 5);
}

function findPossibleDuplicates(creatorIndex: CreatorIndexEntry[]) {
  const aliases = new Map<string, string[]>();

  for (const entry of creatorIndex) {
    for (const alias of entry.allAliases) {
      aliases.set(alias, [...(aliases.get(alias) ?? []), entry.displayName]);
    }
  }

  return [...aliases.entries()]
    .filter(([, creators]) => new Set(creators).size > 1)
    .map(([sharedAlias, creators]) => ({
      sharedAlias,
      creators: Array.from(new Set(creators)),
    }))
    .slice(0, 10);
}

export function buildExclusiveCreatorPerformance(
  creators: Creator[],
  deals: Deal[],
): ExclusiveCreatorPerformanceResult {
  const activeDeals = deals.filter(isActiveDashboardDeal);
  const creatorIndex = buildCreatorIndex(creators);
  const matchMap = new Map<string, CreatorDealMatch[]>();
  const dealCreatorsWithoutExclusiveMatch: CreatorMatchingDiagnostics["dealCreatorsWithoutExclusiveMatch"] =
    [];
  const fuzzyMatchedDeals: CreatorMatchingDiagnostics["fuzzyMatchedDeals"] = [];

  for (const deal of activeDeals) {
    if (!deal.creator) continue;

    const match = findBestMatch(deal, creatorIndex);
    if (!match) {
      dealCreatorsWithoutExclusiveMatch.push({
        dealCreator: deal.creator,
        brand: deal.brand,
        value: deal.totalPricingGbp,
      });
      continue;
    }

    const current = matchMap.get(match.entry.creator.id) ?? [];
    current.push({
      deal,
      method: match.method,
      confidence: match.confidence,
      matchedAlias: match.matchedAlias,
    });
    matchMap.set(match.entry.creator.id, current);

    if (match.method === "fuzzy") {
      fuzzyMatchedDeals.push({
        dealCreator: deal.creator,
        matchedCreator: match.entry.displayName,
        brand: deal.brand,
        confidence: Math.round(match.confidence * 100),
      });
    }
  }

  const all = creatorIndex
    .map((entry): CreatorPerformance => {
      const matches = matchMap.get(entry.creator.id) ?? [];
      const matchedDeals = matches.map((match) => match.deal);
      const liveDeals = matchedDeals.filter(isLiveDeal);
      const totalDealValue = matchedDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
      const liveDealValue = liveDeals.reduce((sum, deal) => sum + deal.totalPricingGbp, 0);
      const highestValueDeal =
        [...matchedDeals].sort((a, b) => b.totalPricingGbp - a.totalPricingGbp)[0] ?? null;

      return {
        creator: entry.creator,
        displayName: entry.displayName,
        aliases: [...entry.allAliases],
        matches,
        totalDealValue,
        liveDealValue,
        totalDeals: matchedDeals.length,
        liveDeals: liveDeals.length,
        avgDealValue: matchedDeals.length ? Math.round(totalDealValue / matchedDeals.length) : 0,
        highestValueDeal,
        platformMix: groupPlatformMix(matchedDeals),
        topBrands: groupTopBrands(matchedDeals),
      };
    })
    .sort(
      (a, b) =>
        b.totalDealValue - a.totalDealValue ||
        b.liveDealValue - a.liveDealValue ||
        a.displayName.localeCompare(b.displayName),
    );

  return {
    all,
    topFive: all.slice(0, 5),
    diagnostics: {
      unmatchedExclusiveCreators: all
        .filter((creator) => creator.totalDeals === 0)
        .map((creator) => ({ creator: creator.displayName, aliases: creator.aliases.slice(0, 6) }))
        .slice(0, 20),
      fuzzyMatchedDeals: fuzzyMatchedDeals.slice(0, 20),
      possibleDuplicateCreators: findPossibleDuplicates(creatorIndex),
      dealCreatorsWithoutExclusiveMatch: dealCreatorsWithoutExclusiveMatch.slice(0, 20),
    },
  };
}
