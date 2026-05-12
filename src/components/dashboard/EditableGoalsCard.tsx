import { useEffect, useState } from "react";
import { defaultWeeklyGoals, type WeeklyGoal } from "@/data/goals";
import { Pencil, Check } from "lucide-react";

const STORAGE_KEY = "tb_weekly_goals_v1";

// TODO(integration): Sync these goals to a backend (e.g. Lovable Cloud / Notion).
export function useWeeklyGoals() {
  const [goals, setGoals] = useState<WeeklyGoal[]>(defaultWeeklyGoals);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setGoals(JSON.parse(raw)); } catch { /* ignore */ }
    }
  }, []);
  const update = (next: WeeklyGoal[]) => {
    setGoals(next);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };
  return [goals, update] as const;
}

export function EditableGoalsCard() {
  const [goals, setGoals] = useWeeklyGoals();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="rounded-3xl bg-card p-6 ring-1 ring-border">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Weekly goals ✏️</h3>
          <p className="text-xs text-muted-foreground">Tap a target to edit. Saved locally.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {goals.map((g) => {
          const pct = Math.min(100, Math.round((g.current / g.target) * 100));
          const editing = editingId === g.id;
          return (
            <li key={g.id} className="rounded-2xl bg-muted/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{g.label}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {g.unit === "$" ? `$${g.current.toLocaleString()}` : g.current} /
                  </span>
                  {editing ? (
                    <input
                      autoFocus
                      type="number"
                      defaultValue={g.target}
                      className="w-24 rounded-lg border border-border bg-card px-2 py-1 text-sm"
                      onBlur={(e) => {
                        const v = Number(e.target.value) || g.target;
                        setGoals(goals.map((x) => (x.id === g.id ? { ...x, target: v } : x)));
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                  ) : (
                    <button
                      className="flex items-center gap-1 rounded-lg bg-card px-2 py-1 text-sm font-semibold ring-1 ring-border hover:bg-accent"
                      onClick={() => setEditingId(g.id)}
                    >
                      {g.unit === "$" ? `$${g.target.toLocaleString()}` : g.target}
                      <Pencil className="h-3 w-3 opacity-60" />
                    </button>
                  )}
                  {editing && <Check className="h-3 w-3 text-success" />}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-card">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-fun-lime to-fun-orange"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
