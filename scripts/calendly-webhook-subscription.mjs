#!/usr/bin/env node

import process from "node:process";

const API_BASE_URL = "https://api.calendly.com";
const EVENT_NAME = "invitee.created";
const DEFAULT_WEBHOOK_PATH = "/api/calendly-reminders/webhook";

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getMode() {
  if (hasFlag("--create")) return "create";
  return "check";
}

function withOptionalSecret(callbackUrl) {
  const secret = process.env.CALENDLY_WEBHOOK_SECRET?.trim();
  if (!secret) return callbackUrl;

  const url = new URL(callbackUrl);
  if (!url.searchParams.has("secret")) {
    url.searchParams.set("secret", secret);
  }
  return url.toString();
}

function getCallbackUrl() {
  const explicitUrl =
    argValue("--url") ||
    process.env.CALENDLY_WEBHOOK_CALLBACK_URL?.trim() ||
    process.env.CALENDLY_WEBHOOK_URL?.trim();

  if (explicitUrl) return withOptionalSecret(explicitUrl);

  const dashboardUrl = process.env.DASHBOARD_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (!dashboardUrl) {
    throw new Error(
      [
        "Missing webhook URL.",
        "Set CALENDLY_WEBHOOK_CALLBACK_URL to your full dashboard webhook URL,",
        `or pass --url=https://your-domain.com${DEFAULT_WEBHOOK_PATH}`,
      ].join(" "),
    );
  }

  const baseUrl = dashboardUrl.startsWith("http") ? dashboardUrl : `https://${dashboardUrl}`;
  return withOptionalSecret(new URL(DEFAULT_WEBHOOK_PATH, baseUrl).toString());
}

async function calendlyFetch(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requiredEnv("CALENDLY_API_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = result.message || result.title || JSON.stringify(result);
    throw new Error(`Calendly API failed (${response.status}) ${path}: ${message}`);
  }

  return result;
}

async function getCurrentUserContext() {
  const result = await calendlyFetch("/users/me");
  const user = result.resource;

  if (!user?.uri || !user?.current_organization) {
    throw new Error("Calendly /users/me did not return user and organization URIs.");
  }

  return {
    userUri: user.uri,
    organizationUri: user.current_organization,
  };
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function subscriptionUrl(subscription) {
  return String(subscription.callback_url || subscription.url || "");
}

function subscriptionMatches(subscription, callbackUrl) {
  const currentUrl = subscriptionUrl(subscription);
  if (!currentUrl) return false;

  const events = Array.isArray(subscription.events) ? subscription.events : [];
  const state = String(subscription.state || "").toLowerCase();

  return (
    normalizeUrl(currentUrl) === normalizeUrl(callbackUrl) &&
    events.includes(EVENT_NAME) &&
    (!state || state === "active")
  );
}

async function listSubscriptions({ organizationUri, userUri, scope }) {
  const url = new URL(`${API_BASE_URL}/webhook_subscriptions`);
  url.searchParams.set("organization", organizationUri);
  url.searchParams.set("scope", scope);
  if (scope === "user") url.searchParams.set("user", userUri);

  const path = `${url.pathname}?${url.searchParams.toString()}`;
  const result = await calendlyFetch(path);
  return Array.isArray(result.collection) ? result.collection : [];
}

async function findExistingSubscription(context, callbackUrl) {
  const scopes = ["user", "organization"];
  const checked = [];

  for (const scope of scopes) {
    try {
      const subscriptions = await listSubscriptions({ ...context, scope });
      checked.push({ scope, count: subscriptions.length });
      const match = subscriptions.find((subscription) =>
        subscriptionMatches(subscription, callbackUrl),
      );
      if (match) return { subscription: match, scope, checked };
    } catch (error) {
      checked.push({
        scope,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { subscription: null, scope: null, checked };
}

async function createSubscription(context, callbackUrl) {
  const scope = process.env.CALENDLY_WEBHOOK_SCOPE?.trim() || "user";
  const body = {
    url: callbackUrl,
    events: [EVENT_NAME],
    organization: context.organizationUri,
    scope,
  };

  if (scope === "user") {
    body.user = context.userUri;
  }

  return calendlyFetch("/webhook_subscriptions", {
    method: "POST",
    body,
  });
}

function printSubscription(subscription, scope) {
  console.log(`Webhook subscription found (${scope} scope).`);
  console.log(`Subscription URI: ${subscription.uri || "Unknown"}`);
  console.log(`Callback URL: ${subscriptionUrl(subscription) || "Unknown"}`);
  console.log(`Events: ${(subscription.events || []).join(", ") || "Unknown"}`);
  console.log(`State: ${subscription.state || "Unknown"}`);
}

async function main() {
  const mode = getMode();
  const callbackUrl = getCallbackUrl();
  const context = await getCurrentUserContext();
  const existing = await findExistingSubscription(context, callbackUrl);

  console.log(`Calendly webhook URL checked: ${callbackUrl}`);
  console.log(`Checked scopes: ${JSON.stringify(existing.checked, null, 2)}`);

  if (existing.subscription) {
    printSubscription(existing.subscription, existing.scope);
    console.log("CALENDLY_API_TOKEN is not needed at dashboard runtime.");
    return;
  }

  if (mode !== "create") {
    console.log("No matching Calendly webhook subscription was found.");
    console.log("Run again with --create to create it.");
    process.exitCode = 1;
    return;
  }

  const created = await createSubscription(context, callbackUrl);
  const subscription = created.resource || created;

  console.log("Webhook subscription created.");
  printSubscription(subscription, process.env.CALENDLY_WEBHOOK_SCOPE?.trim() || "user");
  console.log("CALENDLY_API_TOKEN was only used for setup. It is not needed at dashboard runtime.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
