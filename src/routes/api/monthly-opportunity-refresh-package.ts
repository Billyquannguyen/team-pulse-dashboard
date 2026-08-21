import { createFileRoute } from "@tanstack/react-router";
import { requireAdminAuth } from "@/lib/auth.server";
import { getMonthlyRefreshPackageResponse } from "@/lib/monthly-opportunity-refresh.server";

export const Route = createFileRoute("/api/monthly-opportunity-refresh-package")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAdminAuth();
        } catch {
          return new Response("Admin access required.", { status: 401 });
        }

        const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";
        if (!runId) return new Response("Run ID is required.", { status: 400 });
        const result = await getMonthlyRefreshPackageResponse(runId);
        if (!result || result.statusCode !== 200 || !result.stream) {
          return new Response("Monthly package not found.", { status: 404 });
        }

        return new Response(result.stream, {
          headers: {
            "Content-Type": result.blob.contentType || "application/zip",
            "Content-Disposition": `attachment; filename="team-billion-monthly-refresh-${runId}.zip"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
