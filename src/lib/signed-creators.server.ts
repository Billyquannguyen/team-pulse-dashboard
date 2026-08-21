import "@tanstack/react-start/server-only";
import { SIGNED_CREATORS_TAB_NAME } from "@/data/sheetConfig";
import type { Creator } from "@/data/creators";
import {
  fetchSheetRows,
  fetchSpreadsheetTabs,
  getGoogleSheetsConfig,
} from "@/lib/google-sheets.server";
import { cleanSheetName, normalizeCreatorRows } from "@/lib/sheet-normalizer";

function normalizedTabName(value: string) {
  return cleanSheetName(value).toLowerCase();
}

export async function getExclusiveDashboardCreatorsForServer(): Promise<Creator[]> {
  const config = getGoogleSheetsConfig();
  const tabs = await fetchSpreadsheetTabs(config, config.creatorSourcingSpreadsheetId);
  const expectedName = normalizedTabName(SIGNED_CREATORS_TAB_NAME);
  const signedCreatorsTab = tabs.find((tab) =>
    normalizedTabName(tab.sheetName).includes(expectedName),
  );

  if (!signedCreatorsTab) {
    throw new Error('Could not find the dashboard "Signed creators" worksheet.');
  }

  const { headers, rows } = await fetchSheetRows(
    config,
    config.creatorSourcingSpreadsheetId,
    signedCreatorsTab,
  );

  return normalizeCreatorRows([headers, ...rows]).filter(
    (creator) => creator.relationship === "Exclusive",
  );
}
