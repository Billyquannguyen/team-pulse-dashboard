import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/layout/AppHeader";
import { EditableGoalsCard } from "@/components/dashboard/EditableGoalsCard";
import { GoalProgressCard } from "@/components/dashboard/GoalProgressCard";

export const Route = createFileRoute("/goals")({
  head: () => ({ meta: [{ title: "Goals — Team Billion" }, { name: "description", content: "Edit weekly team goals." }] }),
  component: GoalsPage,
});

function GoalsPage() {
  return (
    <div className="space-y-6">
      <AppHeader title="Weekly goals 🎯" subtitle="Edit team targets in one place." />
      <div className="grid gap-4 lg:grid-cols-2">
        <GoalProgressCard current={36450} target={60000} />
        <EditableGoalsCard />
      </div>
    </div>
  );
}
