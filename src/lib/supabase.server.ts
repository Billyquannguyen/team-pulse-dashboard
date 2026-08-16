import "@tanstack/react-start/server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";

export type DashboardDatabase = {
  public: {
    Tables: {
      dashboard_members: {
        Row: {
          user_id: string;
          email: string;
          display_name: string;
          status: "pending" | "approved" | "rejected" | "disabled";
          role: "member" | "admin";
          team_member_id: string | null;
          linked_at: string | null;
          linked_by: string | null;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: {
          status?: "pending" | "approved" | "rejected" | "disabled";
          role?: "member" | "admin";
          team_member_id?: string | null;
          linked_at?: string | null;
          linked_by?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export function readSupabaseEnv() {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

  return {
    url,
    publishableKey,
    setupReady: Boolean(url && publishableKey),
    setupIssue:
      url && publishableKey
        ? null
        : "Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY for this environment.",
  };
}

export function createDashboardSupabaseServerClient() {
  const env = readSupabaseEnv();
  if (!env.setupReady) throw new Error(env.setupIssue ?? "Supabase is not configured.");

  return createServerClient<DashboardDatabase>(env.url, env.publishableKey, {
    auth: {
      flowType: "pkce",
    },
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, options as CookieOptions);
        }
      },
    },
  });
}
