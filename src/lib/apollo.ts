import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const brandInputSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  domain: z.string().max(180).optional().default(""),
});

const apolloFiltersSchema = z.object({
  jobTitles: z.array(z.string().min(1).max(120)).max(40),
  excludeTitles: z.array(z.string().min(1).max(120)).max(40).optional().default([]),
  departments: z.array(z.string().min(1).max(120)).max(25).optional().default([]),
  keywords: z.array(z.string().min(1).max(120)).max(25).optional().default([]),
  seniority: z.array(z.string().min(1).max(120)).max(20).optional().default([]),
  emailStatuses: z.array(z.string().min(1).max(80)).max(10).optional().default([]),
  includeSimilarTitles: z.boolean(),
  maxContactsPerBrand: z.number().int().min(1).max(25),
  requireEmail: z.boolean(),
  enrichEmails: z.boolean(),
});

const searchApolloInput = z.object({
  brands: z.array(brandInputSchema).min(1).max(100),
  filters: apolloFiltersSchema,
});

type BrandInput = z.infer<typeof brandInputSchema>;
type ApolloFilters = z.infer<typeof apolloFiltersSchema>;

type ApolloParamValue = string | number | boolean | null | undefined;
type ApolloParams = Record<string, ApolloParamValue | ApolloParamValue[]>;

export type ApolloContactResult = {
  id: string;
  brandId: string;
  brandName: string;
  domain: string;
  apolloPersonId: string;
  apolloOrganizationId: string;
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  email: string;
  linkedin: string;
  emailStatus: string;
  source: "Apollo API";
};

export type ApolloSearchResult = {
  contacts: ApolloContactResult[];
  meta: {
    totalCount: number | null;
    enrichedCount: number;
  };
  searchedBrands: number;
};

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function apolloEnv() {
  const apiKey = process.env.APOLLO_API_KEY ?? "";
  const baseUrl = cleanBaseUrl(process.env.APOLLO_BASE_URL ?? "https://api.apollo.io/api/v1");

  if (!apiKey) {
    throw new Error("Missing APOLLO_API_KEY. Add it in Vercel Environment Variables first.");
  }

  return { apiKey, baseUrl };
}

function splitName(fullName: string, fallbackFirst = "", fallbackLast = "") {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = fallbackFirst || parts[0] || "";
  const lastName = fallbackLast || parts.slice(1).join(" ") || "";
  return { firstName, lastName };
}

function normalizeDomain(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .trim();
  }
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 .@:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function titleContainsBlockedTerm(title: string, blockedTerms: string[]) {
  const normalizedTitle = normalizeText(title);
  return blockedTerms.some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm && normalizedTitle.includes(normalizedTerm);
  });
}

function getPathValue(source: unknown, path: string[]) {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstString(source: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(source: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function responsePeopleArray(payload: unknown) {
  const candidates = [
    getPathValue(payload, ["people"]),
    getPathValue(payload, ["persons"]),
    getPathValue(payload, ["contacts"]),
    getPathValue(payload, ["matches"]),
    getPathValue(payload, ["results"]),
    getPathValue(payload, ["data", "people"]),
    getPathValue(payload, ["data", "persons"]),
    getPathValue(payload, ["data", "contacts"]),
    getPathValue(payload, ["data", "matches"]),
    getPathValue(payload, ["result", "people"]),
    getPathValue(payload, ["result", "matches"]),
    getPathValue(payload, ["data"]),
  ];
  const match = candidates.find(Array.isArray);
  return Array.isArray(match) ? match : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function appendApolloParams(searchParams: URLSearchParams, params: ApolloParams) {
  Object.entries(params).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (item === null || item === undefined || item === "") return;
      searchParams.append(key, String(item));
    });
  });
}

async function postApollo(path: string, params: ApolloParams = {}, body?: unknown) {
  const { apiKey, baseUrl } = apolloEnv();
  const url = new URL(`${baseUrl}${path}`);
  appendApolloParams(url.searchParams, params);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const details = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`Apollo returned ${response.status}. ${details.slice(0, 320)}`);
  }

  return payload;
}

function matchBrandFromResult(result: unknown, fallbackBrand: BrandInput) {
  const resultDomain = normalizeDomain(
    firstString(result, [
      ["organization", "primary_domain"],
      ["organization", "domain"],
      ["organization", "website_url"],
      ["organization", "website"],
      ["person", "organization", "primary_domain"],
      ["person", "organization", "domain"],
      ["person", "organization", "website_url"],
      ["person", "organization", "website"],
      ["account", "primary_domain"],
      ["account", "domain"],
      ["company_domain"],
      ["domain"],
    ]),
  );
  const company = firstString(result, [
    ["organization", "name"],
    ["person", "organization", "name"],
    ["account", "name"],
    ["organization_name"],
    ["company"],
    ["company_name"],
  ]);

  if (resultDomain && normalizeDomain(fallbackBrand.domain ?? "") === resultDomain) {
    return fallbackBrand;
  }

  if (company && compactKey(company) === compactKey(fallbackBrand.name)) {
    return fallbackBrand;
  }

  return fallbackBrand;
}

