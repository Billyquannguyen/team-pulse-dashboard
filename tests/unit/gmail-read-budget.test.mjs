import test from "node:test";
import assert from "node:assert/strict";
import {
  createGmailReadBudget,
  gmailReadCost,
  gmailRetryDelay,
} from "../../src/lib/gmail-read-budget.ts";

test("concurrent metadata and full reads stay within the weighted budget", async () => {
  let time = 0;
  const starts = [];
  const budget = createGmailReadBudget(
    () => time,
    async (ms) => {
      time += ms;
    },
  );
  await Promise.all(
    [120, 40, 120, 10].map(async (cost) => {
      await budget.wait(cost);
      starts.push(time);
    }),
  );
  assert.equal(starts.length, 4);
  assert.ok(time >= Math.ceil((280 * 1000) / 60));
  assert.equal(gmailReadCost("threads/id", new URLSearchParams("format=full")), 120);
  assert.equal(gmailReadCost("threads/id", new URLSearchParams("format=metadata")), 40);
  assert.equal(gmailReadCost("threads"), 10);
});

test("a quota response pauses queued callers, including a caller already waiting", async () => {
  let time = 0;
  let waits = 0;
  let budget;
  budget = createGmailReadBudget(
    () => time,
    async (ms) => {
      time += ms;
      if (++waits === 1) budget.pause(30_000);
    },
  );
  await budget.wait(120);
  await budget.wait(40);
  assert.equal(time, 32_000);
});

test("Retry-After supports seconds, HTTP dates and malformed values", () => {
  assert.equal(gmailRetryDelay("90", 10_000, 0), 90_000);
  assert.equal(gmailRetryDelay("Thu, 01 Jan 1970 00:02:00 GMT", 10_000, 0), 120_000);
  assert.equal(gmailRetryDelay("bad value", 10_000, 0), 10_000);
  assert.equal(gmailRetryDelay(null, 10_000, 0), 10_000);
  assert.equal(gmailRetryDelay("1", 30_000, 0), 30_000);
});
