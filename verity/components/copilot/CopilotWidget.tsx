"use client";

import { FormEvent, TransitionEvent, useEffect, useRef, useState } from "react";
import type { CopilotChart as CopilotChartSpec } from "@/lib/contracts/chat";
import { CopilotChart } from "./CopilotChart";

type Citation = { ref_id: string; label: string };
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  confidence?: number;
  caveat?: string | null;
  refused?: boolean;
  followUpQuestions?: string[];
  chart?: CopilotChartSpec;
  visualizationStatus?: string | null;
};

interface CopilotWidgetProps {
  clientId: string;
  clientName: string;
}

export function CopilotWidget({ clientId, clientName }: CopilotWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const [cardMounted, setCardMounted] = useState(false);
  const [cardLeaving, setCardLeaving] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [openers, setOpeners] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/chat/openers?clientId=${encodeURIComponent(clientId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load suggested questions");
        return response.json() as Promise<{ questions: string[] }>;
      })
      .then((body) => {
        if (!cancelled) setOpeners(body.questions);
      })
      .catch(() => {
        if (!cancelled) setOpeners([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function closeCopilot() {
    if (cardMounted && !cardLeaving) {
      setCardLeaving(true);
      return;
    }
    if (expanded && !cardMounted) {
      setExpanded(false);
    }
  }

  useEffect(() => {
    if (!expanded && !cardMounted) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      if (cardMounted && !cardLeaving) {
        setCardLeaving(true);
        return;
      }
      if (expanded && !cardMounted) {
        setExpanded(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded, cardMounted, cardLeaving]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    const assistantId = crypto.randomUUID();
    const priorMessages = messages;
    setMessages([
      ...priorMessages,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setQuery("");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          query: trimmed,
          conversation_id: conversationId ?? undefined,
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Copilot request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const dataLine = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(6));
          if (
            event.type === "context" &&
            typeof event.conversation_id === "string"
          ) {
            setConversationId(event.conversation_id);
            continue;
          }

          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              if (event.type === "text_delta") {
                return { ...message, content: message.content + event.delta };
              }
              if (event.type === "citations") {
                return { ...message, citations: event.citations };
              }
              if (event.type === "confidence") {
                return {
                  ...message,
                  confidence: event.confidence,
                  caveat: event.caveat,
                  refused: event.refused,
                };
              }
              if (event.type === "follow_ups") {
                return { ...message, followUpQuestions: event.questions };
              }
              if (event.type === "visualization_status") {
                return {
                  ...message,
                  visualizationStatus:
                    event.status === "planning" ? event.message : null,
                };
              }
              if (event.type === "visualization") {
                return {
                  ...message,
                  chart: event.chart,
                  visualizationStatus: null,
                };
              }
              return message;
            })
          );
        }
        if (done) break;
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Copilot unavailable";
      setError(message);
      setMessages((current) =>
        current.filter((item) => item.id !== assistantId || item.content)
      );
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(query);
  }

  function recordCitationView(refId: string) {
    void fetch("/api/audit/citation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, ref_id: refId }),
    });
  }

  function openCopilot() {
    if (expanded || cardMounted) return;
    setExpanded(true);
  }

  function handleLauncherTransitionEnd(event: TransitionEvent<HTMLButtonElement>) {
    if (event.propertyName !== "width") return;
    if (expanded && !cardMounted) {
      setCardMounted(true);
    }
  }

  function handleCardAnimationEnd() {
    if (cardLeaving) {
      setCardMounted(false);
      setCardLeaving(false);
      setExpanded(false);
      return;
    }
    inputRef.current?.focus();
  }

  return (
    <div ref={rootRef}>
      <button
        type="button"
        onClick={openCopilot}
        onTransitionEnd={handleLauncherTransitionEnd}
        className={`copilot-launcher ${expanded ? "is-expanded" : ""} ${cardMounted && !cardLeaving ? "pointer-events-none" : ""}`}
        aria-label={`Open AI Copilot for ${clientName}`}
        aria-expanded={cardMounted && !cardLeaving}
        tabIndex={cardMounted ? -1 : 0}
      >
        <span className="copilot-launcher-label">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/18 text-lg">
            ✦
          </span>
          <span className="text-left">
            <span className="block text-sm font-semibold">Ask Verity</span>
            <span className="block text-[11px] text-white/70">Grounded client copilot</span>
          </span>
        </span>
      </button>

      {cardMounted && (
        <aside
          className={`copilot-card ${cardLeaving ? "is-leaving" : "is-entering"}`}
          onAnimationEnd={handleCardAnimationEnd}
        >
          <header className="border-b border-white/25 bg-[linear-gradient(135deg,rgba(14,165,233,.78),rgba(59,108,255,.72),rgba(168,85,247,.78))] px-5 py-4 text-white backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-aqua">
                  RM Copilot
                </p>
                <h2 className="mt-1 text-lg font-semibold">Ask about {clientName}</h2>
                <p className="mt-1 text-xs text-white/65">
                  Multi-step retrieval · source-backed answers
                </p>
              </div>
              <button
                type="button"
                onClick={closeCopilot}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/10 text-xl text-white/75 transition hover:bg-white/20 hover:text-white"
                aria-label="Close Copilot"
              >
                ×
              </button>
            </div>
          </header>

          <div className="copilot-scroll flex-1 space-y-4 overflow-y-auto px-4 py-5">
            {messages.length === 0 && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/35 bg-white/28 p-4 text-sm text-slate backdrop-blur-md">
                  I retrieve this client&apos;s profile, signals, positions, mandates,
                  facilities, liquidity needs, transactions, and RM notes before answering.
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate/55">
                    Suggested questions
                  </p>
                  <div className="space-y-2">
                    {openers.map((opener) => (
                      <button
                        key={opener}
                        type="button"
                        onClick={() => void sendMessage(opener)}
                        className="w-full cursor-pointer rounded-2xl border border-white/40 bg-white/32 px-4 py-3 text-left text-sm font-medium text-navy shadow-sm backdrop-blur-md transition hover:border-lagoon/45 hover:bg-white/48"
                      >
                        {opener}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id}>
                <div
                  className={
                    message.role === "user"
                      ? "ml-10 rounded-2xl rounded-br-md bg-[linear-gradient(135deg,#1ea7ff,#4f6bff,#a855f7)] px-4 py-3 text-sm text-white shadow-[0_12px_28px_rgba(79,107,255,.38)]"
                      : "mr-5 rounded-2xl rounded-bl-md border border-white/45 bg-white/42 px-4 py-3 text-sm text-slate shadow-md backdrop-blur-md"
                  }
                >
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {message.content || (loading ? "Retrieving client evidence…" : "")}
                  </p>
                  {message.role === "assistant" &&
                    message.visualizationStatus && (
                      <div className="mt-3 flex items-center gap-2 rounded-xl bg-lagoon/8 px-3 py-2 text-[10px] font-medium text-lagoon">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-lagoon" />
                        {message.visualizationStatus}
                      </div>
                    )}
                  {message.role === "assistant" && message.chart && (
                    <CopilotChart chart={message.chart} />
                  )}
                  {message.role === "assistant" && message.citations && message.citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate/10 pt-3">
                      {message.citations.map((citation) => (
                        <button
                          type="button"
                          key={citation.ref_id}
                          title={citation.ref_id}
                          onClick={() => recordCitationView(citation.ref_id)}
                          className="rounded-full bg-grounded/12 px-2 py-1 text-[10px] font-bold text-grounded"
                        >
                          {citation.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {message.role === "assistant" && message.confidence !== undefined && (
                    <div className="mt-3 flex items-start justify-between gap-3 text-[11px]">
                      <span className="rounded-full bg-slate/8 px-2 py-1 font-bold text-slate">
                        {message.confidence}% confidence
                      </span>
                      {message.refused && (
                        <span className="rounded-full bg-risk-mid/12 px-2 py-1 font-bold text-risk-mid">
                          Read-only guardrail
                        </span>
                      )}
                    </div>
                  )}
                  {message.role === "assistant" && message.caveat && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate/60">
                      Caveat: {message.caveat}
                    </p>
                  )}
                </div>

                {message.role === "assistant" &&
                  message.followUpQuestions &&
                  message.followUpQuestions.length === 3 && (
                    <div className="mr-5 mt-2.5 space-y-1.5">
                      <p className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate/45">
                        Follow up
                      </p>
                      {message.followUpQuestions.map((question) => (
                        <button
                          key={question}
                          type="button"
                          disabled={loading}
                          onClick={() => void sendMessage(question)}
                          className="block w-full rounded-xl border border-white/45 bg-white/28 px-3 py-2 text-left text-xs font-medium text-slate shadow-sm backdrop-blur-md transition hover:border-violet/30 hover:bg-white/45 hover:text-navy disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            ))}

            {error && (
              <div className="rounded-2xl border border-risk-high/25 bg-risk-high/10 p-3 text-sm text-risk-high">
                {error}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="border-t border-white/35 bg-white/22 p-4 backdrop-blur-xl">
            <div className="flex items-end gap-2 rounded-2xl border border-white/45 bg-white/28 p-2 shadow-inner backdrop-blur-md">
              <textarea
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (query.trim()) void sendMessage(query);
                  }
                }}
                placeholder="Ask about holdings, risk, liquidity…"
                rows={2}
                disabled={loading}
                className="max-h-28 min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-slate/40"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-[linear-gradient(135deg,#1ea7ff,#4f6bff,#a855f7)] text-lg text-white shadow-[0_10px_24px_rgba(79,107,255,.42)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate/45">
              Advisory only · verify citations before client use
            </p>
          </form>
        </aside>
      )}
    </div>
  );
}