function contactId(contact: Omit<ApolloContactResult, "id">) {
  return compactKey(
    [
      contact.brandName,
      contact.domain,
      contact.email,
      contact.name,
      contact.title,
      contact.company,
      contact.linkedin,
      contact.apolloPersonId,
    ].join("|"),
  );
}

function emailFromApolloPerson(result: unknown) {
  return firstString(result, [
    ["email"],
    ["work_email"],
    ["business_email"],
    ["professional_email"],
    ["verified_email"],
    ["email_address"],
    ["person", "email"],
    ["person", "work_email"],
    ["person", "business_email"],
    ["contact", "email"],
    ["contact", "work_email"],
    ["match", "email"],
    ["details", "email"],
  ]);
}

function normalizeContact(result: unknown, fallbackBrand: BrandInput): ApolloContactResult {
  const matchedBrand = matchBrandFromResult(result, fallbackBrand);
  const name = firstString(result, [
    ["name"],
    ["full_name"],
    ["person", "name"],
    ["person", "full_name"],
    ["contact", "name"],
  ]);
  const firstName = firstString(result, [
    ["first_name"],
    ["firstName"],
    ["person", "first_name"],
    ["contact", "first_name"],
  ]);
  const lastName = firstString(result, [
    ["last_name"],
    ["lastName"],
    ["person", "last_name"],
    ["contact", "last_name"],
  ]);
  const split = splitName(name, firstName, lastName);
  const company = firstString(result, [
    ["organization", "name"],
    ["person", "organization", "name"],
    ["account", "name"],
    ["organization_name"],
    ["company"],
    ["company_name"],
  ]);
  const domain = normalizeDomain(
    firstString(result, [
      ["organization", "primary_domain"],
      ["organization", "domain"],
      ["organization", "website_url"],
      ["organization", "website"],
      ["person", "organization", "primary_domain"],
      ["person", "organization", "domain"],
      ["person", "organization", "website_url"],
      ["person", "organization", "website"],
      ["account", "primary_domain"],
      ["account", "domain"],
      ["company_domain"],
      ["domain"],
    ]) ||
      matchedBrand.domain ||
      "",
  );
  const contactWithoutId: Omit<ApolloContactResult, "id"> = {
    brandId: matchedBrand.id,
    brandName: matchedBrand.name || company,
    domain,
    apolloPersonId: firstString(result, [
      ["id"],
      ["person_id"],
      ["person", "id"],
      ["contact", "id"],
    ]),
    apolloOrganizationId: firstString(result, [
      ["organization_id"],
      ["organization", "id"],
      ["person", "organization", "id"],
      ["account", "id"],
    ]),
    name: name || [split.firstName, split.lastName].filter(Boolean).join(" ") || "Unknown contact",
    firstName: split.firstName,
    lastName: split.lastName,
    title:
      firstString(result, [
        ["title"],
        ["job_title"],
        ["current_title"],
        ["person", "title"],
        ["contact", "title"],
      ]) || "Title missing",
    company: company || matchedBrand.name,
    email: emailFromApolloPerson(result),
    linkedin: firstString(result, [
      ["linkedin_url"],
      ["linkedin"],
      ["person", "linkedin_url"],
      ["contact", "linkedin_url"],
    ]),
    emailStatus: firstString(result, [
      ["email_status"],
      ["contact_email_status"],
      ["person", "email_status"],
    ]),
    source: "Apollo API",
  };

  return {
    ...contactWithoutId,
    id: contactId(contactWithoutId),
  };
}

function buildSearchParams(brand: BrandInput, filters: ApolloFilters): ApolloParams {
  const domain = normalizeDomain(brand.domain ?? "");
  const keywords = uniqueStrings([...filters.departments, ...filters.keywords]);
  const params: ApolloParams = {
    "person_titles[]": uniqueStrings(filters.jobTitles),
    "person_seniorities[]": uniqueStrings(filters.seniority.map((item) => item.toLowerCase())),
    "contact_email_status[]": uniqueStrings(filters.emailStatuses),
    include_similar_titles: filters.includeSimilarTitles,
    page: 1,
    per_page: Math.min(100, Math.max(filters.maxContactsPerBrand * 5, filters.maxContactsPerBrand)),
  };

  if (domain) {
    params["q_organization_domains_list[]"] = [domain];
    if (keywords.length > 0) params.q_keywords = keywords.join(" ");
  } else {
    params.q_keywords = uniqueStrings([brand.name, ...keywords]).join(" ");
  }

  return params;
}

