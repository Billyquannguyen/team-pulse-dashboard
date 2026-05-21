import "@tanstack/react-start/server-only";

export type GoogleSheetRef = {
  memberName: string;
  sheetName: string;
  gid?: string;
};

export type GoogleSheetRows = {
  headers: string[];
  rows: string[][];
};

export type GoogleSheetsConfig = {
  serviceAccountEmail: string;
  privateKey: string;
  teamSpreadsheetId: string;
  creatorSourcingSpreadsheetId: string;
};

export type GoogleEnvPresence = {
  name: string;
  exists: boolean;
};

export type GoogleAuthCheck = {
  ok: boolean;
  cached: boolean;
  error: string | null;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type SpreadsheetResponse = {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      hidden?: boolean;
    };
  }>;
};

type ValuesResponse = {
  values?: unknown[][];
  error?: {
    code?: number;
    message?: string;
  };
};

let cachedToken: { token: string; expiresAt: number } | null = null;

const GOOGLE_ENV_NAMES = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "TEAM_BILLION_SPREADSHEET_ID",
  "CREATOR_SOURCING_SPREADSHEET_ID",
] as const;

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logGoogleSheets(message: string, details?: Record<string, unknown>) {
  console.info("[team-billion:sheets]", message, details ?? {});
}

function summarizeUrl(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const valuesIndex = parts.indexOf("values");
  const endpoint = valuesIndex >= 0 ? "values" : "metadata";
  const encodedRange = valuesIndex >= 0 ? parts.slice(valuesIndex + 1).join("/") : "";

  return {
    endpoint,
    hasSpreadsheetId: parts.includes("spreadsheets"),
    range: encodedRange ? decodeURIComponent(encodedRange) : undefined,
  };
}

export function getGoogleEnvPresence(): GoogleEnvPresence[] {
  return GOOGLE_ENV_NAMES.map((name) => ({
    name,
    exists: Boolean(process.env[name]?.trim()),
  }));
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required Google Sheets env var: ${name}`);
  return value;
}

function normalizePrivateKey(value: string) {
  return value
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
}

export function getGoogleSheetsConfig(): GoogleSheetsConfig {
  logGoogleSheets("environment variable presence", {
    vars: getGoogleEnvPresence(),
    nodeEnv: process.env.NODE_ENV ?? "missing",
    vercel: process.env.VERCEL === "1" ? "present" : "missing",
  });

  return {
    serviceAccountEmail: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    teamSpreadsheetId: requiredEnv("TEAM_BILLION_SPREADSHEET_ID"),
    creatorSourcingSpreadsheetId: requiredEnv("CREATOR_SOURCING_SPREADSHEET_ID"),
  };
}

export function getOptionalSheetLinks() {
  return {
    dealsSheetUrl: process.env.TEAM_BILLION_SPREADSHEET_ID
      ? makeSheetUrl(process.env.TEAM_BILLION_SPREADSHEET_ID)
      : undefined,
    creatorSourcingSheetUrl: process.env.CREATOR_SOURCING_SPREADSHEET_ID
      ? makeSheetUrl(process.env.CREATOR_SOURCING_SPREADSHEET_ID)
      : undefined,
  };
}

export function makeSheetUrl(spreadsheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

function base64Url(input: string | Uint8Array) {
  const buffer = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  return Buffer.from(base64, "base64");
}

async function signJwt(config: GoogleSheetsConfig) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is not available in this server runtime.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: config.serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const key = await subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );

  return `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
}

async function getAccessToken(config: GoogleSheetsConfig) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    logGoogleSheets("google auth using cached token", {
      cachedUntil: new Date(cachedToken.expiresAt).toISOString(),
    });
    return cachedToken.token;
  }

  logGoogleSheets("google auth requesting access token", {
    serviceAccountEmailPresent: Boolean(config.serviceAccountEmail),
    privateKeyPresent: Boolean(config.privateKey),
  });

  const assertion = await signJwt(config);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || !result.access_token) {
    logGoogleSheets("google auth failed", {
      status: response.status,
      error: result.error_description ?? result.error ?? "No access token returned",
    });

    throw new Error(
      `Google service account auth failed (${response.status}): ${
        result.error_description ?? result.error ?? "No access token returned"
      }`,
    );
  }

  cachedToken = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000,
  };

  logGoogleSheets("google auth succeeded", {
    expiresAt: new Date(cachedToken.expiresAt).toISOString(),
  });

  return cachedToken.token;
}

export async function checkGoogleAuth(config: GoogleSheetsConfig): Promise<GoogleAuthCheck> {
  const cached = Boolean(cachedToken && cachedToken.expiresAt > Date.now() + 60_000);

  try {
    await getAccessToken(config);
    return {
      ok: true,
      cached,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      cached,
      error: safeErrorMessage(error),
    };
  }
}

async function googleSheetsFetch<T>(config: GoogleSheetsConfig, url: URL): Promise<T> {
  const summary = summarizeUrl(url);
  logGoogleSheets("google sheets api request", summary);

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      authorization: `Bearer ${await getAccessToken(config)}`,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & ValuesResponse;

  if (!response.ok) {
    logGoogleSheets("google sheets api request failed", {
      ...summary,
      status: response.status,
      error: body.error?.message ?? response.statusText,
    });

    throw new Error(
      `Google Sheets API failed (${response.status}): ${
        body.error?.message ?? response.statusText
      }`,
    );
  }

  logGoogleSheets("google sheets api request succeeded", {
    ...summary,
    status: response.status,
  });

  return body;
}

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function cellToString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export async function fetchSpreadsheetTabs(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
): Promise<GoogleSheetRef[]> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  url.searchParams.set("includeGridData", "false");
  url.searchParams.set("fields", "sheets.properties(sheetId,title,hidden)");
  const metadata = await googleSheetsFetch<SpreadsheetResponse>(config, url);
  const tabs = (metadata.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((properties) => properties?.title && !properties.hidden)
    .map((properties) => ({
      gid: String(properties?.sheetId ?? ""),
      sheetName: String(properties?.title ?? ""),
      memberName: String(properties?.title ?? ""),
    }));

  logGoogleSheets("spreadsheet opened", {
    visibleTabCount: tabs.length,
    tabs: tabs.map((tab) => tab.sheetName).slice(0, 20),
  });

  return tabs;
}

export async function fetchSheetRows(
  config: GoogleSheetsConfig,
  spreadsheetId: string,
  sheet: GoogleSheetRef,
): Promise<GoogleSheetRows> {
  if (!sheet.sheetName) {
    throw new Error(`No sheet name was available for ${sheet.memberName}`);
  }

  const range = `${quoteSheetName(sheet.sheetName)}!A:AZ`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range,
    )}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const result = await googleSheetsFetch<ValuesResponse>(config, url);
  const values = result.values ?? [];
  const headers = (values[0] ?? []).map(cellToString);
  const rows = values.slice(1).map((row) => row.map(cellToString));

  logGoogleSheets("sheet rows returned", {
    sheetName: sheet.sheetName,
    headerCount: headers.length,
    rowCount: rows.length,
  });

  return { headers, rows };
}
