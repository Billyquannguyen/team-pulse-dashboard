import { expect, test } from "@playwright/test";
import {
  pitchingSheetExportFont,
  pitchingSheetExportPalette,
} from "../../src/lib/pitching-sheet-export-style";

test("pitching sheet export uses Stride Social workbook styling", () => {
  expect(pitchingSheetExportFont).toEqual({ name: "Aptos", size: 14 });
  expect(pitchingSheetExportPalette.navy).toBe("FF29496D");
  expect(pitchingSheetExportPalette.aqua).toBe("FFBDFBFF");
  expect(pitchingSheetExportPalette.aquaSoft).toBe("FFE8FAFC");
  expect(Object.values(pitchingSheetExportPalette)).not.toContain("FFFF6B5F");
  expect(Object.values(pitchingSheetExportPalette)).not.toContain("FFFFF7D6");
});
