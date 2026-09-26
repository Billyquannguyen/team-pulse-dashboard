import { expect, test } from "@playwright/test";
import { isMonthLabelCommissionDeal } from "../../src/data/deals";

const baseDeal = {
  brand: "Example brand",
  creator: "Example creator",
  managerTotalGbp: 250,
};

test("month-label commission does not depend on lifecycle or payment status", () => {
  for (const status of [
    "",
    "Pending",
    "Pending content",
    "Posted",
    "Paid",
    "Overdue",
    "Cancelled",
  ]) {
    const deal = { ...baseDeal, status };
    expect(isMonthLabelCommissionDeal(deal)).toBe(true);
  }
});

test("month-label commission ignores filler rows and rows without positive commission", () => {
  expect(isMonthLabelCommissionDeal({ brand: "", creator: "", managerTotalGbp: 250 })).toBe(false);
  expect(isMonthLabelCommissionDeal({ ...baseDeal, managerTotalGbp: 0 })).toBe(false);
});
