import { createServerFn } from "@tanstack/react-start";
import { requireAdminAuth } from "@/lib/auth";

type EnvDiagnostic = {
  name: string;
  exists: boolean;
};

type SpreadsheetDiagnostic = {
  name: string;
  envVar: string;
  configured: boolean;
  readable: boolean;
  tabCount: number;
  tabs: string[];
  error: string | null;
};

export type GoogleSheetsDiagnostics = {
  checkedAt: string;
  authorized: boolean;
  env: EnvDiagnostic[];
  spreadsheets: SpreadsheetDiagnostic[];
};

const envNames = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "TEAM_BILLION_SPREADSHEET_ID",
  "CREATOR_SOURCING_SPREADSHEET_ID",
] as const;

function envExists(name: string) {
  return Boolean(process.env[name]?.trim());
}

function envStatus(): EnvDiagnostic[] {
  return envNames.map((name) => ({
    name,
    exists: envExists(name),
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function checkSpreadsheet(
  name: string,
  envVar: "TEAM_BILLION_SPREADSHEET_ID" | "CREATOR_SOURCING_SPREADSHEET_ID",
): Promise<SpreadsheetDiagnostic> {
  const spreadsheetId = process.env[envVar]?.trim();

  if (!spreadsheetId) {
    return {
      name,
      envVar,
      configured: false,
      readable: false,
      tabCount: 0,
      tabs: [],
      error: `${envVar} is missing.`,
    };
  }

  try {
    const googleSheets = await import("@/lib/google-sheets.server");
    const config = googleSheets.getGoogleSheetsConfig();
    const tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);

    return {
      name,
      envVar,
      configured: true,
      readable: true,
      tabCount: tabs.length,
      tabs: tabs.map((tab) => tab.sheetName).slice(0, 20),
      error: null,
    };
  } catch (error) {
    console.error(`Google Sheets diagnostics failed for ${name}:`, error);

    return {
      name,
      envVar,
      configured: true,
      readable: false,
      tabCount: 0,
      tabs: [],
      error: errorMessage(error),
    };
  }
}

export const getGoogleSheetsDiagnostics = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await requireAdminAuth();
  } catch {
    return {
      checkedAt: new Date().toISOString(),
      authorized: false,
      env: [],
      spreadsheets: [],
    } satisfies GoogleSheetsDiagnostics;
  }

  const [teamSheet, creatorSheet] = await Promise.all([
    checkSpreadsheet("Team Billion deal sheet", "TEAM_BILLION_SPREADSHEET_ID"),
    checkSpreadsheet("Creator sourcing sheet", "CREATOR_SOURCING_SPREADSHEET_ID"),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    authorized: true,
    env: envStatus(),
    spreadsheets: [teamSheet, creatorSheet],
  } satisfies GoogleSheetsDiagnostics;
});
