import { api, BASE } from "./client";
import type { Thread, Message } from "../types";

export const listThreads = () => api.get<Thread[]>("/chat/threads");

export const createThread = (title?: string) =>
  api.post<Thread>("/chat/threads", { title: title ?? "New conversation" });

export const getThread = (id: string) =>
  api.get<Thread>(`/chat/threads/${id}`);

export const deleteThread = (id: string) =>
  api.delete<void>(`/chat/threads/${id}`);

export const renameThread = (id: string, title: string) =>
  api.patch<Thread>(`/chat/threads/${id}`, { title });

export const getRecentDatasetIds = () =>
  api.get<string[]>("/chat/recent-datasets");

export const listMessages = (threadId: string) =>
  api.get<Message[]>(`/chat/threads/${threadId}/messages`);

export interface SseChunk {
  type: "text" | "thinking" | "tool_call" | "done" | "error";
  text?: string;
  question?: string;
  full_text?: string;
}

export function sendMessage(
  threadId: string,
  content: string,
  datasetIds: string[],
  onChunk: (chunk: SseChunk) => void,
  onDone: (fullText: string) => void,
  onError: (e: Error) => void
): () => void {
  const token = localStorage.getItem("token");
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(
        `${BASE}/chat/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content, dataset_ids: datasetIds }),
          signal: controller.signal,
        }
      );

      if (!res.ok || !res.body) {
        onError(new Error(`HTTP ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;

          try {
            const chunk: SseChunk = JSON.parse(raw);
            onChunk(chunk);
            if (chunk.type === "done") {
              fullText = chunk.full_text ?? fullText;
            }
          } catch {
            // skip malformed
          }
        }
      }
      onDone(fullText);
    } catch (e) {
      if ((e as Error).name !== "AbortError") onError(e as Error);
    }
  })();

  return () => controller.abort();
}
