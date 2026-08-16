import { createFileRoute } from "@tanstack/react-router";
import { createDashboardSupabaseServerClient } from "@/lib/supabase.server";
import { dashboardPublicOrigin } from "@/lib/auth.server";

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

        if (next === "confirmed") {
          const { data: userData } = await supabase.auth.getUser();
          const user = userData.user;
          if (user?.email) {
            const { notifyAdminOfVerifiedMember } =
              await import("@/lib/admin-approval-notification.server");
            await notifyAdminOfVerifiedMember({
              email: user.email,
              displayName:
                typeof user.user_metadata?.display_name === "string"
                  ? user.user_metadata.display_name
                  : "",
              dashboardOrigin: dashboardPublicOrigin(),
            }).catch((notificationError) => {
              console.error("Dashboard approval notification failed", notificationError);
            });
          }
        }

        return redirectTo(
          request,
          next === "recovery" ? "/?authMode=update-password" : "/?authMessage=verified",
        );
      },
    },
  },
});
