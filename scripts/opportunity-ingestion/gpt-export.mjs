#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const EXPORT_DIR = ".opportunity-ingestion/gpt-exports";
const SCOPES = {
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly",
};

const TAB_NAMES = {
  opportunities: "Opportunities",
  brandIntelligence: "Brand Intelligence",
  agencyIntelligence: "Agency Intelligence",
  creatorSignals: "Creator Matching Signals",
};

const OPPORTUNITY_EXPORT_HEADERS = [
  "GPT Export Tier",
  "GPT Match Use",
  "GPT Export Notes",
  "Opportunity ID",
  "Brand Name",
  "Opportunity Name",
  "Opportunity Type",
  "Opportunity Status",
  "Source Organization Name",
  "Source Organization Type",
  "Contact Name",
  "Contact Email",
  "Source Email Date",
  "Source Email Subject",
  "Campaign Summary",
  "Creator Platform Requirement",
  "Creator Niche Requirement",
  "Creator Country Requirement",
  "Creator Language Requirement",
  "Follower Range Requirement",
  "Audience Requirement",
  "Special Creator Requirements",
  "Budget Amount",
  "Budget Currency",
  "Budget Notes",
  "Affiliate Commission",
  "Deliverables",
  "Usage Rights",
  "Whitelisting / Paid Media",
  "Timeline / Deadline",
  "Application Process",
  "Commercial Quality",
  "Budget Rating",
  "Expected Deal Value",
  "Confidence Score",
  "Needs Human Review",
  "Review Notes",
  "Still Useful For Matching?",
  "Opportunity Relevance Type",
  "Recommended Pitch Angle",
  "Disqualifier Flags",
  "Source Email Link",
];

const BRAND_EXPORT_HEADERS = [
  "Brand Name",
  "Total Opportunities",
  "Confidence Score",
  "Commercial Quality",
  "Typical Opportunity Types",
  "Typical Creator Niches",
  "Typical Creator Platform",
  "Typical Budget Range",
  "Budget Floor Concern",
  "Still Useful For Matching?",
  "Recommended Pitch Angle",
];

const AGENCY_EXPORT_HEADERS = [
  "Organization Name",
  "Total Opportunities",
  "Confidence Score",
  "Typical Opportunity Types",
  "Typical Commercial Quality",
  "Budget Pattern",
  "Agency Usefulness",
  "Brands Represented Normalized",
  "Last Communication Date",
  "Communication Status",
];

const SIGNAL_EXPORT_HEADERS = [
  "Brand",
  "Country Signals",
  "Gender Signals",
  "Niche Signals",
  "Audience Signals",
  "Platform Signals",
  "Campaign Type Signals",
  "Commercial Quality",
  "Budget Floor Concern",
  "Affiliate Penalty",
  "Historical Success Pattern",
  "Relationship Strength",
  "Preference Strength",
  "Still Valuable For Matching",
  "Recommended Priority Tier",
  "Matching Notes",
];

const MATCHING_INTELLIGENCE_HEADERS = [
  "Entity Type",
  "Brand",
  "Agency",
  "Typical Creator Types",
  "Typical Niches",
  "Typical Countries",
  "Typical Platforms",
  "Budget Quality",
  "Affiliate Tendency",
  "Fixed Fee Tendency",
  "Song Promotion Tendency",
  "Historical Strength",
  "Pitch Angle Signals",
  "Relationship Strength",
  "Priority Notes",
  "Opportunity Count",
  "Tier 1 Count",
  "Tier 2 Count",
  "Tier 3 Count",
  "Average Confidence",
  "Best Source Email Date",
];

const AGENCY_COMMERCIAL_HEADERS = [
  "Agency",
  "Typical Campaign Categories",
  "Typical Creator Types",
  "Fixed Fee Tendency",
  "Affiliate Tendency",
  "Song Promotion Tendency",
  "Budget Quality Tendency",
  "Low Budget Tendency",
  "Unknown Budget Tendency",
  "Opportunity Frequency",
  "Historical Opportunity Count",
  "Historical Contact Count",
  "Historical Email Thread Count",
  "Relationship Strength Score",
  "Relationship Strength",
  "Generally Worth Pitching",
  "Priority Notes",
  "Best Source Email Date",
];

const BRAND_COMMERCIAL_HEADERS = [
  "Brand",
  "Typical Creator Niches",
  "Typical Countries",
  "Typical Platforms",
  "Typical Budget Quality",
  "Typical Deal Structure",
  "Fixed Fee Tendency",
  "Affiliate Tendency",
  "Song Promotion Tendency",
  "Historical Opportunity Count",
  "Historical Contact Count",
  "Historical Email Thread Count",
  "Relationship Strength Score",
  "Relationship Strength",
  "Historical Opportunity Strength",
  "Priority Notes",
  "Best Source Email Date",
];

const PITCH_ANGLE_HEADERS = [
  "Entity Type",
  "Brand",
  "Agency",
  "Strongest Pitch Angles",
  "Supporting Pitch Angles",
  "Confidence",
  "Opportunity Count",
  "Evidence Notes",
];

const OPPORTUNITY_PRIORITY_HEADERS = [
  "Opportunity ID",
  "Brand",
  "Agency",
  "GPT Export Tier",
  "Commercial Quality Score",
  "Relationship Score",
  "Creator Signal Strength",
  "Geography Strength",
  "Historical Strength",
  "Priority Score",
  "Priority Notes",
];

