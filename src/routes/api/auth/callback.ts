import { createFileRoute } from "@tanstack/react-router";
import { createDashboardSupabaseServerClient } from "@/lib/supabase.server";

function redirectTo(request: Request, path: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, request.url).toString(),
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const next = url.searchParams.get("next") === "recovery" ? "recovery" : "confirmed";

        if (!code) return redirectTo(request, "/?authError=missing_code");

        const supabase = createDashboardSupabaseServerClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) return redirectTo(request, "/?authError=expired_link");

        return redirectTo(
          request,
          next === "recovery" ? "/?authMode=update-password" : "/?authMessage=verified",
        );
      },
    },
  },
});