function removeExcludedTitles(contacts: ApolloContactResult[], filters: ApolloFilters) {
  const excluded = uniqueStrings(filters.excludeTitles);
  if (excluded.length === 0) return contacts;
  return contacts.filter((contact) => !titleContainsBlockedTerm(contact.title, excluded));
}

async function searchBrandContacts(brand: BrandInput, filters: ApolloFilters) {
  const payload = await postApollo("/mixed_people/api_search", buildSearchParams(brand, filters));
  const rawContacts = responsePeopleArray(payload);
  const normalized = rawContacts.map((result) => normalizeContact(result, brand));
  const unique = Array.from(new Map(normalized.map((contact) => [contact.id, contact])).values());

  return {
    contacts: unique,
    totalCount: firstNumber(payload, [
      ["pagination", "total_entries"],
      ["pagination", "total_count"],
      ["total_entries"],
      ["total_count"],
      ["meta", "total_count"],
    ]),
  };
}

function enrichmentDetails(contact: ApolloContactResult) {
  return {
    id: contact.apolloPersonId || undefined,
    name: contact.name || undefined,
    first_name: contact.firstName || undefined,
    last_name: contact.lastName || undefined,
    organization_name: contact.company || contact.brandName || undefined,
    domain: contact.domain || undefined,
    linkedin_url: contact.linkedin || undefined,
  };
}

function mergeEnrichedContact(contact: ApolloContactResult, result: unknown) {
  const normalized = normalizeContact(result, {
    id: contact.brandId,
    name: contact.brandName,
    domain: contact.domain,
  });
  const merged: Omit<ApolloContactResult, "id"> = {
    ...contact,
    name: normalized.name || contact.name,
    firstName: normalized.firstName || contact.firstName,
    lastName: normalized.lastName || contact.lastName,
    title: normalized.title || contact.title,
    company: normalized.company || contact.company,
    domain: normalized.domain || contact.domain,
    email: normalized.email || contact.email,
    linkedin: normalized.linkedin || contact.linkedin,
    emailStatus: normalized.emailStatus || contact.emailStatus,
  };

  return {
    ...merged,
    id: contactId(merged),
  };
}

async function enrichContacts(contacts: ApolloContactResult[]) {
  const enriched: ApolloContactResult[] = [];
  let enrichedCount = 0;

  for (let index = 0; index < contacts.length; index += 10) {
    const chunk = contacts.slice(index, index + 10);

    try {
      const payload = await postApollo(
        "/people/bulk_match",
        { reveal_personal_emails: false },
        { details: chunk.map(enrichmentDetails) },
      );
      const matches = responsePeopleArray(payload);
      chunk.forEach((contact, contactIndex) => {
        const match = matches[contactIndex];
        const next = match ? mergeEnrichedContact(contact, match) : contact;
        if (!contact.email && next.email) enrichedCount += 1;
        enriched.push(next);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Apollo enrichment failed.";
      throw new Error(
        `${message} People were found, but Apollo could not enrich their emails. Turn off email enrichment to review people without emails.`,
      );
    }
  }

  return { contacts: enriched, enrichedCount };
}

function limitPerBrand(contacts: ApolloContactResult[], maxContactsPerBrand: number) {
  const counts = new Map<string, number>();
  return contacts.filter((contact) => {
    const count = counts.get(contact.brandId) ?? 0;
    if (count >= maxContactsPerBrand) return false;
    counts.set(contact.brandId, count + 1);
    return true;
  });
}

export const searchApolloContacts = createServerFn({ method: "POST" })
  .inputValidator(searchApolloInput)
  .handler(async ({ data }): Promise<ApolloSearchResult> => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();

    const searchResults = [];
    for (const brand of data.brands) {
      searchResults.push(await searchBrandContacts(brand, data.filters));
    }
    const totalCount = searchResults.reduce<number | null>((current, result) => {
      if (result.totalCount === null) return current;
      return (current ?? 0) + result.totalCount;
    }, null);
    const normalized = removeExcludedTitles(
      searchResults.flatMap((result) => result.contacts),
      data.filters,
    );
    const unique = Array.from(new Map(normalized.map((contact) => [contact.id, contact])).values());
    const limited = limitPerBrand(unique, data.filters.maxContactsPerBrand);
    const enrichedResult = data.filters.enrichEmails
      ? await enrichContacts(limited)
      : { contacts: limited, enrichedCount: 0 };
    const contacts = data.filters.requireEmail
      ? enrichedResult.contacts.filter((contact) => Boolean(contact.email))
      : enrichedResult.contacts;

    return {
      contacts,
      searchedBrands: data.brands.length,
      meta: {
        totalCount,
        enrichedCount: enrichedResult.enrichedCount,
      },
    };
  });
