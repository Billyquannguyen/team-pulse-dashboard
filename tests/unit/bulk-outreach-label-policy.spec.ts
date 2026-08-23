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