const GENERIC_NAMES = new Set([
  "unknown",
  "unknown brand",
  "unknown mobile app",
  "unknown social app",
  "brand",
  "the brand",
  "campaign",
  "the campaign",
  "this",
  "this campaign",
  "our brand",
  "your brand",
  "your email",
  "your reply",
  "your audience",
  "your system",
  "creators",
  "creator",
  "team",
  "manager",
  "emails",
  "linkedin",
  "to me",
  "my side",
  "cash sharing",
  "completing this task",
  "travel and",
  "future opportunities",
  "events already on your calendar",
  "gold",
  "sharing this",
  "you best",
  "the next steps",
  "the better",
  "the creator rewards program",
  "the creator rewards programme",
  "getting back to me",
  "getting back to us",
  "now",
  "stride social",
  "stride-social",
  "stride-social.com",
  "there",
  "them",
  "out",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

const KNOWN_POLLUTED_NAMES = new Set([
  "aching out",
  "a while",
  "ai-related content at the moment",
  "bestfriday agency",
  "clarifying the brand's budget",
  "china. as you know",
  "completing this task",
  "direct communication",
  "feedback. on sat",
  "getting back to me",
  "getting back to us",
  "her",
  "his content style",
  "limited margins",
  "mureka or other brands",
  "my side",
  "now",
  "not getting back earlier",
  "sending that over",
  "sharing her rate with us",
  "sharing this",
  "talented creators like you",
  "a creator like you",
  "creators whose content celebrates beauty",
  "the brand",
  "the campaign",
  "the creator rewards program",
  "the creator rewards programme",
  "the next steps",
  "the omio campaign",
  "sharing your production charge",
  "tech creator",
  "them",
  "the smart",
  "the collaboration to begin soon",
  "the mistake",
  "the opportunity to participate",
  "this creator",
  "this creator's",
  "this campaign",
  "very tight margins",
  "you in future projects",
]);

const SUSPICIOUS_NAME_PATTERNS = [
  /\b(getting back|not getting|thank(s| you)|following up|reaching out|reply|respond|heard back)\b/i,
  /\b(brand'?s? budget|rate with us|rate with me|budget for this|campaign to begin|collaboration to begin)\b/i,
  /\b(direct communication|sending that over|sharing your|sharing her|sharing his|production charge|the smart)\b/i,
  /\b(this creator|tech creator|creator'?s content|your content|her rate|his rate|their rate)\b/i,
  /\b(hi dear creator|dear creator|dear influencer|hello creator)\b/i,
  /\b(ai-related content|at the moment|a while|the information|the collaboration)\b/i,
  /\b(feedback|next steps|talented creators like you|creator rewards program|creator rewards programme)\b/i,
  /\b(the brand|the campaign|the better|my side|to me|completing this task|travel and)\b/i,
  /\b(best regards|content style|sharing the details|this time|on-site visit|other brands|limited margins|tight margins|the mistake)\b/i,
  /\b(kindly review|attached copy|our contract|the attached)\b/i,
  /\b(mon|tue|wed|thu|fri|sat|sun)\b/i,
  /\b(quick collab|paid collaboration|exclusive paid|new potential collaboration)\b/i,
  /[?]/,
  /\.$/,
];

const SOURCE_TYPES_WITH_MATCHING_VALUE = new Set([
  "agency",
  "brand",
  "pr agency",
  "talent platform",
  "record label",
  "platform",
]);

const LOW_BUDGET_FLOOR = 1000;
const SONG_PROMOTION_LOW_BUDGET_FLOOR = 300;
const MIN_TIER_1_BUDGET = 1000;
const MIN_TIER_1_SONG_BUDGET = 300;

const NON_ACTIONABLE_TEXT_PATTERNS = [
  /\b(newsletter|digest|roundup|webinar|case study|product update|blog|press release|view in browser|manage preferences)\b/i,
  /\b(no-reply|noreply|do not reply|unsubscribe)\b/i,
  /\b(creator newsletter|weekly update|community update|events already on your calendar)\b/i,
];

const WEAK_AUDIENCE_PATTERNS = [
  />{2,}/,
  /\b(about it|engagement|insights|statistics|stats|demographics|countries|location breakdown|gender split|spilt|backend of your account)\b/i,
  /\b(please send|could you send|we need to review|hope you|thank you)\b/i,
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  loadEnvFiles([".env", ".env.local", ".env.opportunity-ingestion"]);
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const startedAt = new Date().toISOString();
  let config = null;
  let metadata = null;
  let workbook = null;

  if (options.sourceExportDir) {
    console.log("GPT EXPORT: reading an existing local export folder.");
    console.log(`Source export: ${options.sourceExportDir}`);
    const localSource = await loadWorkbookFromExportDir(options.sourceExportDir);
    workbook = localSource.workbook;
    metadata = { properties: { title: localSource.spreadsheetTitle } };
    config = { spreadsheetId: localSource.spreadsheetId };
  } else {
    config = loadConfig();
    const tokenProvider = createGoogleTokenProvider(config);
    const sheets = createSheetsClient(config.spreadsheetId, tokenProvider);
    console.log("GPT EXPORT: reading the Opportunity Intelligence database.");
    console.log(`Database: ${config.spreadsheetId}`);
    metadata = await sheets.metadata();
    workbook = await loadWorkbook(sheets);
  }

  const exportData = buildExport(workbook, options);
  const output = await writeExportFiles(exportData, {
    startedAt,
    spreadsheetId: config.spreadsheetId,
    spreadsheetTitle: metadata.properties?.title ?? "Unknown",
    options,
  });

  printSummary(exportData, output);
}

function parseArgs(args) {
  const options = {
    help: false,
    limit: 1200,
    minConfidence: 70,
    sourceExportDir: "",
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--limit=")) options.limit = positiveNumber(arg.split("=")[1], "limit");
    else if (arg.startsWith("--min-confidence=")) options.minConfidence = positiveNumber(arg.split("=")[1], "min-confidence");
    else if (arg.startsWith("--source-export-dir=")) options.sourceExportDir = arg.slice("--source-export-dir=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`--${label} must be a positive number.`);
  return number;
}

function printHelp() {
  console.log(`
Opportunity Intelligence GPT export

Command:
  npm run opportunity:gpt-export

Optional:
  node scripts/opportunity-ingestion/gpt-export.mjs --limit=1500 --min-confidence=75
  node scripts/opportunity-ingestion/gpt-export.mjs --source-export-dir=.opportunity-ingestion/gpt-exports/gpt-export-YYYY-MM-DDTHH-MM-SS

What it does:
  - reads the existing Opportunity Intelligence Google Sheet
  - creates local CSV and Markdown files for a custom GPT knowledge upload
  - writes team-billion-brand-matching-playbook.md for future matching logic
  - filters out obvious noisy labels and low-confidence rows
  - does not scan Gmail
  - does not write to the Google Sheet
  - does not print secrets
`);
}

function loadConfig() {
  const missing = [];
  const config = {
    serviceAccountEmail: env("GOOGLE_SERVICE_ACCOUNT_EMAIL", missing),
    privateKey: normalizePrivateKey(env("GOOGLE_PRIVATE_KEY", missing)),
    spreadsheetId: env("OPPORTUNITY_DATABASE_SPREADSHEET_ID", missing),
  };

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return config;
}

function env(name, missing) {
  const value = process.env[name];
  if (!value) missing.push(name);
  return value ?? "";
}

async function loadWorkbook(sheets) {
  const result = await sheets.batchGet([
    `${quoteSheet(TAB_NAMES.opportunities)}!A1:CL10000`,
    `${quoteSheet(TAB_NAMES.brandIntelligence)}!A1:AO10000`,
    `${quoteSheet(TAB_NAMES.agencyIntelligence)}!A1:AD10000`,
    `${quoteSheet(TAB_NAMES.creatorSignals)}!A1:O10000`,
  ]);
  const [opportunities, brandIntelligence, agencyIntelligence, creatorSignals] = result.valueRanges.map(parseTable);
  return { opportunities, brandIntelligence, agencyIntelligence, creatorSignals };
}

async function loadWorkbookFromExportDir(sourceDir) {
  const dir = path.resolve(process.cwd(), sourceDir);
  const summary = await readJsonIfExists(path.join(dir, "export-summary.json"));
  const curated = await readCsvTable(path.join(dir, "creator-brand-opportunities.csv"));
  const review = await readCsvTable(path.join(dir, "review-before-use-opportunities.csv"));
  return {
    spreadsheetId: summary?.spreadsheetId ?? "local-export-source",
    spreadsheetTitle: summary?.spreadsheetTitle ?? "Local Opportunity Intelligence Export",
    workbook: {
      opportunities: mergeTables(curated, review),
      brandIntelligence: await readCsvTable(path.join(dir, "brand-intelligence.csv")),
      agencyIntelligence: await readCsvTable(path.join(dir, "agency-intelligence.csv")),
      creatorSignals: await readCsvTable(path.join(dir, "creator-matching-signals.csv")),
      sourceCounts: summary?.sourceCounts,
    },
  };
}

async function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

async function readCsvTable(file) {
  if (!existsSync(file)) return { headers: [], rows: [] };
  const records = parseCsv(await readFile(file, "utf8"));
  return {
    headers: records[0] ?? [],
    rows: records.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim())),
  };
}

function mergeTables(primary, secondary) {
  const headers = primary.headers.length >= secondary.headers.length ? primary.headers : secondary.headers;
  return {
    headers,
    rows: [...primary.rows, ...secondary.rows],
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseTable(valueRange) {
  const values = valueRange?.values ?? [];
  return {
    headers: values[0] ?? [],
    rows: values.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim())),
  };
}

function buildExport(workbook, options) {
  const opportunityExport = buildOpportunityExport(workbook.opportunities, options);
  const brandRows = buildIntelligenceExportRows(workbook.brandIntelligence, "Brand Name", BRAND_EXPORT_HEADERS, 250, "brand");
  const agencyRows = buildIntelligenceExportRows(workbook.agencyIntelligence, "Organization Name", AGENCY_EXPORT_HEADERS, 250, "agency");
  const signalRows = buildSignalExportRows(workbook.creatorSignals, 250);
  const opportunities = opportunityExport.curated.slice(0, options.limit);
  const matchingIntelligenceRows = buildMatchingIntelligenceRows(opportunities, { brandRows, agencyRows, signalRows });
  const matchingAudit = buildMatchingAudit(matchingIntelligenceRows, opportunities);
  const agencyCommercialRows = buildAgencyCommercialRows(opportunities, { agencyRows });
  const brandCommercialRows = buildBrandCommercialRows(opportunities, { signalRows });
  const pitchAngleRows = buildPitchAngleRows(matchingIntelligenceRows);
  const opportunityPriorityRows = buildOpportunityPriorityRows(opportunities, {
    brandCommercialRows,
    agencyCommercialRows,
    matchingIntelligenceRows,
  });
  const readinessAudit = buildGptReadinessAuditData({
    opportunities,
    reviewCandidates: opportunityExport.review,
    brandRows,
    agencyRows,
    signalRows,
    matchingIntelligenceRows,
    agencyCommercialRows,
    brandCommercialRows,
    pitchAngleRows,
    opportunityPriorityRows,
  });

  return {
    opportunities,
    reviewCandidates: opportunityExport.review,
    brands: brandRows,
    agencies: agencyRows,
    signals: signalRows,
    matchingIntelligence: matchingIntelligenceRows,
    agencyCommercial: agencyCommercialRows,
    brandCommercial: brandCommercialRows,
    pitchAngles: pitchAngleRows,
    opportunityPriority: opportunityPriorityRows,
    gptReadiness: readinessAudit,
    audit: buildAudit(opportunityExport, {
      brandRows,
      agencyRows,
      signalRows,
      matchingIntelligenceRows,
      matchingAudit,
      agencyCommercialRows,
      brandCommercialRows,
      pitchAngleRows,
      opportunityPriorityRows,
      readinessAudit,
    }),
    sourceCounts: workbook.sourceCounts ?? {
      opportunities: workbook.opportunities.rows.length,
      brandIntelligence: workbook.brandIntelligence.rows.length,
      agencyIntelligence: workbook.agencyIntelligence.rows.length,
      creatorSignals: workbook.creatorSignals.rows.length,
    },
  };
}

function buildOpportunityExport(table, options) {
  const headerMap = headerMapFor(table.headers);
  const evaluated = table.rows.map((row) => evaluateOpportunityRow(row, headerMap, options));
  return {
    curated: evaluated
      .filter((result) => result.bucket === "curated")
      .sort((a, b) => b.score - a.score)
      .map((result) => result.exportRow),
    review: evaluated
      .filter((result) => result.bucket === "review")
      .sort((a, b) => b.score - a.score)
      .map((result) => result.exportRow),
    removed: evaluated.filter((result) => result.bucket === "removed"),
    evaluations: evaluated,
  };
}

function evaluateOpportunityRow(row, headerMap, options) {
  const opportunityId = getCell(row, headerMap, "Opportunity ID");
  const brandName = getCell(row, headerMap, "Brand Name");
  const sourceOrganizationName = getCell(row, headerMap, "Source Organization Name");
  const sourceOrganizationType = getCell(row, headerMap, "Source Organization Type");
  const subject = getCell(row, headerMap, "Source Email Subject");
  const confidenceScore = numberCell(row, headerMap, "Confidence Score");
  const needsReview = truthy(getCell(row, headerMap, "Needs Human Review"));
  const status = getCell(row, headerMap, "Opportunity Status");
  const relevance = getCell(row, headerMap, "Opportunity Relevance Type");
  const stillUseful = getCell(row, headerMap, "Still Useful For Matching?");
  const commercialQuality = getCell(row, headerMap, "Commercial Quality");
  const budgetRating = getCell(row, headerMap, "Budget Rating");
  const budgetAmount = getCell(row, headerMap, "Budget Amount");
  const expectedDealValue = numberCell(row, headerMap, "Expected Deal Value") || numberCell(row, headerMap, "Approx Deal Value");
  const affiliateOnly = getCell(row, headerMap, "Affiliate Only?");
  const affiliatePresent = getCell(row, headerMap, "Affiliate Present?");
  const fixedFee = getCell(row, headerMap, "Fixed Fee Present?");
  const songException = getCell(row, headerMap, "Song Promotion Exception?");
  const opportunityType = getCell(row, headerMap, "Opportunity Type");
  const budgetFloorConcern = getCell(row, headerMap, "Budget Floor Concern") || getCell(row, headerMap, "Minimum Budget Concern");
  const disqualifierFlags = getCell(row, headerMap, "Disqualifier Flags");
  const campaignSummary = getCell(row, headerMap, "Campaign Summary");
  const affiliateCommission = getCell(row, headerMap, "Affiliate Commission");

  const brandReviewReasons = brandNameReviewReasons(brandName, { subject });
  const sourceReviewReasons = sourceNameReviewReasons(sourceOrganizationName, sourceOrganizationType);
  const creatorSignal = creatorSignalProfile(row, headerMap);
  const activeOpportunity = /active/i.test(relevance) || /open|negotiating|won/i.test(status);
  const historicalSignal = /historical/i.test(relevance) || /expired/i.test(status);
  const hasKnownBudget = Boolean(budgetAmount && normalize(budgetAmount) !== "unknown") || expectedDealValue > 0;
  const missingBudget = !hasKnownBudget;
  const lowBudgetThreshold = normalize(songException) === "yes" || normalize(opportunityType) === "song promotion" ? SONG_PROMOTION_LOW_BUDGET_FLOOR : LOW_BUDGET_FLOOR;
  const lowBudget = normalize(budgetFloorConcern) === "yes" || /low/i.test(budgetRating) || (hasKnownBudget && expectedDealValue > 0 && expectedDealValue < lowBudgetThreshold);
  const songPromotion = normalize(songException) === "yes" || normalize(opportunityType) === "song promotion";
  const fixedFeePresent = normalize(fixedFee) === "yes" || (hasKnownBudget && normalize(affiliateOnly) !== "yes");
  const affiliateOnlyConcern = (normalize(affiliateOnly) === "yes" || (/affiliate/i.test(opportunityType) && affiliateCommission && !fixedFeePresent)) && !songPromotion;
  const nonActionableMarketing = looksNonActionableMarketing({ subject, campaignSummary, opportunityType, budgetAmount, deliverables: getCell(row, headerMap, "Deliverables") });
  const usefulSource = isUsefulSource(sourceOrganizationName, sourceOrganizationType);
  const reviewReasons = [
    ...brandReviewReasons,
    ...sourceReviewReasons,
  ];
  const downgradeReasons = [];

  if (confidenceScore < options.minConfidence) reviewReasons.push("Low confidence score.");
  if (needsReview) reviewReasons.push("Needs human review.");
  if (normalize(stillUseful) === "no") reviewReasons.push("Marked not useful for matching.");
  if (/internal|irrelevant|no creator opportunity/i.test(disqualifierFlags)) reviewReasons.push("Disqualifier flag suggests this is not a direct opportunity.");
  if (affiliateOnlyConcern) reviewReasons.push("Affiliate-only without song promotion exception.");
  if (nonActionableMarketing) reviewReasons.push("Looks like newsletter, marketing, or non-actionable email content.");

  if (missingBudget) downgradeReasons.push("Budget needs confirmation.");
  if (lowBudget && !affiliateOnlyConcern) downgradeReasons.push("Low-budget or budget-floor concern.");
  if (!fixedFeePresent) downgradeReasons.push("No fixed-fee signal.");
  if (!activeOpportunity) downgradeReasons.push(historicalSignal ? "Historical signal, not guaranteed active." : "Not clearly active.");
  if (creatorSignal.score < 3) downgradeReasons.push("Creator fit is partial or broad.");
  if (!/strong|acceptable/i.test(commercialQuality)) downgradeReasons.push("Commercial quality is not strong enough.");
  if (!usefulSource) downgradeReasons.push("Source organization is weak or unclear.");

  let score = confidenceScore;
  if (activeOpportunity) score += 20;
  if (/strong/i.test(commercialQuality)) score += 20;
  else if (/acceptable/i.test(commercialQuality)) score += 10;
  score += creatorSignal.score * 6;
  if (fixedFeePresent) score += 15;
  if (usefulSource) score += 10;
  if (missingBudget) score -= 15;
  if (lowBudget) score -= 20;
  if (historicalSignal) score -= 15;

  const baseAudit = {
    opportunityId,
    brandName,
    sourceOrganizationName,
    subject,
    confidenceScore,
    flags: auditFlags({
      affiliateOnlyConcern,
      lowBudget,
      missingBudget,
      suspiciousBrand: brandReviewReasons.length > 0,
      needsReview,
      historicalSignal,
      nonActionableMarketing,
    }),
    reasons: [...reviewReasons, ...downgradeReasons],
  };

  if (!brandName || reviewReasons.length > 0) {
    return buildReviewResult(row, headerMap, {
      score,
      reason: reviewReasons.join(" "),
      audit: { ...baseAudit, action: "Review Before Use" },
    });
  }

  const tier = exportTier({
    confidenceScore,
    activeOpportunity,
    historicalSignal,
    commercialQuality,
    creatorSignalScore: creatorSignal.score,
    creatorSignal,
    fixedFeePresent,
    lowBudget,
    missingBudget,
    usefulSource,
    expectedDealValue,
    opportunityType,
    songPromotion,
    downgradeReasons,
  });

  if (!tier) {
    return {
      bucket: "removed",
      score,
      exportRow: null,
      audit: { ...baseAudit, action: "Removed", reasons: [...baseAudit.reasons, "Too weak for GPT export."] },
    };
  }

  const notes = exportNotesFor(tier, downgradeReasons, creatorSignal);
  const matchUse = matchUseFor({ tier, relevance, status });

  return {
    bucket: "curated",
    score,
    audit: {
      ...baseAudit,
      action: tier,
      reasons: downgradeReasons,
    },
    exportRow: projectRow(row, headerMap, OPPORTUNITY_EXPORT_HEADERS, {
      "GPT Export Tier": tier,
      "GPT Match Use": matchUse,
      "GPT Export Notes": notes.join(" "),
    }),
  };
}

function buildReviewResult(row, headerMap, { score, reason, audit }) {
  return {
    bucket: "review",
    score,
    audit,
    exportRow: projectRow(row, headerMap, OPPORTUNITY_EXPORT_HEADERS, {
      "GPT Export Tier": "Review Before Use",
      "GPT Match Use": "Do not use as a recommendation until a human checks the source email.",
      "GPT Export Notes": reason || "Needs human review before use.",
    }),
  };
}

function exportTier({
  confidenceScore,
  activeOpportunity,
  historicalSignal,
  commercialQuality,
  creatorSignalScore,
  creatorSignal,
  fixedFeePresent,
  lowBudget,
  missingBudget,
  usefulSource,
  expectedDealValue,
  opportunityType,
  songPromotion,
  downgradeReasons,
}) {
  const strongCommercial = /strong/i.test(commercialQuality);
  const acceptableCommercial = /strong|acceptable/i.test(commercialQuality);
  const isAffiliate = /affiliate/i.test(opportunityType);
  const isPrGifting = /pr gifting/i.test(opportunityType);
  const minimumTierOneBudget = songPromotion ? MIN_TIER_1_SONG_BUDGET : MIN_TIER_1_BUDGET;
  const budgetClearsTierOne = expectedDealValue >= minimumTierOneBudget;
  const strongFit = creatorSignalScore >= 4 && (creatorSignal.usefulFields.includes("country") || creatorSignal.usefulFields.includes("niche"));
  const partialFit = creatorSignalScore >= 2.5;

  if (
    confidenceScore >= 92 &&
    activeOpportunity &&
    strongCommercial &&
    strongFit &&
    fixedFeePresent &&
    !lowBudget &&
    !missingBudget &&
    usefulSource &&
    budgetClearsTierOne &&
    !isAffiliate &&
    !isPrGifting
  ) {
    return "Tier 1";
  }

  if (
    confidenceScore >= 82 &&
    acceptableCommercial &&
    partialFit &&
    usefulSource &&
    !lowBudget &&
    (fixedFeePresent || missingBudget || historicalSignal || songPromotion) &&
    !isAffiliate
  ) {
    return "Tier 2";
  }

  if (confidenceScore >= 70 && (creatorSignalScore >= 1.5 || acceptableCommercial || historicalSignal || downgradeReasons.length <= 2)) {
    return "Tier 3";
  }

  return null;
}

function matchUseFor({ tier, relevance, status }) {
  if (tier === "Review Before Use") return "Use only after a human checks the source email.";
  if (/historical/i.test(relevance) || /expired/i.test(status)) return "Use as historical brand preference signal.";
  if (tier === "Tier 1") return "Use for direct creator-to-brand matching.";
  return "Use as supporting match context.";
}

function defaultNoteFor(tier) {
  if (tier === "Tier 1") return "High-confidence commercial opportunity with useful creator matching fields.";
  if (tier === "Tier 2") return "Useful opportunity signal, but check budget or details before pitching.";
  if (tier === "Tier 3") return "Context signal. Good for pattern matching, not a final recommendation alone.";
  return "Review source email before using.";
}

function buildIntelligenceExportRows(table, nameHeader, exportHeaders, limit, entityType) {
  const headerMap = headerMapFor(table.headers);
  return table.rows
    .map((row) => {
      const name = getCell(row, headerMap, nameHeader);
      const reviewReasons = entityType === "agency" ? sourceNameReviewReasons(name, getCell(row, headerMap, "Organization Type")) : brandNameReviewReasons(name, {});
      if (!name || reviewReasons.length > 0) return null;
      const total = numberCell(row, headerMap, "Total Opportunities");
      const confidence = numberCell(row, headerMap, "Confidence Score");
      const commercialQuality = getCell(row, headerMap, "Commercial Quality") || getCell(row, headerMap, "Typical Commercial Quality");
      const budgetFloorConcern = getCell(row, headerMap, "Budget Floor Concern");
      const stillUseful = getCell(row, headerMap, "Still Useful For Matching?");
      if (total <= 0 && confidence <= 0) return null;
      if (normalize(stillUseful) === "no") return null;
      return {
        score:
          total * 8 +
          confidence +
          (/strong/i.test(commercialQuality) ? 25 : /acceptable/i.test(commercialQuality) ? 10 : 0) -
          (normalize(budgetFloorConcern) === "yes" ? 35 : 0),
        row: projectRow(row, headerMap, exportHeaders),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.row);
}

function buildSignalExportRows(table, limit) {
  const headerMap = headerMapFor(table.headers);
  const seen = new Set();
  return table.rows
    .map((row) => {
      const brand = getCell(row, headerMap, "Brand");
      if (!brand || brandNameReviewReasons(brand, {}).length > 0) return null;
      const key = compactKey(brand);
      if (seen.has(key)) return null;
      seen.add(key);
      const tier = getCell(row, headerMap, "Recommended Priority Tier");
      const commercialQuality = getCell(row, headerMap, "Commercial Quality");
      const stillValuable = getCell(row, headerMap, "Still Valuable For Matching");
      if (!tier || ["Insufficient Data", "Unknown"].includes(tier)) return null;
      const score = signalScore({ tier, commercialQuality, stillValuable });
      return {
        score,
        row: projectRow(row, headerMap, SIGNAL_EXPORT_HEADERS),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.row);
}

function buildMatchingIntelligenceRows(opportunities, { brandRows, agencyRows, signalRows }) {
  const signalByBrand = new Map(signalRows.map((row) => [compactKey(row.Brand), row]));
  const agencyByName = new Map(agencyRows.map((row) => [compactKey(row["Organization Name"]), row]));
  const brandGroups = new Map();
  const agencyGroups = new Map();

  for (const row of opportunities) {
    const brand = row["Brand Name"];
    const agency = row["Source Organization Name"];
    if (brand && brandNameReviewReasons(brand, { subject: row["Source Email Subject"] }).length === 0) {
      addMatchingRecord(brandGroups, brand, row);
    }
    if (agency && isUsefulSource(agency, row["Source Organization Type"])) {
      addMatchingRecord(agencyGroups, agency, row);
    }
  }

  const brandIntelligenceRows = [...brandGroups.entries()].map(([brand, records]) => {
    const signal = signalByBrand.get(compactKey(brand));
    return matchingRowForGroup({
      entityType: "Brand",
      name: brand,
      records,
      signal,
      agencySummary: null,
    });
  });

  const agencyIntelligenceRows = [...agencyGroups.entries()].map(([agency, records]) => {
    const agencySummary = agencyByName.get(compactKey(agency));
    return matchingRowForGroup({
      entityType: "Agency",
      name: agency,
      records,
      signal: null,
      agencySummary,
    });
  });

  return [...brandIntelligenceRows, ...agencyIntelligenceRows]
    .filter((row) => Number(row["Opportunity Count"]) > 0)
    .sort((a, b) => matchingPriorityScore(b) - matchingPriorityScore(a))
    .slice(0, 350);
}

function addMatchingRecord(groups, key, row) {
  const cleanKey = String(key ?? "").trim();
  if (!cleanKey) return;
  if (!groups.has(cleanKey)) groups.set(cleanKey, []);
  groups.get(cleanKey).push(row);
}

function matchingRowForGroup({ entityType, name, records, signal, agencySummary }) {
  const brands = topValues(
    records.flatMap((row) =>
      splitSignalList(row["Brand Name"]).filter((brand) => brandNameReviewReasons(brand, { subject: row["Source Email Subject"] }).length === 0),
    ),
    8,
  );
  const agencies = topValues(records.flatMap((row) => splitSignalList(row["Source Organization Name"])), 5);
  const niches = topValues([
    ...records.flatMap((row) => splitSignalList(row["Creator Niche Requirement"])),
    ...splitSignalList(signal?.["Niche Signals"]),
  ], 8);
  const countries = topValues([
    ...records.flatMap((row) => splitSignalList(row["Creator Country Requirement"])),
    ...splitSignalList(signal?.["Country Signals"]),
  ], 8);
  const platforms = topValues([
    ...records.flatMap((row) => splitSignalList(row["Creator Platform Requirement"])),
    ...splitSignalList(signal?.["Platform Signals"]),
  ], 6);
  const opportunityTypes = topValues([
    ...records.flatMap((row) => splitSignalList(row["Opportunity Type"])),
    ...splitSignalList(signal?.["Campaign Type Signals"]),
    ...splitSignalList(agencySummary?.["Typical Opportunity Types"]),
  ], 8);
  const audienceTypes = topValues(records.flatMap((row) => audiencePitchSignals(row["Audience Requirement"])), 6);
  const creatorTypes = buildCreatorTypes({ niches, countries, audienceTypes, platforms });
  const pitchSignals = buildPitchSignals({ entityType, niches, countries, audienceTypes, opportunityTypes, records, signal });
  const confidenceValues = records.map((row) => Number(row["Confidence Score"]) || 0).filter((value) => value > 0);
  const avgConfidence = confidenceValues.length ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) : "";
  const tierCounts = countSimple(records.map((row) => row["GPT Export Tier"]));
  const budgetQuality = classifyBudgetQuality(records);
  const affiliateTendency = classifyTendency(records.filter((row) => /affiliate/i.test(row["Opportunity Type"]) || row["Affiliate Commission"]).length, records.length);
  const fixedFeeTendency = classifyTendency(records.filter((row) => hasFixedFeeSignal(row)).length, records.length);
  const songPromotionTendency = classifyTendency(records.filter((row) => /song promotion/i.test(row["Opportunity Type"])).length, records.length);
  const historicalStrength = classifyHistoricalStrength({ records, tierCounts, avgConfidence, signal });
  const relationshipStrength = classifyRelationshipStrength({ entityType, records, agencySummary });
  const bestDate = maxDate(records.map((row) => row["Source Email Date"]));
  const opportunityCount = entityType === "Agency" && agencySummary?.["Total Opportunities"]
    ? Math.max(records.length, Number(agencySummary["Total Opportunities"]) || 0)
    : records.length;

  return {
    "Entity Type": entityType,
    Brand: entityType === "Brand" ? name : brands.join("; "),
    Agency: entityType === "Agency" ? name : agencies.join("; "),
    "Typical Creator Types": creatorTypes.join("; "),
    "Typical Niches": niches.join("; "),
    "Typical Countries": countries.join("; "),
    "Typical Platforms": platforms.join("; "),
    "Budget Quality": budgetQuality,
    "Affiliate Tendency": affiliateTendency,
    "Fixed Fee Tendency": fixedFeeTendency,
    "Song Promotion Tendency": songPromotionTendency,
    "Historical Strength": historicalStrength,
    "Pitch Angle Signals": pitchSignals.join("; "),
    "Relationship Strength": relationshipStrength,
    "Priority Notes": priorityNotesForMatching({ entityType, name, records, budgetQuality, affiliateTendency, fixedFeeTendency, relationshipStrength, historicalStrength, opportunityTypes }),
    "Opportunity Count": String(opportunityCount),
    "Tier 1 Count": String(tierCounts["Tier 1"] ?? 0),
    "Tier 2 Count": String(tierCounts["Tier 2"] ?? 0),
    "Tier 3 Count": String(tierCounts["Tier 3"] ?? 0),
    "Average Confidence": String(avgConfidence),
    "Best Source Email Date": bestDate,
  };
}

function buildCreatorTypes({ niches, countries, audienceTypes, platforms }) {
  return unique([
    ...countries.slice(0, 5).map((country) => `${country} Creator`),
    ...niches.slice(0, 8).map((niche) => `${niche} Creator`),
    ...audienceTypes.slice(0, 4).map((audience) => `${audience} Audience Creator`),
    ...platforms.slice(0, 3).map((platform) => `${platform} Creator`),
  ]).slice(0, 12);
}

function buildPitchSignals({ entityType, niches, countries, audienceTypes, opportunityTypes, records, signal }) {
  const signals = [
    ...countries.slice(0, 5).map((country) => `${country} Creator`),
    ...niches.slice(0, 8).map((niche) => `${niche} Creator`),
    ...audienceTypes.slice(0, 5).map((audience) => `${audience} Audience`),
  ];
  if (records.some((row) => hasFixedFeeSignal(row))) signals.push("Fixed Fee Preferred");
  if (records.some((row) => /song promotion/i.test(row["Opportunity Type"]))) signals.push("Song Promotion Economics");
  if (records.some((row) => /affiliate/i.test(row["Opportunity Type"]))) signals.push("Affiliate Caveat");
  if (records.some((row) => /won|negotiating/i.test(row["Opportunity Status"]))) signals.push("Warm Historical Relationship");
  if (entityType === "Agency") signals.push("Ask For Current Briefs");
  if (signal?.["Historical Success Pattern"]) signals.push(`${signal["Historical Success Pattern"]} Historical Pattern`);
  if (opportunityTypes.length) signals.push(`${opportunityTypes.slice(0, 3).join(" / ")} Briefs`);
  return unique(signals).slice(0, 14);
}

function audiencePitchSignals(value) {
  const text = normalize(value);
  if (!hasUsefulSignal(value, "audience")) return [];
  const signals = [];
  if (/\bmom|mother|parent|family|baby|kids?\b/i.test(text)) signals.push("Parenting");
  if (/\bbeauty|skincare|makeup|hair\b/i.test(text)) signals.push("Beauty");
  if (/\bsport|football|soccer|basketball|athlete\b/i.test(text)) signals.push("Sports");
  if (/\bmusic|song|artist|audio\b/i.test(text)) signals.push("Music");
  if (/\blifestyle|daily|routine\b/i.test(text)) signals.push("Lifestyle");
  if (/\bgen z|teen|student|young\b/i.test(text)) signals.push("Gen Z");
  if (/\btech|ai|app|gaming|game\b/i.test(text)) signals.push("Tech");
  return signals;
}

function classifyBudgetQuality(records) {
  const counts = countSimple(records.map((row) => row["Commercial Quality"] || row["Budget Rating"] || "Unknown"));
  if ((counts.Strong ?? 0) >= Math.max(2, records.length * 0.4)) return "Strong fixed-fee pattern";
  if (((counts.Strong ?? 0) + (counts.Acceptable ?? 0)) >= Math.max(1, records.length * 0.45)) return "Acceptable / needs confirmation";
  if ((counts.Low ?? 0) > records.length * 0.35) return "Low budget concern";
  return "Mixed or unclear";
}

function classifyTendency(count, total) {
  if (!total || count === 0) return "Low";
  const rate = count / total;
  if (rate >= 0.6) return "High";
  if (rate >= 0.25) return "Medium";
  return "Low";
}

function hasFixedFeeSignal(row) {
  const amount = normalize(row["Budget Amount"]);
  const value = Number(row["Expected Deal Value"]) || 0;
  if (!amount || amount === "unknown" || value <= 0) return false;
  return !/affiliate/i.test(row["Opportunity Type"]) || value >= LOW_BUDGET_FLOOR;
}

function classifyHistoricalStrength({ records, tierCounts, avgConfidence, signal }) {
  const strongSignal = /strong/i.test(signal?.["Historical Success Pattern"]) || /strong/i.test(signal?.["Relationship Strength"]);
  if (strongSignal || (tierCounts["Tier 1"] ?? 0) >= 2 || records.length >= 5) return "Strong";
  if ((tierCounts["Tier 1"] ?? 0) >= 1 || records.length >= 2 || Number(avgConfidence) >= 90) return "Moderate";
  return "Emerging";
}

function classifyRelationshipStrength({ entityType, records, agencySummary }) {
  if (entityType === "Agency") {
    const total = Number(agencySummary?.["Total Opportunities"]) || records.length;
    const useful = normalize(agencySummary?.["Agency Usefulness"]);
    if (total >= 8 || useful === "high") return "High relationship asset";
    if (total >= 3 || useful === "medium") return "Medium relationship asset";
    return "Emerging relationship";
  }
  const directCount = records.filter((row) => normalize(row["Source Organization Type"]) === "brand").length;
  const agencyCount = records.filter((row) => normalize(row["Source Organization Type"]) !== "brand").length;
  if (directCount >= 2 || records.some((row) => /won|negotiating/i.test(row["Opportunity Status"]))) return "Warm brand relationship";
  if (agencyCount >= 2) return "Agency-mediated relationship";
  return "Emerging signal";
}

function priorityNotesForMatching({ entityType, name, records, budgetQuality, affiliateTendency, fixedFeeTendency, relationshipStrength, historicalStrength, opportunityTypes }) {
  const notes = [];
  if (entityType === "Agency") notes.push(`${name} should be treated as a relationship asset, not a single campaign.`);
  if (relationshipStrength.startsWith("High")) notes.push("Worth pitching for current briefs.");
  if (historicalStrength === "Strong") notes.push("Strong historical signal.");
  if (fixedFeeTendency === "High" || /strong/i.test(budgetQuality)) notes.push("Prioritize for fixed-fee creators.");
  if (affiliateTendency === "High") notes.push("Use mainly when creator accepts affiliate.");
  if (opportunityTypes.some((type) => /song promotion/i.test(type))) notes.push("Apply lower song-promotion budget expectations.");
  if (records.some((row) => !hasUsefulSignal(row["Creator Country Requirement"], "country"))) notes.push("Geography may need confirmation.");
  if (records.some((row) => !hasUsefulSignal(row["Budget Amount"]))) notes.push("Budget may need confirmation.");
  return unique(notes).slice(0, 5).join(" ");
}

function buildMatchingAudit(matchingRows, opportunities) {
  const brandRows = matchingRows.filter((row) => row["Entity Type"] === "Brand");
  const agencyRows = matchingRows.filter((row) => row["Entity Type"] === "Agency");
  const pitchSignalCounts = countSignals(matchingRows.flatMap((row) => splitSignalList(row["Pitch Angle Signals"])));
  const creatorProfileCounts = countSignals(matchingRows.flatMap((row) => splitSignalList(row["Typical Creator Types"])));
  return {
    strongestBrands: brandRows.sort((a, b) => matchingPriorityScore(b) - matchingPriorityScore(a)).slice(0, 12),
    strongestAgencies: agencyRows.sort((a, b) => matchingPriorityScore(b) - matchingPriorityScore(a)).slice(0, 12),
    mostUsefulPitchSignals: topCountEntries(pitchSignalCounts, 15),
    mostCommonCreatorProfiles: topCountEntries(creatorProfileCounts, 15),
    dataGaps: summarizeMatchingDataGaps(opportunities, matchingRows),
  };
}

function summarizeMatchingDataGaps(opportunities, matchingRows) {
  const count = opportunities.length || 1;
  return [
    `Budget needs confirmation on ${opportunities.filter((row) => !hasUsefulSignal(row["Budget Amount"])).length}/${count} curated opportunities.`,
    `Country/geography missing on ${opportunities.filter((row) => !hasUsefulSignal(row["Creator Country Requirement"], "country")).length}/${count} curated opportunities.`,
    `Audience detail missing or weak on ${opportunities.filter((row) => !hasUsefulSignal(row["Audience Requirement"], "audience")).length}/${count} curated opportunities.`,
    `Creator signal file covers ${matchingRows.filter((row) => row["Entity Type"] === "Brand" && row["Pitch Angle Signals"].includes("Historical Pattern")).length} brand rows with explicit historical pattern labels.`,
    `Agency rows now exist for ${matchingRows.filter((row) => row["Entity Type"] === "Agency").length} relationship assets.`,
  ];
}

function matchingPriorityScore(row) {
  let score = Number(row["Opportunity Count"]) * 10 + Number(row["Average Confidence"] || 0);
  score += Number(row["Tier 1 Count"]) * 30 + Number(row["Tier 2 Count"]) * 12;
  if (/strong/i.test(row["Historical Strength"])) score += 25;
  if (/high|warm/i.test(row["Relationship Strength"])) score += 20;
  if (/strong/i.test(row["Budget Quality"])) score += 20;
  if (/high/i.test(row["Fixed Fee Tendency"])) score += 10;
  if (/high/i.test(row["Affiliate Tendency"])) score -= 20;
  return score;
}

function buildAgencyCommercialRows(opportunities, { agencyRows }) {
  const { agencyGroups } = buildEntityGroups(opportunities);
  const agencyByName = new Map(agencyRows.map((row) => [compactKey(row["Organization Name"]), row]));
  return [...agencyGroups.entries()]
    .map(([agency, records]) => {
      const agencySummary = agencyByName.get(compactKey(agency));
      const metrics = commercialMetrics(records);
      const relationship = relationshipMetrics({ entityType: "Agency", records, summaryRow: agencySummary });
      const opportunityTypes = topValues([
        ...records.flatMap((row) => splitSignalList(row["Opportunity Type"])),
        ...splitSignalList(agencySummary?.["Typical Opportunity Types"]),
      ], 8);
      const niches = topValues(records.flatMap((row) => splitSignalList(row["Creator Niche Requirement"])), 8);
      const countries = topValues(records.flatMap((row) => splitSignalList(row["Creator Country Requirement"])), 6);
      const platforms = topValues(records.flatMap((row) => splitSignalList(row["Creator Platform Requirement"])), 5);
      const audienceTypes = topValues(records.flatMap((row) => audiencePitchSignals(row["Audience Requirement"])), 5);
      const creatorTypes = buildCreatorTypes({ niches, countries, audienceTypes, platforms });
      const opportunityCount = Math.max(records.length, Number(agencySummary?.["Total Opportunities"]) || 0);
      const worthPitching = agencyWorthPitching({ metrics, relationship, opportunityCount });
      return {
        Agency: agency,
        "Typical Campaign Categories": opportunityTypes.join("; "),
        "Typical Creator Types": creatorTypes.join("; "),
        "Fixed Fee Tendency": metrics.fixedFeeTendency,
        "Affiliate Tendency": metrics.affiliateTendency,
        "Song Promotion Tendency": metrics.songPromotionTendency,
        "Budget Quality Tendency": metrics.budgetQuality,
        "Low Budget Tendency": metrics.lowBudgetTendency,
        "Unknown Budget Tendency": metrics.unknownBudgetTendency,
        "Opportunity Frequency": opportunityFrequencyLabel(opportunityCount),
        "Historical Opportunity Count": String(opportunityCount),
        "Historical Contact Count": String(relationship.contactCount),
        "Historical Email Thread Count": String(relationship.threadCount),
        "Relationship Strength Score": String(relationship.score),
        "Relationship Strength": relationship.label,
        "Generally Worth Pitching": worthPitching,
        "Priority Notes": agencyCommercialNotes({ agency, metrics, relationship, opportunityTypes, worthPitching }),
        "Best Source Email Date": relationship.bestDate,
      };
    })
    .sort((a, b) => {
      const scoreA = Number(a["Relationship Strength Score"]) + Number(a["Historical Opportunity Count"]) * 5 + commercialTendencyScore(a);
      const scoreB = Number(b["Relationship Strength Score"]) + Number(b["Historical Opportunity Count"]) * 5 + commercialTendencyScore(b);
      return scoreB - scoreA;
    })
    .slice(0, 250);
}

function buildBrandCommercialRows(opportunities, { signalRows }) {
  const { brandGroups } = buildEntityGroups(opportunities);
  const signalByBrand = new Map(signalRows.map((row) => [compactKey(row.Brand), row]));
  return [...brandGroups.entries()]
    .map(([brand, records]) => {
      const signal = signalByBrand.get(compactKey(brand));
      const metrics = commercialMetrics(records);
      const relationship = relationshipMetrics({ entityType: "Brand", records });
      const niches = topValues([
        ...records.flatMap((row) => splitSignalList(row["Creator Niche Requirement"])),
        ...splitSignalList(signal?.["Niche Signals"]),
      ], 8);
      const countries = topValues([
        ...records.flatMap((row) => splitSignalList(row["Creator Country Requirement"])),
        ...splitSignalList(signal?.["Country Signals"]),
      ], 6);
      const platforms = topValues([
        ...records.flatMap((row) => splitSignalList(row["Creator Platform Requirement"])),
        ...splitSignalList(signal?.["Platform Signals"]),
      ], 5);
      const tierCounts = countSimple(records.map((row) => row["GPT Export Tier"]));
      const confidenceValues = records.map((row) => Number(row["Confidence Score"]) || 0).filter((value) => value > 0);
      const avgConfidence = confidenceValues.length ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length) : 0;
      const historicalStrength = classifyHistoricalStrength({ records, tierCounts, avgConfidence, signal });
      return {
        Brand: brand,
        "Typical Creator Niches": niches.join("; "),
        "Typical Countries": countries.join("; "),
        "Typical Platforms": platforms.join("; "),
        "Typical Budget Quality": metrics.budgetQuality,
        "Typical Deal Structure": metrics.dealStructure,
        "Fixed Fee Tendency": metrics.fixedFeeTendency,
        "Affiliate Tendency": metrics.affiliateTendency,
        "Song Promotion Tendency": metrics.songPromotionTendency,
        "Historical Opportunity Count": String(records.length),
        "Historical Contact Count": String(relationship.contactCount),
        "Historical Email Thread Count": String(relationship.threadCount),
        "Relationship Strength Score": String(relationship.score),
        "Relationship Strength": relationship.label,
        "Historical Opportunity Strength": historicalStrength,
        "Priority Notes": brandCommercialNotes({ brand, metrics, relationship, historicalStrength, niches, countries }),
        "Best Source Email Date": relationship.bestDate,
      };
    })
    .sort((a, b) => {
      const scoreA = Number(a["Relationship Strength Score"]) + Number(a["Historical Opportunity Count"]) * 8 + commercialTendencyScore(a);
      const scoreB = Number(b["Relationship Strength Score"]) + Number(b["Historical Opportunity Count"]) * 8 + commercialTendencyScore(b);
      return scoreB - scoreA;
    })
    .slice(0, 250);
}

function buildPitchAngleRows(matchingIntelligenceRows) {
  return matchingIntelligenceRows
    .map((row) => {
      const signals = splitSignalList(row["Pitch Angle Signals"]);
      const strongest = signals.filter((signal) => !/caveat|ask for current|fixed fee|economics|historical pattern/i.test(signal)).slice(0, 5);
      const fallbackStrongest = strongest.length ? strongest : signals.slice(0, 4);
      const supporting = signals.filter((signal) => !fallbackStrongest.includes(signal)).slice(0, 8);
      const confidence = pitchAngleConfidence(row);
      const entityType = row["Entity Type"];
      return {
        "Entity Type": entityType,
        Brand: row.Brand,
        Agency: row.Agency,
        "Strongest Pitch Angles": fallbackStrongest.join("; "),
        "Supporting Pitch Angles": supporting.join("; "),
        Confidence: String(confidence),
        "Opportunity Count": row["Opportunity Count"],
        "Evidence Notes": pitchAngleEvidenceNotes({ entityType, row, confidence }),
      };
    })
    .filter((row) => row["Strongest Pitch Angles"])
    .sort((a, b) => Number(b.Confidence) - Number(a.Confidence) || Number(b["Opportunity Count"]) - Number(a["Opportunity Count"]))
    .slice(0, 350);
}

function buildOpportunityPriorityRows(opportunities, { brandCommercialRows, agencyCommercialRows, matchingIntelligenceRows }) {
  const brandCommercialByName = new Map(brandCommercialRows.map((row) => [compactKey(row.Brand), row]));
  const agencyCommercialByName = new Map(agencyCommercialRows.map((row) => [compactKey(row.Agency), row]));
  const brandMatchingByName = new Map(
    matchingIntelligenceRows
      .filter((row) => row["Entity Type"] === "Brand")
      .map((row) => [compactKey(row.Brand), row]),
  );
  const agencyMatchingByName = new Map(
    matchingIntelligenceRows
      .filter((row) => row["Entity Type"] === "Agency")
      .map((row) => [compactKey(row.Agency), row]),
  );

  return opportunities
    .map((row) => {
      const brand = row["Brand Name"];
      const agency = row["Source Organization Name"];
      const brandCommercial = brandCommercialByName.get(compactKey(brand));
      const agencyCommercial = agencyCommercialByName.get(compactKey(agency));
      const brandMatching = brandMatchingByName.get(compactKey(brand));
      const agencyMatching = agencyMatchingByName.get(compactKey(agency));
      const bestMatching = bestMatchingContext(brandMatching, agencyMatching);
      const relationshipScore = Math.max(
        Number(brandCommercial?.["Relationship Strength Score"]) || 0,
        Number(agencyCommercial?.["Relationship Strength Score"]) || 0,
      );
      const commercialScore = commercialQualityScore(row);
      const creatorScore = creatorSignalStrengthForExportRow(row);
      const geographyScore = geographyStrengthForExportRow(row);
      const historicalLabel = bestMatching?.["Historical Strength"] || "Emerging";
      const historicalScore = historicalStrengthScore(historicalLabel, relationshipScore);
      const priorityScore = clamp(
        Math.round(commercialScore * 0.32 + relationshipScore * 0.2 + creatorScore * 0.23 + geographyScore * 0.15 + historicalScore * 0.1),
        0,
        100,
      );
      return {
        "Opportunity ID": row["Opportunity ID"],
        Brand: brand,
        Agency: agency,
        "GPT Export Tier": row["GPT Export Tier"],
        "Commercial Quality Score": String(commercialScore),
        "Relationship Score": String(relationshipScore),
        "Creator Signal Strength": String(creatorScore),
        "Geography Strength": String(geographyScore),
        "Historical Strength": historicalLabel,
        "Priority Score": String(priorityScore),
        "Priority Notes": priorityNotesForOpportunity({ row, commercialScore, relationshipScore, creatorScore, geographyScore, historicalLabel, priorityScore }),
      };
    })
    .sort((a, b) => Number(b["Priority Score"]) - Number(a["Priority Score"]))
    .slice(0, 500);
}

function buildGptReadinessAuditData({
  opportunities,
  reviewCandidates,
  brandRows,
  agencyRows,
  signalRows,
  matchingIntelligenceRows,
  agencyCommercialRows,
  brandCommercialRows,
  pitchAngleRows,
  opportunityPriorityRows,
}) {
  const curatedCount = opportunities.length || 1;
  const tierCounts = countBy(opportunities, "GPT Export Tier");
  const tierOneRate = (tierCounts["Tier 1"] ?? 0) / curatedCount;
  const missingBudgetRate = opportunities.filter(isUnknownBudgetRow).length / curatedCount;
  const lowBudgetRate = opportunities.filter(isLowBudgetRow).length / curatedCount;
  const highRelationshipCount = [...agencyCommercialRows, ...brandCommercialRows].filter((row) => Number(row["Relationship Strength Score"]) >= 70).length;
  const highPitchCount = pitchAngleRows.filter((row) => Number(row.Confidence) >= 75).length;
  const highPriorityCount = opportunityPriorityRows.filter((row) => Number(row["Priority Score"]) >= 70).length;
  const databaseQuality = clamp(Math.round(70 + (opportunities.length >= 150 ? 8 : 0) + (tierOneRate <= 0.55 ? 8 : -8) - missingBudgetRate * 20 - lowBudgetRate * 12), 0, 100);
  const relationshipIntelligence = clamp(Math.round(55 + Math.min(25, highRelationshipCount * 2) + (agencyCommercialRows.length >= 50 ? 12 : 0) + (brandCommercialRows.length >= 50 ? 8 : 0)), 0, 100);
  const commercialIntelligence = clamp(Math.round(62 + (agencyCommercialRows.length && brandCommercialRows.length ? 12 : 0) + (1 - missingBudgetRate) * 14 - lowBudgetRate * 12), 0, 100);
  const pitchIntelligence = clamp(Math.round(58 + Math.min(24, highPitchCount * 1.5) + (pitchAngleRows.length >= 100 ? 10 : 0)), 0, 100);
  const matchingReadiness = clamp(Math.round(55 + Math.min(20, highPriorityCount * 0.4) + (matchingIntelligenceRows.length >= 200 ? 12 : 0) + (signalRows.length >= 20 ? 8 : 0)), 0, 100);
  const scores = {
    databaseQuality,
    relationshipIntelligence,
    commercialIntelligence,
    pitchIntelligence,
    matchingReadiness,
    overall: Math.round((databaseQuality + relationshipIntelligence + commercialIntelligence + pitchIntelligence + matchingReadiness) / 5),
  };
  return {
    scores,
    counts: {
      curatedOpportunities: opportunities.length,
      reviewBeforeUse: reviewCandidates.length,
      brandIntelligence: brandRows.length,
      agencyIntelligence: agencyRows.length,
      creatorSignals: signalRows.length,
      matchingIntelligence: matchingIntelligenceRows.length,
      agencyCommercial: agencyCommercialRows.length,
      brandCommercial: brandCommercialRows.length,
      pitchAngles: pitchAngleRows.length,
      opportunityPriority: opportunityPriorityRows.length,
    },
    strengths: [
      `Relationship strength is now scored across ${agencyCommercialRows.length + brandCommercialRows.length} brand and agency entities.`,
      `Commercial reputation is now separated from individual campaign rows.`,
      `Pitch angles are now structured for creator matching instead of buried in notes.`,
      `Priority scores now combine commercial quality, relationship warmth, creator fit, geography, and historical strength.`,
    ],
    weaknesses: readinessWeaknesses({ opportunities, reviewCandidates, signalRows, missingBudgetRate, lowBudgetRate, tierOneRate }),
    recommendation: scores.overall >= 75 ? "Ready to begin Custom GPT creation next." : "Improve the flagged weaknesses before Custom GPT creation.",
  };
}

function buildEntityGroups(opportunities) {
  const brandGroups = new Map();
  const agencyGroups = new Map();
  for (const row of opportunities) {
    const brand = row["Brand Name"];
    const agency = row["Source Organization Name"];
    if (brand && brandNameReviewReasons(brand, { subject: row["Source Email Subject"] }).length === 0) {
      addMatchingRecord(brandGroups, brand, row);
    }
    if (agency && isUsefulSource(agency, row["Source Organization Type"])) {
      addMatchingRecord(agencyGroups, agency, row);
    }
  }
  return { brandGroups, agencyGroups };
}

function commercialMetrics(records) {
  const total = records.length || 1;
  const fixedFeeCount = records.filter(hasFixedFeeSignal).length;
  const affiliateCount = records.filter(isAffiliateRow).length;
  const songCount = records.filter(isSongPromotionRow).length;
  const lowBudgetCount = records.filter(isLowBudgetRow).length;
  const unknownBudgetCount = records.filter(isUnknownBudgetRow).length;
  return {
    fixedFeeTendency: classifyTendency(fixedFeeCount, total),
    affiliateTendency: classifyTendency(affiliateCount, total),
    songPromotionTendency: classifyTendency(songCount, total),
    lowBudgetTendency: classifyTendency(lowBudgetCount, total),
    unknownBudgetTendency: classifyTendency(unknownBudgetCount, total),
    budgetQuality: classifyBudgetQuality(records),
    dealStructure: dealStructureLabel({ fixedFeeCount, affiliateCount, songCount, unknownBudgetCount, total }),
  };
}

function relationshipMetrics({ entityType, records, summaryRow }) {
  const contactIds = unique(
    records
      .map((row) => row["Contact Email"] || row["Contact Name"])
      .filter((value) => hasUsefulSignal(value)),
  );
  const threadIds = unique(
    records
      .map((row) => row["Source Email Link"] || row["Source Email Subject"])
      .filter((value) => hasUsefulSignal(value)),
  );
  const summaryOpportunityCount = Number(summaryRow?.["Total Opportunities"]) || 0;
  const opportunityCount = Math.max(records.length, summaryOpportunityCount);
  const bestDate = maxDate(records.map((row) => row["Source Email Date"]));
  let score = opportunityCount * 8 + contactIds.length * 7 + threadIds.length * 3;
  if (records.some((row) => /won|negotiating/i.test(row["Opportunity Status"]))) score += 10;
  if (records.some((row) => normalize(row["Source Organization Type"]) === "brand")) score += entityType === "Brand" ? 8 : 3;
  if (isRecentIsoDate(bestDate, 365)) score += 8;
  const usefulness = normalize(summaryRow?.["Agency Usefulness"]);
  if (usefulness === "high") score += 12;
  if (usefulness === "medium") score += 6;
  score = clamp(Math.round(score), 0, 100);
  return {
    score,
    label: relationshipLabelFromScore(score, entityType),
    contactCount: contactIds.length,
    threadCount: threadIds.length,
    bestDate,
  };
}

function dealStructureLabel({ fixedFeeCount, affiliateCount, songCount, unknownBudgetCount, total }) {
  if (fixedFeeCount / total >= 0.6 && affiliateCount / total < 0.25) return "Fixed-fee led";
  if (affiliateCount / total >= 0.5 && fixedFeeCount / total < 0.35) return "Affiliate-led";
  if (songCount / total >= 0.35) return "Song-promotion recurring";
  if (unknownBudgetCount / total >= 0.5) return "Budget unclear";
  return "Mixed deal structure";
}

function opportunityFrequencyLabel(count) {
  if (count >= 8) return "Frequent";
  if (count >= 3) return "Recurring";
  return "Emerging";
}

function relationshipLabelFromScore(score, entityType) {
  if (score >= 75) return entityType === "Agency" ? "High relationship asset" : "Warm brand relationship";
  if (score >= 45) return entityType === "Agency" ? "Medium relationship asset" : "Developing brand relationship";
  return "Emerging relationship";
}

function agencyWorthPitching({ metrics, relationship, opportunityCount }) {
  if (relationship.score >= 70 && metrics.affiliateTendency !== "High") return "Yes";
  if (opportunityCount >= 5 && metrics.lowBudgetTendency !== "High") return "Yes";
  if (metrics.fixedFeeTendency === "High" && metrics.unknownBudgetTendency !== "High") return "Yes";
  if (metrics.affiliateTendency === "High" || metrics.lowBudgetTendency === "High") return "Conditional";
  return "Maybe";
}

function agencyCommercialNotes({ agency, metrics, relationship, opportunityTypes, worthPitching }) {
  const notes = [`${agency} is an agency relationship asset, not a single campaign.`];
  if (worthPitching === "Yes") notes.push("Worth asking for current briefs.");
  if (relationship.score >= 70) notes.push("Warm relationship signal.");
  if (metrics.fixedFeeTendency === "High") notes.push("Fixed-fee tendency is strong.");
  if (metrics.affiliateTendency === "High") notes.push("Check for affiliate-only briefs before recommending.");
  if (metrics.lowBudgetTendency === "High") notes.push("Budget floor may be an issue.");
  if (metrics.unknownBudgetTendency === "High") notes.push("Budget often needs confirmation.");
  if (opportunityTypes.some((type) => /song promotion/i.test(type))) notes.push("Song promotion economics may apply.");
  return unique(notes).slice(0, 5).join(" ");
}

function brandCommercialNotes({ brand, metrics, relationship, historicalStrength, niches, countries }) {
  const notes = [];
  if (historicalStrength === "Strong") notes.push(`${brand} has strong historical opportunity signal.`);
  if (relationship.score >= 70) notes.push("Warm brand relationship.");
  if (metrics.fixedFeeTendency === "High") notes.push("Prefer for fixed-fee creators.");
  if (metrics.affiliateTendency === "High") notes.push("Affiliate caution.");
  if (metrics.lowBudgetTendency === "High") notes.push("Budget floor may be an issue.");
  if (niches.length || countries.length) notes.push(`Best pitch evidence: ${[...countries.slice(0, 2), ...niches.slice(0, 2)].join(", ")}.`);
  return unique(notes).slice(0, 5).join(" ");
}

function commercialTendencyScore(row) {
  let score = 0;
  if (row["Fixed Fee Tendency"] === "High") score += 20;
  if (row["Affiliate Tendency"] === "High") score -= 18;
  if (row["Low Budget Tendency"] === "High") score -= 15;
  if (row["Unknown Budget Tendency"] === "High") score -= 8;
  if (/strong/i.test(row["Typical Budget Quality"] || row["Budget Quality Tendency"])) score += 18;
  return score;
}

function pitchAngleConfidence(row) {
  let score = Number(row["Average Confidence"]) || 55;
  score += Math.min(20, Number(row["Opportunity Count"]) * 4);
  score += Math.min(15, Number(row["Tier 1 Count"]) * 5);
  if (/strong/i.test(row["Historical Strength"])) score += 8;
  if (/high|warm/i.test(row["Relationship Strength"])) score += 8;
  return clamp(Math.round(score), 0, 100);
}

function pitchAngleEvidenceNotes({ entityType, row, confidence }) {
  const notes = [];
  if (entityType === "Agency") notes.push("Use as a relationship route for current briefs.");
  if (entityType === "Brand") notes.push("Use as a brand preference signal.");
  if (row["Budget Quality"]) notes.push(row["Budget Quality"]);
  if (row["Relationship Strength"]) notes.push(row["Relationship Strength"]);
  if (confidence < 70) notes.push("Use as supporting context, not a direct recommendation.");
  return unique(notes).slice(0, 4).join(" ");
}

function bestMatchingContext(brandMatching, agencyMatching) {
  if (!brandMatching) return agencyMatching;
  if (!agencyMatching) return brandMatching;
  return matchingPriorityScore(agencyMatching) > matchingPriorityScore(brandMatching) ? agencyMatching : brandMatching;
}

function commercialQualityScore(row) {
  let score = 48;
  if (/strong/i.test(row["Commercial Quality"])) score = 82;
  else if (/acceptable/i.test(row["Commercial Quality"])) score = 66;
  else if (/low/i.test(row["Commercial Quality"] || row["Budget Rating"])) score = 30;
  if (hasFixedFeeSignal(row)) score += 10;
  if (isAffiliateOnlyRow(row)) score -= 22;
  if (isLowBudgetRow(row)) score -= 18;
  if (isUnknownBudgetRow(row)) score -= 10;
  if (isSongPromotionRow(row) && opportunityBudgetValue(row) >= SONG_PROMOTION_LOW_BUDGET_FLOOR) score += 5;
  if (opportunityBudgetValue(row) >= 2500) score += 8;
  return clamp(Math.round(score), 0, 100);
}

function creatorSignalStrengthForExportRow(row) {
  let score = 0;
  if (hasUsefulSignal(row["Creator Country Requirement"], "country")) score += 25;
  if (hasUsefulSignal(row["Creator Niche Requirement"], "niche")) score += 25;
  if (hasUsefulSignal(row["Audience Requirement"], "audience")) score += 18;
  if (hasUsefulSignal(row["Creator Platform Requirement"], "platform")) score += 10;
  if (hasUsefulSignal(row["Creator Language Requirement"], "language")) score += 7;
  if (hasUsefulSignal(row["Follower Range Requirement"], "followers")) score += 5;
  if (hasUsefulSignal(row["Special Creator Requirements"], "special")) score += 5;
  if (hasUsefulSignal(row["Deliverables"], "deliverables")) score += 5;
  return clamp(score, 0, 100);
}

function geographyStrengthForExportRow(row) {
  const countries = splitSignalList(row["Creator Country Requirement"]);
  if (countries.length >= 2) return 90;
  if (countries.length === 1) return 78;
  if (hasUsefulSignal(row["Creator Language Requirement"], "language")) return 45;
  return 20;
}

function historicalStrengthScore(label, relationshipScore) {
  let score = 35;
  if (/strong/i.test(label)) score = 85;
  else if (/moderate/i.test(label)) score = 65;
  else if (/emerging/i.test(label)) score = 45;
  return clamp(Math.round(score + relationshipScore * 0.15), 0, 100);
}

function priorityNotesForOpportunity({ row, commercialScore, relationshipScore, creatorScore, geographyScore, historicalLabel, priorityScore }) {
  const notes = [];
  if (priorityScore >= 75) notes.push("Strong manager shortlist candidate.");
  else if (priorityScore >= 60) notes.push("Useful match, confirm details before pitching.");
  else notes.push("Supporting context only.");
  if (commercialScore >= 75) notes.push("Commercial quality is strong.");
  if (relationshipScore >= 70) notes.push("Warm relationship route exists.");
  if (creatorScore < 45) notes.push("Creator fit fields are partial.");
  if (geographyScore < 50) notes.push("Geography needs confirmation.");
  if (/historical/i.test(row["GPT Match Use"]) || /historical/i.test(historicalLabel)) notes.push("Treat as historical signal, not guaranteed active.");
  if (isAffiliateOnlyRow(row)) notes.push("Affiliate-only caution.");
  if (isUnknownBudgetRow(row)) notes.push("Budget needs confirmation.");
  if (isSongPromotionRow(row)) notes.push("Song-promotion economics may allow lower rate.");
  return unique(notes).slice(0, 5).join(" ");
}

function readinessWeaknesses({ opportunities, reviewCandidates, signalRows, missingBudgetRate, lowBudgetRate, tierOneRate }) {
  const weaknesses = [];
  const count = opportunities.length || 1;
  const weakAudienceCount = opportunities.filter((row) => !hasUsefulSignal(row["Audience Requirement"], "audience")).length;
  const missingCountryCount = opportunities.filter((row) => !hasUsefulSignal(row["Creator Country Requirement"], "country")).length;
  if (missingBudgetRate > 0.1) weaknesses.push(`${Math.round(missingBudgetRate * count)} curated opportunities still need budget confirmation.`);
  if (lowBudgetRate > 0.1) weaknesses.push(`${Math.round(lowBudgetRate * count)} curated opportunities have low-budget concern.`);
  if (weakAudienceCount > count * 0.4) weaknesses.push(`${weakAudienceCount}/${count} curated opportunities have weak audience detail.`);
  if (missingCountryCount > count * 0.2) weaknesses.push(`${missingCountryCount}/${count} curated opportunities are missing geography.`);
  if (tierOneRate > 0.6) weaknesses.push("Tier 1 is still too broad and should be tightened further.");
  if (signalRows.length < 50) weaknesses.push("Creator signal coverage is useful but still limited.");
  if (reviewCandidates.length > opportunities.length * 2) weaknesses.push("Review-before-use pool is large, so keep it out of GPT Knowledge for now.");
  return weaknesses.length ? weaknesses : ["No blocking weakness found for first GPT creation."];
}

function isAffiliateRow(row) {
  return /affiliate/i.test(row["Opportunity Type"]) || hasUsefulSignal(row["Affiliate Commission"]);
}

function isAffiliateOnlyRow(row) {
  return isAffiliateRow(row) && !hasFixedFeeSignal(row) && !isSongPromotionRow(row);
}

function isSongPromotionRow(row) {
  return /song promotion/i.test(row["Opportunity Type"]);
}

function isUnknownBudgetRow(row) {
  return !hasUsefulSignal(row["Budget Amount"]) && opportunityBudgetValue(row) <= 0;
}

function isLowBudgetRow(row) {
  const value = opportunityBudgetValue(row);
  const threshold = isSongPromotionRow(row) ? SONG_PROMOTION_LOW_BUDGET_FLOOR : LOW_BUDGET_FLOOR;
  if (/low/i.test(`${row["Commercial Quality"]} ${row["Budget Rating"]} ${row["Disqualifier Flags"]}`)) return true;
  return value > 0 && value < threshold;
}

function opportunityBudgetValue(row) {
  const expected = Number(row["Expected Deal Value"]) || 0;
  if (expected > 0) return expected;
  const match = String(row["Budget Amount"] ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function isRecentIsoDate(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function signalScore({ tier, commercialQuality, stillValuable }) {
  let score = 0;
  if (tier === "Tier 1") score += 100;
  else if (tier === "Tier 2") score += 80;
  else if (tier === "Tier 3") score += 60;
  else if (tier === "Tier 4") score += 20;
  if (commercialQuality === "Strong") score += 20;
  else if (commercialQuality === "Acceptable") score += 10;
  if (stillValuable === "Yes") score += 10;
  return score;
}

function brandNameReviewReasons(brandName, { subject } = {}) {
  const reasons = [];
  const normalized = normalize(brandName);
  const compact = compactKey(brandName);
  if (!brandName || isGenericName(brandName) || KNOWN_POLLUTED_NAMES.has(normalized) || KNOWN_POLLUTED_NAMES.has(compact)) {
    reasons.push("Brand name is generic or known polluted extraction.");
  }
  if (String(brandName).length > 48) reasons.push("Brand name is unusually long.");
  if (wordCount(brandName) > 4 && !/\b(ai|app|beauty|games|media|agency|studio|labs|shop|global|official)\b/i.test(brandName)) {
    reasons.push("Brand name looks like a sentence fragment.");
  }
  if (containsMultiEntityHint(brandName)) reasons.push("Brand name appears to contain multiple entities.");
  if (SUSPICIOUS_NAME_PATTERNS.some((pattern) => pattern.test(brandName))) {
    reasons.push("Brand name looks extracted from email text.");
  }
  if (/\b(agency|mcn|media|marketing|talent|creator)\b/i.test(brandName) && !/\b(beauty|games|app|ai|shop|official)\b/i.test(brandName)) {
    reasons.push("Brand name looks like an agency/source, not a brand.");
  }
  if (subject && compact.length > 5 && compactKey(subject).includes(compact) && wordCount(brandName) > 3) {
    reasons.push("Brand name looks copied from the email subject.");
  }
  if (/^[a-z]{1,2}$/i.test(String(brandName).trim())) reasons.push("Brand name is too short.");
  return unique(reasons);
}

function sourceNameReviewReasons(sourceOrganizationName, sourceOrganizationType) {
  const reasons = [];
  const normalized = normalize(sourceOrganizationName);
  if (!sourceOrganizationName || isGenericName(sourceOrganizationName)) reasons.push("Source organization is generic or unclear.");
  if (KNOWN_POLLUTED_NAMES.has(normalized)) reasons.push("Source organization looks polluted.");
  if (SUSPICIOUS_NAME_PATTERNS.some((pattern) => pattern.test(sourceOrganizationName))) reasons.push("Source organization looks extracted from email text.");
  if (normalize(sourceOrganizationType) === "other" && wordCount(sourceOrganizationName) <= 1) reasons.push("Source organization type is weak.");
  return unique(reasons);
}

function creatorSignalProfile(row, headerMap) {
  const fields = {
    platform: getCell(row, headerMap, "Creator Platform Requirement"),
    niche: getCell(row, headerMap, "Creator Niche Requirement"),
    country: getCell(row, headerMap, "Creator Country Requirement"),
    language: getCell(row, headerMap, "Creator Language Requirement"),
    followers: getCell(row, headerMap, "Follower Range Requirement"),
    audience: getCell(row, headerMap, "Audience Requirement"),
    special: getCell(row, headerMap, "Special Creator Requirements"),
    deliverables: getCell(row, headerMap, "Deliverables"),
  };
  const weights = {
    country: 2,
    niche: 2,
    audience: 2,
    language: 1,
    followers: 1,
    special: 1,
    deliverables: 1,
    platform: 0.5,
  };
  const usefulFields = Object.entries(fields)
    .filter(([field, value]) => hasUsefulSignal(value, field))
    .map(([field]) => field);
  return {
    score: usefulFields.reduce((sum, field) => sum + (weights[field] ?? 1), 0),
    usefulFields,
  };
}

function hasUsefulSignal(value, field = "") {
  const normalized = normalize(value);
  if (!normalized || ["unknown", "not specified", "n/a", "na", "none"].includes(normalized)) return false;
  if (normalized.length < 2) return false;
  if (/^unknown\b|not specified|no preference/i.test(normalized)) return false;
  if (field === "audience" && WEAK_AUDIENCE_PATTERNS.some((pattern) => pattern.test(value))) return false;
  if (field === "country" && /\b(countries|location|demographics|insights)\b/i.test(normalized)) return false;
  if (field === "niche" && /\b(creator|campaign|brand|content)\b/i.test(normalized) && wordCount(normalized) > 4) return false;
  return true;
}

function isUsefulSource(sourceOrganizationName, sourceOrganizationType) {
  if (!sourceOrganizationName || sourceNameReviewReasons(sourceOrganizationName, sourceOrganizationType).length > 0) return false;
  const normalizedType = normalize(sourceOrganizationType);
  return SOURCE_TYPES_WITH_MATCHING_VALUE.has(normalizedType) || wordCount(sourceOrganizationName) >= 2;
}

function looksNonActionableMarketing({ subject, campaignSummary, opportunityType, budgetAmount, deliverables }) {
  const text = `${subject} ${campaignSummary}`.toLowerCase();
  const hasCommercialSpecifics = normalize(budgetAmount) && normalize(budgetAmount) !== "unknown";
  const hasDeliverables = normalize(deliverables) && normalize(deliverables) !== "unknown";
  const directOpportunityType = /paid campaign|whitelisting|ugc|song promotion|app promotion|ambassador/i.test(opportunityType);
  if (!NON_ACTIONABLE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return !hasCommercialSpecifics && !hasDeliverables && !directOpportunityType;
}

function auditFlags({ affiliateOnlyConcern, lowBudget, missingBudget, suspiciousBrand, needsReview, historicalSignal, nonActionableMarketing }) {
  return [
    affiliateOnlyConcern ? "Affiliate Only" : "",
    lowBudget ? "Low Budget" : "",
    missingBudget ? "Missing Budget" : "",
    suspiciousBrand ? "Suspicious Brand Name" : "",
    needsReview ? "Needs Human Review" : "",
    historicalSignal ? "Historical Signal" : "",
    nonActionableMarketing ? "Non-actionable Marketing" : "",
  ].filter(Boolean);
}

function exportNotesFor(tier, downgradeReasons, creatorSignal) {
  const notes = [];
  if (tier === "Tier 1") notes.push("Best shortlist candidate. Still rank against creator fit and current availability before recommending.");
  if (tier === "Tier 2") notes.push("Useful opportunity, but one important field needs checking before a firm recommendation.");
  if (tier === "Tier 3") notes.push("Supporting pattern only. Do not present as a direct recommendation unless the user asks for broad ideas.");
  if (creatorSignal.usefulFields.length > 0) notes.push(`Creator fit signals: ${creatorSignal.usefulFields.join(", ")}.`);
  for (const reason of downgradeReasons.slice(0, 3)) notes.push(reason);
  return notes;
}

function buildAudit(
  opportunityExport,
  {
    brandRows,
    agencyRows,
    signalRows,
    matchingIntelligenceRows,
    matchingAudit,
    agencyCommercialRows,
    brandCommercialRows,
    pitchAngleRows,
    opportunityPriorityRows,
    readinessAudit,
  },
) {
  const evaluations = opportunityExport.evaluations;
  const review = evaluations.filter((item) => item.bucket === "review");
  const removed = evaluations.filter((item) => item.bucket === "removed");
  const curated = evaluations.filter((item) => item.bucket === "curated");
  const tierCounts = countBy(curated.map((item) => item.exportRow), "GPT Export Tier");
  const flagged = (flag) => evaluations.filter((item) => item.audit?.flags?.includes(flag));
  const downgraded = curated.filter((item) => item.exportRow["GPT Export Tier"] !== "Tier 1");
  return {
    curatedCount: curated.length,
    tierCounts,
    reviewBeforeUseCount: review.length,
    removedCount: removed.length,
    intelligenceCounts: {
      brands: brandRows.length,
      agencies: agencyRows.length,
      creatorSignals: signalRows.length,
      matchingIntelligence: matchingIntelligenceRows.length,
      agencyCommercial: agencyCommercialRows.length,
      brandCommercial: brandCommercialRows.length,
      pitchAngles: pitchAngleRows.length,
      opportunityPriority: opportunityPriorityRows.length,
    },
    matchingAudit,
    readinessAudit,
    suspiciousBrandNames: summarizeAuditExamples(flagged("Suspicious Brand Name")),
    affiliateOnlyRows: summarizeAuditExamples(flagged("Affiliate Only")),
    lowBudgetRows: summarizeAuditExamples(flagged("Low Budget")),
    missingBudgetRows: summarizeAuditExamples(flagged("Missing Budget")),
    nonActionableRows: summarizeAuditExamples(flagged("Non-actionable Marketing")),
    downgradedRows: summarizeAuditExamples(downgraded),
    removedRows: summarizeAuditExamples(removed),
  };
}

function summarizeAuditExamples(items, limit = 12) {
  const examples = [];
  for (const item of items) {
    const audit = item.audit ?? {};
    if (!audit.brandName && !audit.subject) continue;
    examples.push({
      opportunityId: audit.opportunityId,
      brandName: audit.brandName,
      sourceOrganizationName: audit.sourceOrganizationName,
      subject: audit.subject,
      action: audit.action,
      reasons: unique(audit.reasons ?? []).slice(0, 4),
      flags: audit.flags ?? [],
    });
    if (examples.length >= limit) break;
  }
  return {
    count: items.length,
    examples,
  };
}

function projectRow(row, headerMap, headers, overrides = {}) {
  return Object.fromEntries(headers.map((header) => [header, overrides[header] ?? getCell(row, headerMap, header)]));
}

async function writeExportFiles(exportData, context) {
  await mkdir(EXPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), EXPORT_DIR, `gpt-export-${timestamp}`);
  await mkdir(dir, { recursive: true });

  const files = {
    opportunities: path.join(dir, "creator-brand-opportunities.csv"),
    review: path.join(dir, "review-before-use-opportunities.csv"),
    brands: path.join(dir, "brand-intelligence.csv"),
    agencies: path.join(dir, "agency-intelligence.csv"),
    signals: path.join(dir, "creator-matching-signals.csv"),
    matchingIntelligence: path.join(dir, "team-billion-matching-intelligence.csv"),
    agencyCommercial: path.join(dir, "agency-commercial-intelligence.csv"),
    brandCommercial: path.join(dir, "brand-commercial-intelligence.csv"),
    pitchAngles: path.join(dir, "pitch-angle-intelligence.csv"),
    opportunityPriority: path.join(dir, "opportunity-priority-intelligence.csv"),
    playbook: path.join(dir, "team-billion-brand-matching-playbook.md"),
    instructions: path.join(dir, "custom-gpt-instructions.md"),
    audit: path.join(dir, "gpt-export-audit.md"),
    readinessAudit: path.join(dir, "gpt-readiness-audit.md"),
    summary: path.join(dir, "export-summary.json"),
  };

  await writeFile(files.opportunities, toCsv(exportData.opportunities, OPPORTUNITY_EXPORT_HEADERS));
  await writeFile(files.review, toCsv(exportData.reviewCandidates, OPPORTUNITY_EXPORT_HEADERS));
  await writeFile(files.brands, toCsv(exportData.brands, BRAND_EXPORT_HEADERS));
  await writeFile(files.agencies, toCsv(exportData.agencies, AGENCY_EXPORT_HEADERS));
  await writeFile(files.signals, toCsv(exportData.signals, SIGNAL_EXPORT_HEADERS));
  await writeFile(files.matchingIntelligence, toCsv(exportData.matchingIntelligence, MATCHING_INTELLIGENCE_HEADERS));
  await writeFile(files.agencyCommercial, toCsv(exportData.agencyCommercial, AGENCY_COMMERCIAL_HEADERS));
  await writeFile(files.brandCommercial, toCsv(exportData.brandCommercial, BRAND_COMMERCIAL_HEADERS));
  await writeFile(files.pitchAngles, toCsv(exportData.pitchAngles, PITCH_ANGLE_HEADERS));
  await writeFile(files.opportunityPriority, toCsv(exportData.opportunityPriority, OPPORTUNITY_PRIORITY_HEADERS));
  await writeFile(files.playbook, buildPlaybook(exportData, context));
  await writeFile(files.instructions, buildInstructions(exportData, context));
  await writeFile(files.audit, buildAuditReport(exportData));
  await writeFile(files.readinessAudit, buildReadinessAuditReport(exportData));
  await writeFile(
    files.summary,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        spreadsheetId: context.spreadsheetId,
        spreadsheetTitle: context.spreadsheetTitle,
        options: context.options,
        sourceCounts: exportData.sourceCounts,
        outputCounts: {
          opportunities: exportData.opportunities.length,
          reviewCandidates: exportData.reviewCandidates.length,
          brands: exportData.brands.length,
          agencies: exportData.agencies.length,
          signals: exportData.signals.length,
          matchingIntelligence: exportData.matchingIntelligence.length,
          agencyCommercial: exportData.agencyCommercial.length,
          brandCommercial: exportData.brandCommercial.length,
          pitchAngles: exportData.pitchAngles.length,
          opportunityPriority: exportData.opportunityPriority.length,
        },
        tierCounts: countBy(exportData.opportunities, "GPT Export Tier"),
        audit: exportData.audit,
        gptReadiness: exportData.gptReadiness,
      },
      null,
      2,
    ),
  );

  return { dir, files };
}

function buildInstructions(exportData, context) {
  const tierCounts = countBy(exportData.opportunities, "GPT Export Tier");
  return `# Creator Brand Matching GPT Knowledge Pack

Generated: ${new Date().toISOString()}
Source Sheet: ${context.spreadsheetTitle}

Upload these files to the custom GPT knowledge area:

1. creator-brand-opportunities.csv
2. brand-intelligence.csv
3. agency-intelligence.csv
4. creator-matching-signals.csv
5. team-billion-matching-intelligence.csv
6. agency-commercial-intelligence.csv
7. brand-commercial-intelligence.csv
8. pitch-angle-intelligence.csv
9. opportunity-priority-intelligence.csv
10. team-billion-brand-matching-playbook.md

Do not upload review-before-use-opportunities.csv or gpt-readiness-audit.md as Knowledge for the first version. Keep those as internal QA files only.

## How the GPT should use this

Do not blindly recommend Tier 1 rows. Tier 1 means the row passed stricter export filters, not that it is automatically the best match for every creator.

Rank by creator fit + commercial quality + relationship/source usefulness. Creator fit means niche, platform, country, audience, deliverables, usage rights, and timing.

Start with team-billion-matching-intelligence.csv for entity-level ranking. Use opportunity-priority-intelligence.csv for individual row ranking. Use agency-commercial-intelligence.csv and brand-commercial-intelligence.csv to judge commercial reputation and relationship warmth. Use pitch-angle-intelligence.csv to explain why Team Billion would pitch the creator.

Use a short questionnaire before recommending brands if the creator profile is incomplete. Ask for niche, geography, audience, platform, content style, minimum fee, usage rights comfort, and affiliate openness.

Prefer fixed-fee opportunities. If budget is unclear, say: "budget needs confirmation."

Avoid affiliate-only opportunities unless the user specifically asks for affiliate deals.

Treat historical signals as pitch angles, not guaranteed active deals.

For agencies, suggest asking for current briefs if the exact old campaign may no longer be active.

Do not recommend an opportunity just because a brand appears often. Match against creator niche, country/geography, audience, budget quality, usage rights, timeline, and source confidence. Platform is useful, but weaker than niche, geography, and audience fit.

If a row is Tier 3, use it as supporting pattern context only. Do not present Tier 3 as a direct recommendation unless the user asks for broad ideas.

Do not return huge lists. Start with the best 5 to 10 matches, grouped by why each one fits.

## Export counts

- Curated opportunities: ${exportData.opportunities.length}
- Review-before-use opportunities: ${exportData.reviewCandidates.length}
- Brand intelligence rows: ${exportData.brands.length}
- Agency intelligence rows: ${exportData.agencies.length}
- Creator signal rows: ${exportData.signals.length}
- Matching intelligence rows: ${exportData.matchingIntelligence.length}
- Agency commercial intelligence rows: ${exportData.agencyCommercial.length}
- Brand commercial intelligence rows: ${exportData.brandCommercial.length}
- Pitch angle intelligence rows: ${exportData.pitchAngles.length}
- Opportunity priority intelligence rows: ${exportData.opportunityPriority.length}
- Tier counts: ${Object.entries(tierCounts)
    .map(([tier, count]) => `${tier}: ${count}`)
    .join(", ")}
`;
}

function buildPlaybook(exportData, context) {
  const tierCounts = countBy(exportData.opportunities, "GPT Export Tier");
  return `# Team Billion Brand Matching Playbook

Generated: ${new Date().toISOString()}
Source Sheet: ${context.spreadsheetTitle}

## Purpose

Use this playbook to turn the Opportunity Intelligence export into ranked brand and agency suggestions for creators. The goal is not to search everything. The goal is to shortlist the best matches first.

## Knowledge files

Use the files this way:

- creator-brand-opportunities.csv: individual opportunity examples and proof points.
- brand-intelligence.csv: brand-level history and commercial quality.
- agency-intelligence.csv: agency relationship assets and current-brief potential.
- creator-matching-signals.csv: repeated creator preference patterns.
- team-billion-matching-intelligence.csv: the main recommendation layer. Start here when ranking.
- agency-commercial-intelligence.csv: agency-level fixed-fee, affiliate, budget, and relationship reputation.
- brand-commercial-intelligence.csv: brand-level budget quality, deal structure, and relationship strength.
- pitch-angle-intelligence.csv: structured reasons Team Billion would pitch a creator.
- opportunity-priority-intelligence.csv: row-level priority scoring for shortlist ordering.

## Recommended flow

1. Read the creator profile.
2. If key details are missing, ask a short questionnaire.
3. Start with team-billion-matching-intelligence.csv.
4. Use opportunity-priority-intelligence.csv to order individual opportunity examples.
5. Use agency-commercial-intelligence.csv and brand-commercial-intelligence.csv to judge commercial reputation and relationship warmth.
6. Use pitch-angle-intelligence.csv to explain the strongest pitch reason.
7. Use individual opportunities as supporting proof.
8. Score fit using niche, geography, audience, commercial quality, and source usefulness.
9. Return a ranked shortlist, not a huge list.
10. Explain why each suggestion fits and what needs confirmation.

## Short questionnaire

Ask only what is needed:

- Creator niche and content style
- Primary country or target geography
- Audience demographics
- Main platforms
- Typical views or follower range
- Minimum fixed fee
- Whether affiliate-only deals are acceptable
- Whether usage rights, Spark Ads, or whitelisting are acceptable
- Product categories the creator wants or avoids

## Matching logic

Niche and geography are strong pitch reasons. Audience fit is also strong when it is specific.

Platform is a weaker signal than geography, niche, and audience. Use platform to refine a match, not to justify a weak match.

Budget floor matters more than average budget. A brand with many low-budget rows should not outrank a brand with fewer but stronger fixed-fee opportunities.

Fixed-fee opportunities are preferred. If the budget is unclear, say: "budget needs confirmation."

Affiliate-only is low priority unless the user specifically asks for affiliate deals. Do not hide the affiliate-only caveat.

Song promotions can have lower rates than normal brand campaigns. A lower song-promotion budget can still be acceptable if the creator is music/audio aligned.

PR gifting is usually supporting context, not a top commercial recommendation, unless the creator explicitly wants gifting.

Historical opportunities are preference signals, not guaranteed active deals. Use them as pitch angles.

Agencies are useful because they can provide current briefs. When recommending an agency, suggest asking for current campaigns that match the creator profile.

Do not recommend huge lists. Start with 5 to 10 best options and rank them.

## Brand intelligence rules

For brands, prioritize:

1. Strong niche match
2. Strong geography match
3. Specific audience fit
4. Fixed-fee or strong budget pattern
5. Warm historical relationship
6. Recent opportunity signal

Do not recommend a brand only because it appears many times. High volume with low budget, affiliate-only, or weak fit should rank below fewer but stronger opportunities.

Use brand rows as pitch evidence. Example: "This brand has repeatedly looked for UK parenting creators."

## Agency intelligence rules

Agencies are relationship assets. Do not describe an agency as if it is the campaign.

For agencies, prioritize:

1. Frequency of useful opportunities
2. Strong or acceptable budget pattern
3. Variety of brands represented
4. Fit with the creator's niche and country
5. Recent communication

When recommending an agency, the action should usually be: ask for current briefs matching the creator.

Good agency recommendation style:

"Pitch NoXInfluencer for current app or lifestyle briefs for a US TikTok creator. Budget pattern is strong, but confirm the active brief."

## Pitch angle intelligence

Use structured pitch angle signals like:

- UK Creator
- US Creator
- Parenting Creator
- Beauty Creator
- Sports Creator
- Music Creator
- Lifestyle Creator
- Tech Creator
- Fixed Fee Preferred
- Ask For Current Briefs
- Affiliate Caveat
- Song Promotion Economics

The strongest pitch angles combine niche plus geography. For example, "UK parenting creator" is stronger than just "TikTok creator."

## Tier interpretation

Tier 1 means the row passed stricter filters. It is not an automatic recommendation for every creator.

Tier 2 means useful, but one important field may need checking, often budget, current availability, or fit detail.

Tier 3 means supporting pattern only. Use it to understand brand behavior, not as a direct recommendation unless the user asks for broad ideas.

Review Before Use rows are not uploaded as first-version Knowledge. They contain unclear, polluted, low-confidence, or human-review-needed records.

## Ranking formula

Use this order:

1. Creator niche fit
2. Creator geography and audience fit
3. Commercial quality and budget floor
4. Fixed-fee signal
5. Source usefulness and relationship strength
6. Current/open status
7. Platform fit
8. Historical pattern strength

## Output style

For each recommendation, include:

- Brand or agency
- Why it fits this creator
- Deal type or pitch angle
- Commercial note
- What to ask or confirm next

If budget is unclear, write: "budget needs confirmation."

## Current export counts

- Curated opportunities: ${exportData.opportunities.length}
- Review-before-use opportunities: ${exportData.reviewCandidates.length}
- Brand intelligence rows: ${exportData.brands.length}
- Agency intelligence rows: ${exportData.agencies.length}
- Creator signal rows: ${exportData.signals.length}
- Matching intelligence rows: ${exportData.matchingIntelligence.length}
- Agency commercial intelligence rows: ${exportData.agencyCommercial.length}
- Brand commercial intelligence rows: ${exportData.brandCommercial.length}
- Pitch angle intelligence rows: ${exportData.pitchAngles.length}
- Opportunity priority intelligence rows: ${exportData.opportunityPriority.length}
- Tier counts: ${Object.entries(tierCounts)
    .map(([tier, count]) => `${tier}: ${count}`)
    .join(", ")}
`;
}

function buildAuditReport(exportData) {
  const audit = exportData.audit;
  return `# GPT Export Audit

## Counts

- Curated opportunities: ${exportData.opportunities.length}
- Tier 1: ${audit.tierCounts["Tier 1"] ?? 0}
- Tier 2: ${audit.tierCounts["Tier 2"] ?? 0}
- Tier 3: ${audit.tierCounts["Tier 3"] ?? 0}
- Review Before Use: ${audit.reviewBeforeUseCount}
- Removed: ${audit.removedCount}
- Brand intelligence rows: ${exportData.brands.length}
- Agency intelligence rows: ${exportData.agencies.length}
- Creator signal rows: ${exportData.signals.length}
- Matching intelligence rows: ${exportData.matchingIntelligence.length}

## Quality Flags

- Suspicious brand names found: ${audit.suspiciousBrandNames.count}
- Affiliate-only rows excluded or moved to review: ${audit.affiliateOnlyRows.count}
- Low-budget rows downgraded or moved to review: ${audit.lowBudgetRows.count}
- Missing-budget rows downgraded: ${audit.missingBudgetRows.count}
- Newsletter/non-actionable rows moved to review: ${audit.nonActionableRows.count}
- Downgraded curated rows: ${audit.downgradedRows.count}

## Suspicious Brand Examples

${formatAuditExamples(audit.suspiciousBrandNames.examples)}

## Downgraded Examples

${formatAuditExamples(audit.downgradedRows.examples)}

## Removed Examples

${formatAuditExamples(audit.removedRows.examples)}

## Strongest Brands

${formatMatchingRows(audit.matchingAudit.strongestBrands, "Brand")}

## Strongest Agencies

${formatMatchingRows(audit.matchingAudit.strongestAgencies, "Agency")}

## Most Useful Pitch Signals

${formatCountEntries(audit.matchingAudit.mostUsefulPitchSignals)}

## Most Common Creator Profiles

${formatCountEntries(audit.matchingAudit.mostCommonCreatorProfiles)}

## Current Data Gaps

${audit.matchingAudit.dataGaps.map((gap) => `- ${gap}`).join("\n")}
`;
}

function buildReadinessAuditReport(exportData) {
  const readiness = exportData.gptReadiness;
  return `# GPT Readiness Audit

## Scores

- Database quality: ${readiness.scores.databaseQuality}/100
- Relationship intelligence: ${readiness.scores.relationshipIntelligence}/100
- Commercial intelligence: ${readiness.scores.commercialIntelligence}/100
- Pitch intelligence: ${readiness.scores.pitchIntelligence}/100
- Matching readiness: ${readiness.scores.matchingReadiness}/100
- Overall readiness: ${readiness.scores.overall}/100

## Intelligence Coverage

- Curated opportunities: ${readiness.counts.curatedOpportunities}
- Review-before-use rows kept out of Knowledge: ${readiness.counts.reviewBeforeUse}
- Brand intelligence rows: ${readiness.counts.brandIntelligence}
- Agency intelligence rows: ${readiness.counts.agencyIntelligence}
- Creator signal rows: ${readiness.counts.creatorSignals}
- Matching intelligence rows: ${readiness.counts.matchingIntelligence}
- Agency commercial intelligence rows: ${readiness.counts.agencyCommercial}
- Brand commercial intelligence rows: ${readiness.counts.brandCommercial}
- Pitch angle intelligence rows: ${readiness.counts.pitchAngles}
- Opportunity priority rows: ${readiness.counts.opportunityPriority}

## What Improved

${readiness.strengths.map((item) => `- ${item}`).join("\n")}

## Remaining Weaknesses Before GPT Creation

${readiness.weaknesses.map((item) => `- ${item}`).join("\n")}

## Recommendation

${readiness.recommendation}

Do not upload review-before-use-opportunities.csv or this audit file as Knowledge for the first GPT version.
`;
}

function formatAuditExamples(examples) {
  if (!examples.length) return "- None";
  return examples
    .map((item) => {
      const reasons = item.reasons?.length ? ` Reason: ${item.reasons.join(" | ")}` : "";
      return `- ${item.brandName || "Unknown"} -> ${item.action || "Review"} (${item.subject || "No subject"}).${reasons}`;
    })
    .join("\n");
}

function formatMatchingRows(rows, label) {
  if (!rows.length) return "- None";
  return rows
    .slice(0, 10)
    .map((row) => {
      const name = row[label] || row.Brand || row.Agency || "Unknown";
      return `- ${name}: ${row["Opportunity Count"]} opportunities, ${row["Budget Quality"]}, ${row["Relationship Strength"]}. Signals: ${row["Pitch Angle Signals"]}`;
    })
    .join("\n");
}

function formatCountEntries(entries) {
  if (!entries.length) return "- None";
  return entries.map((entry) => `- ${entry.value}: ${entry.count}`).join("\n");
}

function printSummary(exportData, output) {
  console.log("");
  console.log("Creator Brand Matching GPT Export");
  console.log(`Curated opportunities: ${exportData.opportunities.length}`);
  console.log(`Review-before-use opportunities: ${exportData.reviewCandidates.length}`);
  console.log(`Brand intelligence rows: ${exportData.brands.length}`);
  console.log(`Agency intelligence rows: ${exportData.agencies.length}`);
  console.log(`Creator signal rows: ${exportData.signals.length}`);
  console.log(`Matching intelligence rows: ${exportData.matchingIntelligence.length}`);
  console.log(`Agency commercial intelligence rows: ${exportData.agencyCommercial.length}`);
  console.log(`Brand commercial intelligence rows: ${exportData.brandCommercial.length}`);
  console.log(`Pitch angle intelligence rows: ${exportData.pitchAngles.length}`);
  console.log(`Opportunity priority intelligence rows: ${exportData.opportunityPriority.length}`);
  console.log(`GPT readiness score: ${exportData.gptReadiness.scores.overall}/100`);
  console.log(`Suspicious brand names found: ${exportData.audit.suspiciousBrandNames.count}`);
  console.log(`Removed rows: ${exportData.audit.removedCount}`);
  console.log("Tier counts:");
  for (const [tier, count] of Object.entries(countBy(exportData.opportunities, "GPT Export Tier"))) {
    console.log(`- ${tier}: ${count}`);
  }
  console.log("");
  console.log(`Export folder: ${output.dir}`);
  console.log("Done. No Sheet rows were changed.");
}

function toCsv(rows, headers) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n";
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function countBy(rows, header) {
  const counts = {};
  for (const row of rows) {
    const key = row[header] || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function countSimple(values) {
  const counts = {};
  for (const value of values) {
    const key = String(value ?? "").trim() || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function splitSignalList(value) {
  return unique(
    String(value ?? "")
      .split(/[,;|]/)
      .map((item) => item.replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim())
      .filter((item) => hasUsefulSignal(item))
      .filter((item) => !/^(unknown|not specified|n\/a|na|none)$/i.test(item))
      .filter((item) => item.length <= 48),
  );
}

function topValues(values, limit) {
  return topCountEntries(countSignals(values), limit).map((item) => item.value);
}

function countSignals(values) {
  const counts = new Map();
  for (const value of values) {
    const cleaned = String(value ?? "").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    const existing = counts.get(key) ?? { value: cleaned, count: 0 };
    existing.count += 1;
    counts.set(key, existing);
  }
  return counts;
}

function topCountEntries(counts, limit) {
  const entries = counts instanceof Map
    ? [...counts.values()]
    : Object.entries(counts).map(([value, count]) => ({ value, count }));
  return entries
    .filter((entry) => entry.value && entry.value !== "Unknown")
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)))
    .slice(0, limit);
}

function maxDate(values) {
  const dates = values
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);
  return dates[0] ? dates[0].toISOString().slice(0, 10) : "";
}

function createGoogleTokenProvider(config) {
  let cached = null;
  return async function getToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
    const assertion = await signServiceAccountJwt(config);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      throw new Error(`Google service account auth failed (${response.status}): ${result.error_description ?? result.error ?? "No access token returned"}`);
    }
    cached = {
      accessToken: result.access_token,
      expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000,
    };
    return cached.accessToken;
  };
}

async function signServiceAccountJwt(config) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64Url(
    JSON.stringify({
      iss: config.serviceAccountEmail,
      scope: SCOPES.sheets,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

function createSheetsClient(spreadsheetId, tokenProvider) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  return {
    async metadata() {
      const url = new URL(base);
      url.searchParams.set("includeGridData", "false");
      return googleFetch(url, tokenProvider);
    },
    async batchGet(ranges) {
      const url = new URL(`${base}/values:batchGet`);
      for (const range of ranges) url.searchParams.append("ranges", range);
      url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
      return googleFetch(url, tokenProvider);
    },
  };
}

async function googleFetch(url, tokenProvider) {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${await tokenProvider()}`,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxAttempts - 1) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : response.status === 429 ? 65_000 + attempt * 5_000 : Math.min(30_000, 1000 * 2 ** attempt);
      console.warn(`Google API asked us to slow down (${response.status}) on ${url.pathname}. Waiting ${Math.round(delayMs / 1000)}s before retry ${attempt + 2}/${maxAttempts}.`);
      await sleep(delayMs);
      continue;
    }
    throw new Error(`Google API failed (${response.status}) ${url.pathname}: ${body.error?.message ?? body.error ?? response.statusText}`);
  }
  throw new Error(`Google API failed after retries: ${url.pathname}`);
}

function headerMapFor(headers) {
  return new Map(headers.map((header, index) => [normalizeHeader(header), index]));
}

function getCell(row, headerMap, headerName) {
  const index = headerMap.get(normalizeHeader(headerName));
  return index === undefined ? "" : String(row[index] ?? "").trim();
}

function numberCell(row, headerMap, headerName) {
  const value = Number(getCell(row, headerMap, headerName).replace(/[$,]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function compactKey(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

function truthy(value) {
  return ["true", "yes", "y", "1"].includes(normalize(value));
}

function wordCount(value) {
  return normalize(value).split(/\s+/).filter(Boolean).length;
}

function containsMultiEntityHint(value) {
  const text = String(value ?? "");
  if (/\s\/\s|;|\sx\s|\s\+\s/i.test(text)) return true;
  if (/\s&\s/.test(text) && !/\b(h&m|m&m|at&t)\b/i.test(text)) return true;
  if (/\band\b/i.test(text) && wordCount(text) > 3) return true;
  return false;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isGenericName(value) {
  const normalized = normalize(value);
  const compact = compactKey(value);
  if (!normalized || GENERIC_NAMES.has(normalized) || GENERIC_NAMES.has(compact)) return true;
  if (/^unknown\b/i.test(normalized)) return true;
  if (/^you\b|^your\b|^our\b|^this\b/.test(normalized)) return true;
  if (/^unknown from /.test(normalized)) return true;
  if (/^[a-z]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return true;
  return false;
}

function loadEnvFiles(files) {
  for (const file of files) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!existsSync(fullPath)) continue;
    const raw = readFileSyncSafe(fullPath);
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...parts] = trimmed.split("=");
      if (process.env[key]) continue;
      process.env[key] = parts.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function readFileSyncSafe(file) {
  return existsSync(file) ? Buffer.from(readFileSync(file)).toString("utf8") : "";
}

function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n");
}

function pemToArrayBuffer(pem) {
  return Buffer.from(
    pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, ""),
    "base64",
  );
}

function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function quoteSheet(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
