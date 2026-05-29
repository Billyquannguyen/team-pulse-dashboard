export type HeaderAliases<TField extends string> = Record<TField, string[]>;
export type HeaderLookup<TField extends string> = Record<TField, number>;

export function normalizeSheetHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function createHeaderLookup<TField extends string>(
  headers: string[],
  aliases: HeaderAliases<TField>,
): HeaderLookup<TField> {
  const normalizedHeaders = headers.map(normalizeSheetHeader);
  const entries = Object.entries(aliases) as Array<[TField, string[]]>;

  return Object.fromEntries(
    entries.map(([field, names]) => {
      const normalizedNames = names.map(normalizeSheetHeader);
      const index = normalizedHeaders.findIndex((header) => normalizedNames.includes(header));
      return [field, index];
    }),
  ) as HeaderLookup<TField>;
}

export function getHeaderCell<TField extends string>(
  row: string[],
  lookup: HeaderLookup<TField>,
  field: TField,
) {
  const index = lookup[field];
  if (index === undefined || index < 0) return "";
  return row[index]?.trim() ?? "";
}

export function getMissingHeaders<TField extends string>(
  headers: string[],
  aliases: HeaderAliases<TField>,
  requiredFields: TField[],
  labels: Record<TField, string>,
) {
  const lookup = createHeaderLookup(headers, aliases);

  return requiredFields
    .filter((field) => lookup[field] === undefined || lookup[field] < 0)
    .map((field) => labels[field]);
}

export function hasHeaderAlias<TField extends string>(
  headers: string[],
  aliases: HeaderAliases<TField>,
  field: TField,
) {
  const lookup = createHeaderLookup(headers, aliases);
  return lookup[field] !== undefined && lookup[field] >= 0;
}

export function hasAnyHeaderAlias<TField extends string>(
  headers: string[],
  aliases: HeaderAliases<TField>,
  fields: TField[],
) {
  return fields.some((field) => hasHeaderAlias(headers, aliases, field));
}
