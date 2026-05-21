import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, DatabaseZap } from "lucide-react";
import { dashboardSheetQuery } from "@/lib/sheets-public";

export function DataSourceBanner() {
  const { data, error, isError } = useQuery(dashboardSheetQuery);

  if (!data && !isError) return null;
  if (data?.source === "google-sheet") return null;

  const isConnectionError = isError || data?.source === "error";
  const message =
    error instanceof Error
      ? error.message
      : data?.error ??
        "Google Sheets is not configured in local development, so the dashboard is showing mock data.";

  return (
    <div
      className={`mb-5 rounded-3xl border p-4 text-sm shadow-sm ${
        isConnectionError
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-fun-yellow/60 bg-fun-yellow/20 text-foreground"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isConnectionError ? (
            <AlertTriangle className="h-5 w-5" />
          ) : (
            <DatabaseZap className="h-5 w-5" />
          )}
        </div>
        <div>
          <div className="font-bold">
            {isConnectionError ? "Google Sheets connection needs attention" : "Using local demo data"}
          </div>
          <p className="mt-1 text-xs leading-relaxed opacity-85">{message}</p>
        </div>
      </div>
    </div>
  );
}
