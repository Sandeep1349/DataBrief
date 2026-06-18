import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listThreads, createThread, deleteThread,
  listMessages, sendMessage, renameThread, getRecentDatasetIds,
} from "../api/chat";
import { listDatasets } from "../api/datasets";
import type { Thread, Message, Dataset } from "../types";
import { useTheme } from "../ThemeContext";

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
  startedAt?: number;
  duration?: number;
}

export default function Chat() {
  const [searchParams] = useSearchParams();
  const initialDataset = searchParams.get("dataset");
  const { theme } = useTheme();
  const dark = theme === "dark";

  const tok = {
    bg:           dark ? "#08091e" : "#f1f5f9",
    sidebar:      dark ? "#09091f" : "#ffffff",
    sidebarBdr:   dark ? "rgba(139,92,246,0.16)" : "rgba(226,232,240,0.8)",
    divider:      dark ? "rgba(255,255,255,0.05)" : "#f1f5f9",
    surface:      dark ? "#0d1235" : "#ffffff",
    surfaceAlt:   dark ? "#07102a" : "#f8fafc",
    border:       dark ? "#1e2a4a" : "#e2e8f0",
    t1:           dark ? "#dde5ff" : "#1e293b",
    t2:           dark ? "#94a3b8" : "#475569",
    t3:           dark ? "#64748b" : "#94a3b8",
    threadActive: dark
      ? { bg: "rgba(99,102,241,0.12)", bdr: "rgba(99,102,241,0.25)", txt: "#818cf8" }
      : { bg: "linear-gradient(to right, #f0f9ff, #eef2ff)", bdr: "#bae6fd", txt: "#0369a1" },
    threadHover:  dark ? "rgba(255,255,255,0.04)" : "#f8fafc",
    threadIcon:   dark ? "#6366f1" : "#7dd3fc",
    threadTxt:    dark ? "#94a3b8" : "#64748b",
    inputBg:      dark ? "#0d1235" : "#f8fafc",
    inputBdr:     dark ? "#2d3a6a" : "#e2e8f0",
    asstBubble:   dark ? { bg: "#0d1235", bdr: "#1e2a4a", txt: "#c7d2fe" } : { bg: "#ffffff", bdr: "#e2e8f0", txt: "#334155" },
    thinkBg:      dark ? "#07102a" : "#f8fafc",
    thinkBdr:     dark ? "#1a2640" : "#e2e8f0",
    thinkTxt:     dark ? "#64748b" : "#64748b",
    codeBg:       dark ? "#020817" : "#f1f5f9",
    scopeLabel:   dark ? "rgba(109,124,170,0.7)" : "#94a3b8",
    checkActive:  dark ? "#6366f1" : "#0ea5e9",
    checkBdr:     dark ? "#4f46e5" : "#0ea5e9",
    checkIdle:    dark ? "#2d3a6a" : "#cbd5e1",
  };

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [recentDatasetIds, setRecentDatasetIds] = useState<string[]>([]);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>(
    initialDataset ? [initialDataset] : []
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadSidebar(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function loadSidebar() {
    const [tList, dList, recentIds] = await Promise.all([
      listThreads(), listDatasets(), getRecentDatasetIds(),
    ]);
    setThreads(tList);
    setDatasets(dList.filter((d) => d.status === "ready"));
    setRecentDatasetIds(recentIds);
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
    if (activeThread === id) { setActiveThread(null); setMessages([]); }
  }

  async function handleSend() {
    if (!input.trim() || !activeThread || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", streaming: true, thoughts: [], showThoughts: true, startedAt: Date.now() },
    ]);

    let buffer = "";

    stopRef.current = sendMessage(
      activeThread, text, selectedDatasets,
      (chunk) => {
        if (chunk.type === "thinking" && chunk.text) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            last.thoughts = [...(last.thoughts ?? []), { text: chunk.text! }];
            updated[updated.length - 1] = last;
            return updated;
          });
        }
        if (chunk.type === "tool_call" && chunk.question) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };
            const thoughts = [...(last.thoughts ?? [])];
            if (thoughts.length > 0) {
              thoughts[thoughts.length - 1] = { ...thoughts[thoughts.length - 1], isToolCall: true, query: chunk.question };
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
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: buffer, streaming: true };
            return updated;
          });
        }
        if (chunk.type === "error" && chunk.text) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: `⚠️ ${chunk.text}`, streaming: false };
            return updated;
          });
          setSending(false);
        }
      },
      () => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, streaming: false, duration: last.startedAt ? Date.now() - last.startedAt : undefined };
          return updated;
        });
        setSending(false);
        listThreads().then(setThreads);
        getRecentDatasetIds().then(setRecentDatasetIds);
      },
      (e) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: `⚠️ Error: ${e.message}`, streaming: false };
          return updated;
        });
        setSending(false);
      }
    );
  }

  function startRename(id: string, currentTitle: string) {
    setEditingThreadId(id);
    setEditingTitle(currentTitle);
    setTimeout(() => editInputRef.current?.select(), 0);
  }

  async function commitRename(id: string) {
    const title = editingTitle.trim();
    if (title && title !== threads.find((t) => t.thread_id === id)?.title) {
      await renameThread(id, title);
      setThreads((prev) => prev.map((t) => (t.thread_id === id ? { ...t, title } : t)));
    }
    setEditingThreadId(null);
  }

  function toggleDataset(id: string) {
    setSelectedDatasets((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]);
  }

  function toggleThoughts(idx: number) {
    setMessages((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], showThoughts: !updated[idx].showThoughts };
      return updated;
    });
  }

  const scopeDatasets = recentDatasetIds.length > 0
    ? datasets.filter((d) => recentDatasetIds.includes(d.dataset_id)).slice(0, 3)
    : datasets.slice(0, 3);

  return (
    <div className="flex h-full" style={{ background: tok.bg }}>
      {/* Thread sidebar */}
      <div
        className="w-72 shrink-0 h-full flex flex-col shadow-sm"
        style={{ background: tok.sidebar, borderRight: `1px solid ${tok.sidebarBdr}` }}
      >
        <div className="p-4" style={{ borderBottom: `1px solid ${tok.divider}` }}>
          <button
            onClick={newThread}
            className="w-full bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition-all shadow-sm hover:shadow-md"
          >
            + New conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 sidebar-scroll">
          {threads.length === 0 && (
            <p className="text-xs px-3 py-4 text-center" style={{ color: tok.t3 }}>No conversations yet</p>
          )}
          {threads.map((t) => {
            const isActive = activeThread === t.thread_id;
            return (
              <div
                key={t.thread_id}
                className="group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer text-sm transition-all"
                style={
                  isActive
                    ? { background: tok.threadActive.bg, border: `1px solid ${tok.threadActive.bdr}`, color: tok.threadActive.txt }
                    : { background: "transparent", border: "1px solid transparent", color: tok.threadTxt }
                }
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = tok.threadHover; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                onClick={() => { if (editingThreadId !== t.thread_id) openThread(t.thread_id); }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: isActive ? tok.threadIcon : tok.t3 }}>
                  <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
                </svg>

                {editingThreadId === t.thread_id ? (
                  <input
                    ref={editInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => commitRename(t.thread_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(t.thread_id);
                      if (e.key === "Escape") setEditingThreadId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 rounded-lg px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-sky-400"
                    style={{ background: tok.inputBg, border: `1px solid ${tok.checkActive}`, color: tok.t1 }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="flex-1 truncate font-medium"
                    onDoubleClick={(e) => { e.stopPropagation(); startRename(t.thread_id, t.title); }}
                  >
                    {t.title}
                  </span>
                )}

                {editingThreadId !== t.thread_id && (
                  <>
                    <button
                      title="Rename"
                      onClick={(e) => { e.stopPropagation(); startRename(t.thread_id, t.title); }}
                      className="opacity-0 group-hover:opacity-100 transition-all hover:text-sky-400"
                      style={{ color: tok.t3 }}
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                        <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81 3.23 11.33a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.25.25 0 00.108-.064L11.19 6.25z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteThread(t.thread_id); }}
                      className="opacity-0 group-hover:opacity-100 text-base leading-none px-0.5 transition-all hover:text-red-400"
                      style={{ color: tok.t3 }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {scopeDatasets.length > 0 && (
          <div className="p-4" style={{ borderTop: `1px solid ${tok.divider}` }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: tok.scopeLabel }}>
              Recent data scope
            </p>
            <div className="space-y-2">
              {scopeDatasets.map((d) => (
                <div
                  key={d.dataset_id}
                  className="flex items-center gap-2.5 cursor-pointer group"
                  onClick={() => toggleDataset(d.dataset_id)}
                >
                  <div
                    className="w-4 h-4 rounded-md flex items-center justify-center transition-all shrink-0"
                    style={{
                      background: selectedDatasets.includes(d.dataset_id) ? tok.checkActive : "transparent",
                      border: `2px solid ${selectedDatasets.includes(d.dataset_id) ? tok.checkBdr : tok.checkIdle}`,
                    }}
                  >
                    {selectedDatasets.includes(d.dataset_id) && (
                      <svg viewBox="0 0 12 12" fill="white" className="w-2.5 h-2.5">
                        <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </div>
                  <span className="text-xs truncate transition-colors" style={{ color: tok.t2 }}>{d.name}</span>
                </div>
              ))}
            </div>
            {selectedDatasets.length === 0 && (
              <p className="text-[11px] mt-2" style={{ color: tok.t3 }}>Recently used</p>
            )}
          </div>
        )}
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeThread ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shadow-xl shadow-sky-500/20">
              <svg viewBox="0 0 20 20" fill="white" className="w-8 h-8">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold" style={{ color: tok.t1 }}>Shiro</p>
              <p className="text-sm mt-1" style={{ color: tok.t3 }}>Ask anything about your data</p>
            </div>
            <button
              onClick={newThread}
              className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-all shadow-md hover:shadow-lg"
            >
              Start new conversation
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-5 sidebar-scroll">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" ? (
                    <div className="max-w-[78%] space-y-2">
                      {/* Chain-of-thought panel */}
                      {m.thoughts && m.thoughts.length > 0 && (
                        <div
                          className="rounded-2xl overflow-hidden"
                          style={{ border: `1px solid ${tok.thinkBdr}`, background: tok.thinkBg }}
                        >
                          <button
                            onClick={() => toggleThoughts(i)}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs transition text-left"
                            style={{ color: tok.thinkTxt }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = dark ? "rgba(255,255,255,0.03)" : "#f1f5f9"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                          >
                            <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform ${m.showThoughts ? "rotate-90" : ""}`}>
                              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="font-semibold">
                              {m.streaming && m.content === ""
                                ? "Thinking…"
                                : m.duration !== undefined
                                  ? `Thought for ${(m.duration / 1000).toFixed(1)}s`
                                  : "Reasoning"}
                            </span>
                            {m.streaming && m.content === "" && (
                              <span className="ml-1 flex gap-0.5">
                                <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                                <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                                <span className="w-1 h-1 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                              </span>
                            )}
                          </button>
                          {m.showThoughts && (
                            <div className="px-4 pb-3 space-y-1.5" style={{ borderTop: `1px solid ${tok.thinkBdr}` }}>
                              {m.thoughts.map((t, ti) => (
                                <div key={ti} className="flex gap-2 items-start text-xs pt-2" style={{ color: tok.thinkTxt }}>
                                  <span className="shrink-0 mt-0.5">{t.isToolCall ? "🔍" : "💭"}</span>
                                  <div>
                                    <span>{t.text}</span>
                                    {t.isToolCall && t.query && (
                                      <code
                                        className="block mt-1 font-mono rounded-lg px-2 py-1 text-[10px]"
                                        style={{ background: tok.codeBg, color: tok.thinkTxt }}
                                      >
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
                        <div
                          className="rounded-2xl rounded-tl-md px-4 py-3 text-sm shadow-sm"
                          style={{ background: tok.asstBubble.bg, border: `1px solid ${tok.asstBubble.bdr}` }}
                        >
                          <p className="whitespace-pre-wrap leading-relaxed" style={{ color: tok.asstBubble.txt }}>
                            {m.content}
                          </p>
                          {m.streaming && m.content && (
                            <span
                              className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse rounded-sm"
                              style={{ background: tok.t3 }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="max-w-[75%] bg-gradient-to-br from-sky-500 to-indigo-600 text-white rounded-2xl rounded-tr-md px-4 py-3 text-sm shadow-md">
                      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div
              className="p-4"
              style={{ borderTop: `1px solid ${tok.border}`, background: tok.sidebar }}
            >
              <div className="flex gap-3 items-end">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="Ask a question about your data… (Enter to send, Shift+Enter for newline)"
                  disabled={sending}
                  rows={1}
                  className="flex-1 rounded-2xl px-4 py-3 text-sm focus:outline-none resize-none disabled:opacity-50 transition-all"
                  style={{
                    background: tok.inputBg,
                    border: `1px solid ${tok.inputBdr}`,
                    color: tok.t1,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white px-5 py-3 rounded-2xl text-sm font-semibold disabled:opacity-40 transition-all shadow-md disabled:shadow-none shrink-0"
                >
                  {sending ? (
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-white/70 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1 h-1 rounded-full bg-white/70 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1 h-1 rounded-full bg-white/70 animate-bounce [animation-delay:300ms]" />
                    </span>
                  ) : (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
