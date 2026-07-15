import { createFileRoute } from "@tanstack/react-router";
import { handleSlackLinkAlertRequest } from "@/routes/api/slack-link-alerts";

export const Route = createFileRoute("/api/slack-link-alerts/$slot")({
  server: {
    handlers: {
      GET: ({ request }) => handleSlackLinkAlertRequest(request),
    },
  },
});
