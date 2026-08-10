import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { addNativeExcelCheckboxes } from "../../src/lib/excel-native-checkboxes";

test("exports Interested? as native unchecked Excel controls without validation", async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Creator Shortlist", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = [
    { header: "Creator Name", width: 24 },
    { header: "Interested?", width: 17 },
    { header: "TT Link", width: 38 },
  ];
  worksheet.addRow([
    "Creator One",
    false,
    { text: "https://tiktok.com/@one", hyperlink: "https://tiktok.com/@one" },
  ]);
  worksheet.addRow([
    "Creator Two",
    false,
    { text: "https://tiktok.com/@two", hyperlink: "https://tiktok.com/@two" },
  ]);
  worksheet.autoFilter = "A1:C3";

  for (const rowNumber of [2, 3]) {
    const cell = worksheet.getCell(`B${rowNumber}`);
    cell.value = false;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7D6" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  const excelJsBuffer = await workbook.xlsx.writeBuffer();
  const result = await addNativeExcelCheckboxes(new Uint8Array(excelJsBuffer), {
    columnLetter: "B",
    firstRow: 2,
    lastRow: 3,
  });
  const zip = await JSZip.loadAsync(result);
  const read = async (path: string) => {
    const file = zip.file(path);
    expect(file, `${path} should exist`).not.toBeNull();
    return file!.async("string");
  };

  const sheetXml = await read("xl/worksheets/sheet1.xml");
  const stylesXml = await read("xl/styles.xml");
  const contentTypesXml = await read("[Content_Types].xml");
  const relationshipsXml = await read("xl/_rels/workbook.xml.rels");
  const featureBagXml = await read("xl/featurePropertyBag/featurePropertyBag.xml");

  expect(sheetXml).not.toContain("dataValidations");
  expect(sheetXml).toMatch(/<c[^>]*r="B2"[^>]*t="b"[^>]*><v>0<\/v><\/c>/);
  expect(sheetXml).toMatch(/<c[^>]*r="B3"[^>]*t="b"[^>]*><v>0<\/v><\/c>/);
  expect(sheetXml).toContain('hyperlink ref="C2"');
  expect(sheetXml).toContain('autoFilter ref="A1:C3"');
  expect(sheetXml).toContain('ySplit="1"');
  expect(stylesXml).toContain("{C7286773-470A-42A8-94C5-96B5CB345126}");
  expect(stylesXml).toContain('xfpb:xfComplement i="0"');
  expect(contentTypesXml).toContain("application/vnd.ms-excel.featurepropertybag+xml");
  expect(relationshipsXml).toContain(
    "http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag",
  );
  expect(featureBagXml).toContain('bag type="Checkbox"');
  expect(featureBagXml).toContain('<bagId k="CellControl">0</bagId>');
});
