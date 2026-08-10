import JSZip from "jszip";

const FEATURE_PROPERTY_BAG_PATH = "xl/featurePropertyBag/featurePropertyBag.xml";
const FEATURE_PROPERTY_BAG_REL_TYPE =
  "http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag";
const FEATURE_PROPERTY_BAG_CONTENT_TYPE = "application/vnd.ms-excel.featurepropertybag+xml";
const CHECKBOX_EXTENSION_URI = "{C7286773-470A-42A8-94C5-96B5CB345126}";

const featurePropertyBagXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<FeaturePropertyBags xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag">
  <bag type="Checkbox"/>
  <bag type="XFControls"><bagId k="CellControl">0</bagId></bag>
  <bag type="XFComplement"><bagId k="XFControls">1</bagId></bag>
  <bag type="XFComplements" extRef="XFComplementsMapperExtRef">
    <a k="MappedFeaturePropertyBags"><bagId>2</bagId></a>
  </bag>
</FeaturePropertyBags>`;

export type NativeCheckboxRange = {
  worksheetPath?: string;
  columnLetter: string;
  firstRow: number;
  lastRow: number;
};

function requiredFile(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`The generated workbook is missing ${path}.`);
  return file;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCellStyleIndex(worksheetXml: string, reference: string) {
  const pattern = new RegExp(`<c\\b(?=[^>]*\\br="${escapeRegExp(reference)}")([^>]*)(?:\\/>|>)`);
  const match = worksheetXml.match(pattern);
  if (!match) throw new Error(`The generated workbook is missing checkbox cell ${reference}.`);
  const styleMatch = match[1].match(/\bs="(\d+)"/);
  return styleMatch ? Number(styleMatch[1]) : 0;
}

function replaceCellWithUncheckedBoolean(
  worksheetXml: string,
  reference: string,
  styleIndex: number,
) {
  const pattern = new RegExp(
    `<c\\b(?=[^>]*\\br="${escapeRegExp(reference)}")([^>]*)(?:\\/>|>([\\s\\S]*?)<\\/c>)`,
  );
  let replaced = false;
  const nextXml = worksheetXml.replace(pattern, (_match, rawAttributes: string) => {
    replaced = true;
    const attributes = rawAttributes.replace(/\s+s="[^"]*"/g, "").replace(/\s+t="[^"]*"/g, "");
    return `<c${attributes} s="${styleIndex}" t="b"><v>0</v></c>`;
  });
  if (!replaced) throw new Error(`The generated workbook is missing checkbox cell ${reference}.`);
  return nextXml;
}

function checkboxStyleFrom(stylesXml: string, sourceStyleIndex: number) {
  const cellXfsMatch = stylesXml.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfsMatch) throw new Error("The generated workbook has no cell style table.");

  const styles = cellXfsMatch[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
  const sourceStyle = styles[sourceStyleIndex];
  if (!sourceStyle) throw new Error("The Interested? cell style could not be found.");

  const extension = `<extLst><ext xmlns:xfpb="http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag" uri="${CHECKBOX_EXTENSION_URI}"><xfpb:xfComplement i="0"/></ext></extLst>`;
  const checkboxStyle = sourceStyle.endsWith("/>")
    ? `${sourceStyle.slice(0, -2)}>${extension}</xf>`
    : sourceStyle.replace(/<\/xf>$/, `${extension}</xf>`);
  const count = styles.length;
  const attributes = cellXfsMatch[1].replace(/\bcount="\d+"/, `count="${count + 1}"`);
  const replacement = `<cellXfs${attributes}>${cellXfsMatch[2]}${checkboxStyle}</cellXfs>`;

  return {
    checkboxStyleIndex: count,
    stylesXml: stylesXml.replace(cellXfsMatch[0], replacement),
  };
}

function addContentType(contentTypesXml: string) {
  if (contentTypesXml.includes(FEATURE_PROPERTY_BAG_CONTENT_TYPE)) return contentTypesXml;
  const override = `<Override PartName="/${FEATURE_PROPERTY_BAG_PATH}" ContentType="${FEATURE_PROPERTY_BAG_CONTENT_TYPE}"/>`;
  return contentTypesXml.replace(/<\/Types>$/, `${override}</Types>`);
}

function addWorkbookRelationship(relationshipsXml: string) {
  if (relationshipsXml.includes(FEATURE_PROPERTY_BAG_REL_TYPE)) return relationshipsXml;
  const relationshipIds = [...relationshipsXml.matchAll(/\bId="rId(\d+)"/g)].map((match) =>
    Number(match[1]),
  );
  const nextId = Math.max(0, ...relationshipIds) + 1;
  const relationship = `<Relationship Id="rId${nextId}" Type="${FEATURE_PROPERTY_BAG_REL_TYPE}" Target="featurePropertyBag/featurePropertyBag.xml"/>`;
  return relationshipsXml.replace(/<\/Relationships>$/, `${relationship}</Relationships>`);
}

/**
 * Adds Microsoft's native Excel 2024 in-cell checkbox control to boolean cells.
 * ExcelJS builds the workbook and styling first; this function adds the OOXML
 * feature metadata that ExcelJS 4.x does not currently expose.
 */
export async function addNativeExcelCheckboxes(
  workbookBuffer: ArrayBuffer | Uint8Array,
  range: NativeCheckboxRange,
) {
  if (range.lastRow < range.firstRow) return workbookBuffer;

  const zip = await JSZip.loadAsync(workbookBuffer);
  const worksheetPath = range.worksheetPath ?? "xl/worksheets/sheet1.xml";
  let worksheetXml = await requiredFile(zip, worksheetPath).async("string");
  const stylesXml = await requiredFile(zip, "xl/styles.xml").async("string");
  const contentTypesXml = await requiredFile(zip, "[Content_Types].xml").async("string");
  const relationshipsXml = await requiredFile(zip, "xl/_rels/workbook.xml.rels").async("string");

  const firstReference = `${range.columnLetter.toUpperCase()}${range.firstRow}`;
  const sourceStyleIndex = getCellStyleIndex(worksheetXml, firstReference);
  const checkboxStyle = checkboxStyleFrom(stylesXml, sourceStyleIndex);

  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    worksheetXml = replaceCellWithUncheckedBoolean(
      worksheetXml,
      `${range.columnLetter.toUpperCase()}${row}`,
      checkboxStyle.checkboxStyleIndex,
    );
  }

  zip.file(worksheetPath, worksheetXml);
  zip.file("xl/styles.xml", checkboxStyle.stylesXml);
  zip.file("[Content_Types].xml", addContentType(contentTypesXml));
  zip.file("xl/_rels/workbook.xml.rels", addWorkbookRelationship(relationshipsXml));
  zip.file(FEATURE_PROPERTY_BAG_PATH, featurePropertyBagXml);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
