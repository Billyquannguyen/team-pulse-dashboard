import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  Clock3,
  ExternalLink,
  Loader2,
  MessageCircle,
  X,
} from "lucide-react";
import {
  dismissSlackNotification,
  markSlackNotificationDone,
  slackNotificationsQuery,
  snoozeSlackNotification,
  type SlackNotificationItem,
} from "@/lib/slack-notifications";
import { cn } from "@/lib/utils";

function formatLastMessageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown time";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NotificationActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tb-action inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-muted px-3 text-xs font-bold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {icon}
      {label}
    </button>
  );
}

function NotificationCard({
  item,
  workingId,
  onDone,
  onSnooze,
  onDismiss,
}: {
  item: SlackNotificationItem;
  workingId: string | null;
  onDone: (item: SlackNotificationItem) => void;
  onSnooze: (item: SlackNotificationItem) => void;
  onDismiss: (item: SlackNotificationItem) => void;
}) {
  const disabled = workingId === item.id;

  return (
    <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fun-pink text-xs font-black">
              {item.personName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black">{item.personName}</div>
              <div className="text-xs font-semibold text-muted-foreground">
                {formatLastMessageTime(item.lastMessageAt)}
              </div>
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-fun-yellow px-2.5 py-1 text-[11px] font-black text-amber-950">
          {item.timeOverdue}
        </span>
      </div>

      {item.snippet && (
        <p className="mt-3 line-clamp-2 rounded-2xl bg-muted/55 px-3 py-2 text-xs font-medium text-muted-foreground">
          {item.snippet}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.jumpUrl && (
          <a
            href={item.jumpUrl}
            target="_blank"
            rel="noreferrer"
            className="tb-action inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90"
          >
            Open Slack
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <NotificationActionButton
          icon={disabled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          label="Done"
          onClick={() => onDone(item)}
          disabled={disabled}
        />
        <NotificationActionButton
          icon={<Clock3 className="h-3.5 w-3.5" />}
          label="Snooze"
          onClick={() => onSnooze(item)}
          disabled={disabled}
        />
        <NotificationActionButton
          icon={<X className="h-3.5 w-3.5" />}
          label="Dismiss"
          onClick={() => onDismiss(item)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching } = useQuery(slackNotificationsQuery);
  const count = data?.count ?? 0;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: slackNotificationsQuery.queryKey });
  };

  const runAction = async (
    item: SlackNotificationItem,
    action: "done" | "snooze" | "dismiss",
  ) => {
    setWorkingId(item.id);

    try {
      const payload = {
        conversationId: item.conversationId,
        lastMessageTs: item.lastMessageTs,
      };

      if (action === "done") {
        await markSlackNotificationDone({ data: payload });
      } else if (action === "snooze") {
        await snoozeSlackNotification({ data: { ...payload, hours: 24 } });
      } else {
        await dismissSlackNotification({ data: payload });
      }

      await refresh();
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "tb-action relative flex h-11 w-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border transition hover:bg-accent",
          open && "bg-accent",
        )}
        aria-label={`Slack follow-up notifications${count ? `, ${count} overdue` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-fun-pink px-1.5 text-[10px] font-black text-rose-950 ring-2 ring-background">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-14 z-50 w-[min(92vw,420px)] overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border">
          <div className="border-b border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  Slack follow-ups
                </div>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  DMs waiting 24h+ for your reply.
                </p>
              </div>
              {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {data?.warning && (
              <div className="mb-3 rounded-2xl border border-fun-yellow/60 bg-fun-yellow/20 p-3 text-xs font-bold">
                {data.warning}
              </div>
            )}

            {isLoading ? (
              <div className="rounded-2xl bg-muted/50 p-6 text-center text-sm font-bold text-muted-foreground">
                Checking Slack reminders...
              </div>
            ) : data?.items.length ? (
              <div className="space-y-3">
                {data.items.map((item) => (
                  <NotificationCard
                    key={`${item.id}-${item.lastMessageTs}`}
                    item={item}
                    workingId={workingId}
                    onDone={(nextItem) => runAction(nextItem, "done")}
                    onSnooze={(nextItem) => runAction(nextItem, "snooze")}
                    onDismiss={(nextItem) => runAction(nextItem, "dismiss")}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-muted/50 p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-fun-lime">
                  <Check className="h-5 w-5 text-emerald-950" />
                </div>
                <div className="mt-3 text-sm font-black">No current notifications</div>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  The hourly checker will add reminders here when something needs a reply.
                </p>
              </div>
            )}
          </div>

          {data?.lastSyncAt && (
            <div className="border-t border-border bg-muted/30 px-4 py-3 text-[11px] font-semibold text-muted-foreground">
              Last checked {formatLastMessageTime(data.lastSyncAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
