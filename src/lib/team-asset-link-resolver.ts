import type { AssetLink } from "@/data/assets";

export const CONTRACT_REVIEW_GPT_ASSET_TITLE = "Contract Review GPT";
export const CREATOR_BRAND_MATCHING_GPT_ASSET_TITLE = "Creator–Brand Matching GPT";

export type ExternalGptAssetLink = {
  source: "Team Assets";
  expectedTitle: string;
  configured: boolean;
  url: string | null;
  assetTitle: string | null;
};

function normalizeAssetTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—-]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveAssetUrlByTitle(assets: AssetLink[], expectedTitle: string): ExternalGptAssetLink {
  const expectedKey = normalizeAssetTitle(expectedTitle);
  const asset =
    assets.find((item) => normalizeAssetTitle(item.title) === expectedKey) ??
    assets.find((item) => normalizeAssetTitle(item.title).includes(expectedKey));
  const url = asset?.url?.trim() || null;

  return {
    source: "Team Assets",
    expectedTitle,
    configured: Boolean(url),
    url,
    assetTitle: asset?.title ?? null,
  };
}

export function resolveExternalGptLinksFromTeamAssets(assets: AssetLink[]) {
  return {
    contractReview: resolveAssetUrlByTitle(assets, CONTRACT_REVIEW_GPT_ASSET_TITLE),
    creatorBrandMatching: resolveAssetUrlByTitle(
      assets,
      CREATOR_BRAND_MATCHING_GPT_ASSET_TITLE,
    ),
  };
}
