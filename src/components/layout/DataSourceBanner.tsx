import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, DatabaseZap } from "lucide-react";
import { dashboardSheetQuery } from "@/lib/sheets-public";

export function DataSourceBanner() {
  const { data } = useQuery(dashboardSheetQuery);

  if (!data || data.source === "google-sheet") return null;

  const isError = data.source === "error";

  return (
    <div
      className={`mb-5 rounded-3xl border p-4 text-sm shadow-sm ${
        isError
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-fun-yellow/60 bg-fun-yellow/20 text-foreground"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isError ? <AlertTriangle className="h-5 w-5" /> : <DatabaseZap className="h-5 w-5" />}
        </div>
        <div>
          <div className="font-bold">
            {isError ? "Google Sheets connection needs attention" : "Using local demo data"}
          </div>
          <p className="mt-1 text-xs leading-relaxed opacity-85">
            {data.error ??
              "Google Sheets is not configured in local development, so the dashboard is showing mock data."}
          </p>
        </div>
      </div>
    </div>
  );
}
