import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listThreads,
  createThread,
  deleteThread,
  listMessages,
  sendMessage,
} from "../api/chat";
import { listDatasets } from "../api/datasets";
import type { Thread, Message, Dataset } from "../types";

interface ThoughtStep {
  text: string;
  isToolCall?: boolean;
  query?: string;
}

interface LocalMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  thoughts?: ThoughtStep[];
  showThoughts?: boolean;
}

export default function Chat() {
  const [searchParams] = useSearchParams();
  const initialDataset = searchParams.get("dataset");

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>(
    initialDataset ? [initialDataset] : []
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadSidebar();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadSidebar() {
    const [tList, dList] = await Promise.all([listThreads(), listDatasets()]);
    setThreads(tList);
    setDatasets(dList.filter((d) => d.status === "ready"));
  }

  async function openThread(threadId: string) {
    setActiveThread(threadId);
    const msgs = await listMessages(threadId);
    setMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
  }

  async function newThread() {
    const thread = await createThread("New conversation");
    setThreads((prev) => [thread, ...prev]);
    setActiveThread(thread.thread_id);
    setMessages([]);
  }

  async function handleDeleteThread(id: string) {
    await deleteThread(id);
    setThreads((prev) => prev.filter((t) => t.thread_id !== id));
    if (activeThread === id) {
      setActiveThread(null);
      setMessages([]);
    }
  }

  async function handleSend() {
    if (!input.trim() || !activeThread || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    // Placeholder assistant message that we'll stream into
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", streaming: true, thoughts: [], showThoughts: true },
    ]);

    let buffer = "";

    stopRef.current = sendMessage(
      activeThread,
      text,
      selectedDatasets,
      (chunk) => {
        if (chunk.type === "thinking" && chunk.text) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            last.thoughts = [
              ...(last.thoughts ?? []),
              { text: chunk.text! },
            ];
            updated[updated.length - 1] = last;
            return updated;
          });
        }

        if (chunk.type === "tool_call" && chunk.question) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            // Replace the last thought with a tool-call variant
            const thoughts = [...(last.thoughts ?? [])];
            // Find and mark the last thought as a tool call
            if (thoughts.length > 0) {
              thoughts[thoughts.length - 1] = {
                ...thoughts[thoughts.length - 1],
                isToolCall: true,
                query: chunk.question,
              };
            } else {
              thoughts.push({ text: chunk.question!, isToolCall: true, query: chunk.question });
            }
            last.thoughts = thoughts;
            updated[updated.length - 1] = last;
            return updated;
          });
        }

        if (chunk.type === "text" && chunk.text) {
          buffer += chunk.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: buffer,
              streaming: true,
            };
            return updated;
          });
        }

        if (chunk.type === "error" && chunk.text) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: `⚠️ ${chunk.text}`,
              streaming: false,
            };
            return updated;
          });
          setSending(false);
        }
      },
      () => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            streaming: false,
          };
          return updated;
        });
        setSending(false);
        listThreads().then(setThreads);
      },
      (e) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `⚠️ Error: ${e.message}`,
            streaming: false,
          };
          return updated;
        });
        setSending(false);
      }
    );
  }

  function toggleDataset(id: string) {
    setSelectedDatasets((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  function toggleThoughts(idx: number) {
    setMessages((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], showThoughts: !updated[idx].showThoughts };
      return updated;
    });
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-200 bg-white flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-100">
          <button
            onClick={newThread}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium py-2 rounded-lg transition"
          >
            + New conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {threads.map((t) => (
            <div
              key={t.thread_id}
              className={`group flex items-center gap-1 px-3 py-2 rounded-lg cursor-pointer text-sm ${
                activeThread === t.thread_id
                  ? "bg-brand-50 text-brand-700"
                  : "hover:bg-gray-50 text-gray-700"
              }`}
              onClick={() => openThread(t.thread_id)}
            >
              <span className="flex-1 truncate">{t.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteThread(t.thread_id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 text-xs px-1"
              >
                ×
              </button>
            </div>
          ))}
          {threads.length === 0 && (
            <p className="text-xs text-gray-400 px-3 py-2">No conversations yet</p>
          )}
        </div>

        {datasets.length > 0 && (
          <div className="border-t border-gray-100 p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Data scope</p>
            <div className="space-y-1">
              {datasets.map((d) => (
                <label key={d.dataset_id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDatasets.includes(d.dataset_id)}
                    onChange={() => toggleDataset(d.dataset_id)}
                    className="accent-brand-600"
                  />
                  <span className="text-xs text-gray-600 truncate">{d.name}</span>
                </label>
              ))}
            </div>
            {selectedDatasets.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">All datasets in scope</p>
            )}
          </div>
        )}
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeThread ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <p className="text-lg font-medium text-gray-600">DataBrief Chat</p>
            <p className="text-sm mt-2">Select a conversation or start a new one</p>
            <button
              onClick={newThread}
              className="mt-4 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
            >
              Start new conversation
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" ? (
                    <div className="max-w-[78%] space-y-2">
                      {/* Chain-of-thought panel */}
                      {m.thoughts && m.thoughts.length > 0 && (
                        <div className="rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
                          <button
                            onClick={() => toggleThoughts(i)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 transition text-left"
                          >
                            <span className={`transition-transform ${m.showThoughts ? "rotate-90" : ""}`}>
                              ▶
                            </span>
                            <span className="font-medium">
                              {m.streaming && m.content === ""
                                ? "Thinking…"
                                : `Reasoning (${m.thoughts.length} step${m.thoughts.length !== 1 ? "s" : ""})`}
                            </span>
                            {m.streaming && m.content === "" && (
                              <span className="ml-1 flex gap-0.5">
                                <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                                <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                                <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                              </span>
                            )}
                          </button>

                          {m.showThoughts && (
                            <div className="px-3 pb-3 space-y-1.5 border-t border-gray-100">
                              {m.thoughts.map((t, ti) => (
                                <div key={ti} className="flex gap-2 items-start text-xs text-gray-500 pt-1.5">
                                  <span className="shrink-0 mt-0.5">
                                    {t.isToolCall ? "🔍" : "💭"}
                                  </span>
                                  <div>
                                    <span>{t.text}</span>
                                    {t.isToolCall && t.query && (
                                      <code className="block mt-0.5 text-gray-400 font-mono bg-gray-100 rounded px-1.5 py-0.5 text-[10px]">
                                        {t.query}
                                      </code>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Message bubble */}
                      {(m.content || m.streaming) && (
                        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm shadow-sm">
                          <p className="whitespace-pre-wrap leading-relaxed text-gray-800">
                            {m.content}
                          </p>
                          {m.streaming && m.content && (
                            <span className="inline-block w-1.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm" />
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="max-w-[75%] bg-brand-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
                      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-gray-200 p-4">
              <div className="flex gap-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask a question about your data… (Enter to send, Shift+Enter for newline)"
                  disabled={sending}
                  rows={1}
                  className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 transition shrink-0"
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
