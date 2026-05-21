import { createServerFn } from "@tanstack/react-start";
import { requireAdminAuth } from "@/lib/auth";
import type { ActiveBrandsDataFlowDiagnostics } from "@/lib/active-brands";
import type { DashboardDataFlowDiagnostics } from "@/lib/sheets-public";
import type { TeamAssetsDataFlowDiagnostics } from "@/lib/team-assets";

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
  totalRows: number;
  rowCounts: Array<{
    sheetName: string;
    readable: boolean;
    headerCount: number;
    rowCount: number;
    error: string | null;
  }>;
  error: string | null;
};

export type GoogleSheetsDiagnostics = {
  checkedAt: string;
  authorized: boolean;
  env: EnvDiagnostic[];
  auth: {
    attempted: boolean;
    ok: boolean;
    cached: boolean;
    error: string | null;
  };
  spreadsheets: SpreadsheetDiagnostic[];
  dataFlow: DashboardDataFlowDiagnostics | null;
  teamAssets: TeamAssetsDataFlowDiagnostics | null;
  activeBrands: ActiveBrandsDataFlowDiagnostics | null;
};

const DIAGNOSTICS_CACHE_TTL_MS = 5 * 60 * 1000;
let diagnosticsCache: { data: GoogleSheetsDiagnostics; expiresAt: number } | null = null;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logDiagnostics(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:diagnostics]", message, details ?? {});
}

async function getEnvStatus(): Promise<EnvDiagnostic[]> {
  const googleSheets = await import("@/lib/google-sheets.server");
  return googleSheets.getGoogleEnvPresence();
}

async function checkAuthStatus(): Promise<GoogleSheetsDiagnostics["auth"]> {
  try {
    const googleSheets = await import("@/lib/google-sheets.server");
    const config = googleSheets.getGoogleSheetsConfig();
    const result = await googleSheets.checkGoogleAuth(config);

    logDiagnostics("google auth diagnostic complete", {
      ok: result.ok,
      cached: result.cached,
      error: result.error,
    });

    return {
      attempted: true,
      ...result,
    };
  } catch (error) {
    const message = errorMessage(error);
    logDiagnostics("google auth diagnostic failed before token request", {
      error: message,
    });

    return {
      attempted: false,
      ok: false,
      cached: false,
      error: message,
    };
  }
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
      totalRows: 0,
      rowCounts: [],
      error: `${envVar} is missing.`,
    };
  }

  try {
    const googleSheets = await import("@/lib/google-sheets.server");
    const config = googleSheets.getGoogleSheetsConfig();
    const tabs = await googleSheets.fetchSpreadsheetTabs(config, spreadsheetId);

    logDiagnostics("spreadsheet diagnostic complete", {
      name,
      configured: true,
      readable: true,
      tabCount: tabs.length,
      note: "Row reads are skipped here to avoid Google Sheets quota pressure.",
    });

    return {
      name,
      envVar,
      configured: true,
      readable: true,
      tabCount: tabs.length,
      tabs: tabs.map((tab) => tab.sheetName).slice(0, 20),
      totalRows: 0,
      rowCounts: [],
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
      totalRows: 0,
      rowCounts: [],
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
      auth: {
        attempted: false,
        ok: false,
        cached: false,
        error: "Admin login required.",
      },
      spreadsheets: [],
      dataFlow: null,
      teamAssets: null,
      activeBrands: null,
    } satisfies GoogleSheetsDiagnostics;
  }

  if (diagnosticsCache && diagnosticsCache.expiresAt > Date.now()) {
    logDiagnostics("returning cached diagnostics", {
      expiresAt: new Date(diagnosticsCache.expiresAt).toISOString(),
    });
    return diagnosticsCache.data;
  }

  const sheetsPublic = await import("@/lib/sheets-public");
  const activeBrands = await import("@/lib/active-brands");
  const teamAssets = await import("@/lib/team-assets");
  const [env, auth, teamSheet, creatorSheet, dataFlow, teamAssetsFlow, activeBrandsFlow] =
    await Promise.all([
      getEnvStatus(),
      checkAuthStatus(),
      checkSpreadsheet("Team Billion deal sheet", "TEAM_BILLION_SPREADSHEET_ID"),
      checkSpreadsheet("Creator sourcing sheet", "CREATOR_SOURCING_SPREADSHEET_ID"),
      sheetsPublic.getDashboardDataFlowDiagnostics(),
      teamAssets.getTeamAssetsDataFlowDiagnostics(),
      activeBrands.getActiveBrandsDataFlowDiagnostics(),
    ]);

  logDiagnostics("full diagnostics complete", {
    env,
    authOk: auth.ok,
    teamSheetReadable: teamSheet.readable,
    creatorSheetReadable: creatorSheet.readable,
    fallbackActive: dataFlow.fallbackActive,
    source: dataFlow.source,
    teamAssetsSource: teamAssetsFlow.source,
    teamAssetsConfigured: teamAssetsFlow.spreadsheet.configured,
    activeBrandsSource: activeBrandsFlow.source,
    activeBrandsConfigured: activeBrandsFlow.spreadsheet.configured,
  });

  const diagnostics = {
    checkedAt: new Date().toISOString(),
    authorized: true,
    env,
    auth,
    spreadsheets: [teamSheet, creatorSheet],
    dataFlow,
    teamAssets: teamAssetsFlow,
    activeBrands: activeBrandsFlow,
  } satisfies GoogleSheetsDiagnostics;

  diagnosticsCache = {
    data: diagnostics,
    expiresAt: Date.now() + DIAGNOSTICS_CACHE_TTL_MS,
  };

  return diagnostics;
});
