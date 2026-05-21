import { useState, useRef, useEffect } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

// TODO(integration): Replace mockReply() with a TanStack server function that
// calls the Lovable AI Gateway via the Vercel AI SDK (streamText). The
// training source should be the Notion handbook — fetch + chunk + embed at
// index time, then retrieve top-k passages to ground the prompt.
function mockReply(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("follow up") || q.includes("creator"))
    return 'Wait 48 hours after the first DM. Reference one specific recent post, restate the value, and propose two clear next-step times. Example: "Loved your collab with @brand — open to a quick 15min Tue 2pm or Wed 11am ET to talk about a paid integration?"';
  if (q.includes("rate"))
    return 'Anchor on outcomes, not numbers: "Happy to share — rates depend on usage rights, exclusivity, and timeline. Mind if I ask 2 quick questions first so I send something accurate?" Then send your rate card from Drive.';
  if (q.includes("script") || q.includes("outreach"))
    return 'The current outreach scripts live in the Notion Handbook → Outreach → /scripts. Start with the "warm-intro v3" template when you have a mutual context point.';
  return "Great question! For now I'm running on canned answers. Once the Notion handbook is connected, I'll pull the exact playbook section for you.";
}

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "How do I follow up with a creator?",
  "What do I do if a brand asks for rates?",
  "Where can I find the outreach script?",
];

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hey! I'm your Team Billion AI work assistant 👋 Ask me anything about outreach, creator follow-ups, or brand objections.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      setMessages((m) => [...m, { role: "assistant", content: mockReply(text) }]);
      setThinking(false);
    }, 700);
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
                    Trained on the Team Billion playbook
                  </div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="tb-action rounded-full p-2 hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "tb-hover-lift max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
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
