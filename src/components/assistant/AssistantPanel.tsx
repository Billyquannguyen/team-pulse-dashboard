import { useState, useRef, useEffect } from "react";
import { Bot, RefreshCw, Send, Sparkles, X } from "lucide-react";
import type { AuthRole } from "@/lib/auth";
import {
  askBillyGpt,
  getBillyGptKnowledgeStatus,
  syncNotionKnowledge,
} from "@/lib/notion-knowledge";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "How do I follow up with a creator?",
  "What do I do if a brand asks for rates?",
  "Where can I find the outreach script?",
];

export function AssistantPanel({ authRole }: { authRole: AuthRole | null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hey, I'm Billy GPT. Ask me anything from the Team Billion handbook.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isAdmin = authRole === "admin";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    getBillyGptKnowledgeStatus()
      .then((status) => {
        if (!cancelled) {
          setLastSyncedAt(status.lastSyncTime);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLastSyncedAt(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setThinking(true);

    try {
      const reply = await askBillyGpt({ data: { question: text } });
      setMessages((m) => [...m, { role: "assistant", content: reply.answer }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billy GPT could not answer.";
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `I could not reach the handbook search right now. ${message}`,
        },
      ]);
    } finally {
      setThinking(false);
    }
  };

  const syncKnowledge = async () => {
    setSyncing(true);
    setSyncStatus(null);

    try {
      const result = await syncNotionKnowledge();

      if (result.isSynced) {
        setSyncStatus(`Synced ${result.pagesIndexed} pages and ${result.chunksIndexed} chunks.`);
        setLastSyncedAt(result.lastSyncTime);
      } else {
        setSyncStatus(result.errors[0] ?? result.setupIssue ?? "Notion sync needs attention.");
      }
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Notion sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="tb-action fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-xl transition hover:scale-105 lg:bottom-6 lg:right-6"
      >
        <Sparkles className="h-4 w-4" />
        Billy GPT
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-3">
                <div className="tb-hover-icon flex h-10 w-10 items-center justify-center rounded-2xl bg-fun-lime">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Billy GPT</div>
                  <div className="text-xs text-muted-foreground">
                    {lastSyncedAt
                      ? `Notion synced ${new Date(lastSyncedAt).toLocaleString()}`
                      : "Sync the Team Billion playbook"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={syncKnowledge}
                    disabled={syncing}
                    className="tb-action inline-flex items-center gap-2 rounded-2xl bg-fun-yellow/70 px-3 py-2 text-xs font-bold transition hover:bg-fun-yellow disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                    {syncing ? "Syncing" : "Sync Notion"}
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="tb-action rounded-full p-2 hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {syncStatus && (
                <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary">
                  {syncStatus}
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "tb-hover-lift max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                    Thinking…
                  </div>
                </div>
              )}
              {messages.length <= 1 && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-medium text-muted-foreground">Try one of these</div>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="tb-action block w-full rounded-2xl bg-fun-yellow/60 px-4 py-2.5 text-left text-sm font-medium hover:bg-fun-yellow"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-center gap-2 border-t border-border p-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything…"
                className="tb-search flex-1 rounded-2xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="submit"
                className="tb-action flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground hover:opacity-90"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
