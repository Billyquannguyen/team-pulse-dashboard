import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const searchTypeSchema = z.enum(["new", "saved", "total"]);

const brandInputSchema = z.object({
  id: z.string().min(1).max(160),
  creatorName: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  domain: z.string().max(180).optional().default(""),
});

const aLeadsFiltersSchema = z.object({
  jobTitles: z.array(z.string().min(1).max(120)).max(40),
  departments: z.array(z.string().min(1).max(120)).max(25),
  seniority: z.array(z.string().min(1).max(120)).max(20),
  searchType: searchTypeSchema,
  maxContactsPerBrand: z.number().int().min(1).max(25),
  requireEmail: z.boolean(),
  enrichMissingEmails: z.boolean(),
});

const searchAleadsInput = z.object({
  brands: z.array(brandInputSchema).min(1).max(100),
  filters: aLeadsFiltersSchema,
});

type BrandInput = z.infer<typeof brandInputSchema>;
type AleadsFilters = z.infer<typeof aLeadsFiltersSchema>;

export type AleadsContactResult = {
  id: string;
  brandId: string;
  creatorName: string;
  brandName: string;
  domain: string;
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  email: string;
  linkedin: string;
  source: "A-Leads API";
};

export type AleadsSearchResult = {
  contacts: AleadsContactResult[];
  meta: {
    totalCount: number | null;
    newCount: number | null;
    savedCount: number | null;
    viewableLeadsCount: number | null;
  };
  searchedBrands: number;
};

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function aLeadsEnv() {
  const apiKey = process.env.A_LEADS_API_KEY ?? "";
  const baseUrl = cleanBaseUrl(process.env.A_LEADS_BASE_URL ?? "https://api.a-leads.co/gateway/v1");

  if (!apiKey) {
    throw new Error("Missing A_LEADS_API_KEY. Add it in Vercel Environment Variables first.");
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

function compactKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function responseDataArray(payload: unknown) {
  const candidates = [
    getPathValue(payload, ["data"]),
    getPathValue(payload, ["result", "data"]),
    getPathValue(payload, ["message", "data"]),
    getPathValue(payload, ["results"]),
  ];
  const match = candidates.find(Array.isArray);
  return Array.isArray(match) ? match : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildAdvancedFilters(brands: BrandInput[], filters: AleadsFilters) {
  const domains = uniqueStrings(brands.map((brand) => normalizeDomain(brand.domain ?? "")));
  const organizations = uniqueStrings(brands.map((brand) => brand.name));
  const advancedFilters: Record<string, unknown> = {
    request_uuid: `team-pulse-brand-finder-${Date.now()}`,
    is_job_title_strict: false,
  };

  if (domains.length > 0) advancedFilters.bulk_domains = domains.join("\n");
  if (organizations.length > 0) advancedFilters.organizations = organizations;
  if (filters.jobTitles.length > 0) advancedFilters.job_title = filters.jobTitles;
  if (filters.departments.length > 0) {
    advancedFilters.experimental_member_department = filters.departments;
  }
  if (filters.seniority.length > 0) {
    advancedFilters.member_management_level = filters.seniority;
  }

  return advancedFilters;
}

function matchBrandFromResult(result: unknown, brands: BrandInput[]) {
  const resultDomain = normalizeDomain(
    firstString(result, [["domain"], ["website"], ["company_domain"], ["company", "domain"]]),
  );
  const company = firstString(result, [["company_name"], ["company"], ["organization"]]);
  const companyKey = compactKey(company);

  if (resultDomain) {
    const domainMatch = brands.find(
      (brand) => normalizeDomain(brand.domain ?? "") === resultDomain,
    );
    if (domainMatch) return domainMatch;
  }

  if (companyKey) {
    const exactName = brands.find((brand) => compactKey(brand.name) === companyKey);
    if (exactName) return exactName;

    const containedName = brands.find((brand) => {
      const brandKey = compactKey(brand.name);
      return brandKey && (companyKey.includes(brandKey) || brandKey.includes(companyKey));
    });
    if (containedName) return containedName;
  }

  return brands[0];
}

function contactId(contact: Omit<AleadsContactResult, "id">) {
  return compactKey(
    [
      contact.creatorName,
      contact.brandName,
      contact.domain,
      contact.email,
      contact.name,
      contact.title,
      contact.company,
      contact.linkedin,
    ].join("|"),
  );
}

function normalizeContact(result: unknown, brands: BrandInput[]): AleadsContactResult {
  const matchedBrand = matchBrandFromResult(result, brands);
  const name = firstString(result, [
    ["member_full_name"],
    ["full_name"],
    ["name"],
    ["contact_name"],
    ["person_name"],
  ]);
  const firstName = firstString(result, [["member_name_first"], ["first_name"], ["firstName"]]);
  const lastName = firstString(result, [["member_name_last"], ["last_name"], ["lastName"]]);
  const split = splitName(name, firstName, lastName);
  const company = firstString(result, [["company_name"], ["company"], ["organization"]]);
  const domain = normalizeDomain(
    firstString(result, [["domain"], ["website"], ["company_domain"], ["company", "domain"]]) ||
      matchedBrand.domain,
  );
  const contactWithoutId: Omit<AleadsContactResult, "id"> = {
    brandId: matchedBrand.id,
    creatorName: matchedBrand.creatorName,
    brandName: matchedBrand.name || company,
    domain,
    name: name || [split.firstName, split.lastName].filter(Boolean).join(" ") || "Unknown contact",
    firstName: split.firstName,
    lastName: split.lastName,
    title:
      firstString(result, [["job_title"], ["title"], ["current_title"], ["role"]]) ||
      "Title missing",
    company: company || matchedBrand.name,
    email: firstString(result, [
      ["email"],
      ["work_email"],
      ["business_email"],
      ["professional_email"],
      ["verified_email"],
      ["email_address"],
      ["member_email"],
    ]),
    linkedin: firstString(result, [
      ["member_linkedin_url"],
      ["linkedin"],
      ["linkedin_url"],
      ["profile_url"],
      ["person_linkedin_url"],
    ]),
    source: "A-Leads API",
  };

  return {
    ...contactWithoutId,
    id: contactId(contactWithoutId),
  };
}

async function postAleads(path: string, body: unknown) {
  const { apiKey, baseUrl } = aLeadsEnv();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
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
    throw new Error(`A-Leads returned ${response.status}. ${details.slice(0, 320)}`);
  }

  return payload;
}

function emailFromFinderPayload(payload: unknown) {
  return firstString(payload, [
    ["email"],
    ["data", "email"],
    ["data", "work_email"],
    ["data", "business_email"],
    ["data", "professional_email"],
    ["result", "email"],
    ["message", "data", "email"],
  ]);
}

async function enrichEmail(contact: AleadsContactResult) {
  if (contact.email || !contact.firstName || !contact.lastName || !contact.domain) return contact;

  const data = {
    domain: contact.domain,
    first_name: contact.firstName,
    last_name: contact.lastName,
  };

  try {
    const wrapped = await postAleads("/search/find-email", { data });
    const wrappedEmail = emailFromFinderPayload(wrapped);
    if (wrappedEmail) return { ...contact, email: wrappedEmail };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("A-Leads returned 400")) {
      return contact;
    }
  }

  try {
    const raw = await postAleads("/search/find-email", data);
    const rawEmail = emailFromFinderPayload(raw);
    return rawEmail ? { ...contact, email: rawEmail } : contact;
  } catch {
    return contact;
  }
}

function limitPerBrand(contacts: AleadsContactResult[], maxContactsPerBrand: number) {
  const counts = new Map<string, number>();
  return contacts.filter((contact) => {
    const count = counts.get(contact.brandId) ?? 0;
    if (count >= maxContactsPerBrand) return false;
    counts.set(contact.brandId, count + 1);
    return true;
  });
}

export const searchAleadsContacts = createServerFn({ method: "POST" })
  .inputValidator(searchAleadsInput)
  .handler(async ({ data }): Promise<AleadsSearchResult> => {
    const { requireDashboardAuth } = await import("@/lib/auth.server");
    await requireDashboardAuth();

    const payload = await postAleads("/search/advanced-search", {
      advanced_filters: buildAdvancedFilters(data.brands, data.filters),
      current_page: 0,
      search_type: data.filters.searchType,
    });
    const rawContacts = responseDataArray(payload);
    const normalized = rawContacts.map((result) => normalizeContact(result, data.brands));
    const unique = Array.from(new Map(normalized.map((contact) => [contact.id, contact])).values());
    const limited = limitPerBrand(unique, data.filters.maxContactsPerBrand);
    const enriched = data.filters.enrichMissingEmails
      ? await Promise.all(limited.map((contact) => enrichEmail(contact)))
      : limited;
    const contacts = data.filters.requireEmail
      ? enriched.filter((contact) => Boolean(contact.email))
      : enriched;

    return {
      contacts,
      searchedBrands: data.brands.length,
      meta: {
        totalCount: firstNumber(payload, [
          ["meta_data", "total_count"],
          ["meta", "total_count"],
        ]),
        newCount: firstNumber(payload, [
          ["meta_data", "new_count"],
          ["meta", "new_count"],
        ]),
        savedCount: firstNumber(payload, [
          ["meta_data", "saved_count"],
          ["meta", "saved_count"],
        ]),
        viewableLeadsCount: firstNumber(payload, [
          ["meta_data", "viewable_leads_count"],
          ["meta", "viewable_leads_count"],
        ]),
      },
    };
  });
