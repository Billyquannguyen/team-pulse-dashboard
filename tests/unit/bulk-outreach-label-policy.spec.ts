import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

test("the master Gmail token requires modify access for post-send labels", () => {
  expect(source("src/lib/gmail-oauth.server.ts")).toContain(
    "https://www.googleapis.com/auth/gmail.modify",
  );
});

test("Bulk Outreach label reconciliation is add-only", () => {
  const bulkSender = source("src/lib/bulk-sender.ts");
  const start = bulkSender.indexOf("export async function processPendingBulkOutreachLabels");
  const end = bulkSender.indexOf("export const syncPendingBulkOutreachLabels", start);
  const worker = bulkSender.slice(start, end);

  expect(worker).toContain("in:sent rfc822msgid:");
  expect(worker).toContain("addLabelIds");
  expect(worker).toContain("/modify");
  expect(worker).not.toContain("removeLabelIds");
  expect(worker).not.toContain("/trash");
  expect(worker).not.toContain("/delete");
});

test("Bulk Outreach only offers existing user-created Gmail labels", () => {
  const bulkSender = source("src/lib/bulk-sender.ts");
  const start = bulkSender.indexOf("async function listUserGmailLabels");
  const end = bulkSender.indexOf("async function validateSelectedLabelIds", start);
  const labelReader = bulkSender.slice(start, end);

  expect(labelReader).toContain('label.type === "user"');
  expect(labelReader).toContain('"labels"');
  expect(labelReader).not.toContain("labels.create");
  expect(labelReader).not.toContain("labels.delete");
});

test("pending label reconciliation is bounded and defers unresolved drafts", () => {
  const bulkSender = source("src/lib/bulk-sender.ts");
  const route = source("src/routes/bulk-sender.tsx");

  expect(bulkSender).toContain("MAX_PENDING_LABEL_CHECKS_PER_RUN = 20");
  expect(bulkSender).toContain("PENDING_LABEL_CHECK_DELAY_MS = 15 * 60 * 1000");
  expect(bulkSender).toContain('"ZRANGEBYSCORE"');
  expect(bulkSender).toContain("await deferPendingLabelRecord(raw, record)");
  expect(route).toContain("window.setInterval(syncLabels, 10 * 60_000)");
  expect(route).toContain('document.visibilityState !== "visible"');
  expect(route).not.toContain('window.addEventListener("focus", syncLabels)');
});
