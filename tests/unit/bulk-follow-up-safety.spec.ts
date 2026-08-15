import { expect, test } from "@playwright/test";
import { candidateFromThread, sanitizeFollowUpTemplateHtml } from "../../src/lib/bulk-follow-up";

test("follow-up templates remove scripts, images, handlers, and unsafe links", async () => {
  const safe = await sanitizeFollowUpTemplateHtml(
    '<p onclick="steal()">Hello <strong>team</strong><script>alert(1)</script><img src="x"><a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a></p>',
  );

  expect(safe).toContain("<strong>team</strong>");
  expect(safe).toContain('href="https://example.com/"');
  expect(safe).not.toContain("script");
  expect(safe).not.toContain("onclick");
  expect(safe).not.toContain("img");
  expect(safe).not.toContain("javascript:");
});

test("an inbound message disqualifies an outreach thread", () => {
  const candidate = candidateFromThread(
    {
      id: "thread-1",
      messages: [
        {
          internalDate: "1700000000000",
          labelIds: ["SENT", "Label_outreach"],
          payload: {
            headers: [
              { name: "From", value: "sender@example.com" },
              { name: "To", value: "Creator <creator@example.com>" },
              { name: "Subject", value: "Partnership" },
              { name: "Message-ID", value: "<first@example.com>" },
            ],
          },
        },
        {
          internalDate: "1700100000000",
          labelIds: ["INBOX"],
          payload: {
            headers: [
              { name: "From", value: "creator@example.com" },
              { name: "To", value: "sender@example.com" },
              { name: "Message-ID", value: "<reply@example.com>" },
            ],
          },
        },
      ],
    },
    new Set(["sender@example.com"]),
    2,
    Date.now(),
  );

  expect(candidate).toBeNull();
});

test("a separately suppressed bounced address is excluded", () => {
  const candidate = candidateFromThread(
    {
      id: "thread-2",
      messages: [
        {
          internalDate: "1700000000000",
          labelIds: ["SENT", "Label_outreach"],
          payload: {
            headers: [
              { name: "From", value: "sender@example.com" },
              { name: "To", value: "creator@example.com" },
              { name: "Subject", value: "Partnership" },
              { name: "Message-ID", value: "<first@example.com>" },
            ],
          },
        },
      ],
    },
    new Set(["sender@example.com"]),
    1,
    Date.now(),
    new Set(["creator@example.com"]),
  );

  expect(candidate).toBeNull();
});
