"""Three-agent system using Groq (OpenAI-compatible tool use).

Analyst agent  — generates safe SELECT SQL, executes it, returns rows.
Writer agent   — turns KPIs + analyst output into a narrative summary.
Chat agent     — interactive Q&A; calls Analyst as a tool when it needs data.
                 Emits SSE "thinking" events so the frontend can show reasoning.

SQL safety rules:
  • Must start with SELECT
  • No statement separators (;) mid-query
  • LIMIT injected/capped at 500 rows

Tool-call fallback:
  llama-3.3-70b-versatile occasionally emits tool calls in the legacy Hermes
  text format (<function=name {...}></function>) instead of the JSON tool_calls
  field.  Groq rejects these with a 400 tool_use_failed error that embeds the
  failed_generation string.  We parse that string, execute the analyst anyway,
  and inject the result as a user message so Phase 2 can synthesize an answer.
"""
import json
import logging
import re
import uuid
from typing import Iterator

from groq import Groq, AuthenticationError, RateLimitError

from ..config import get_settings
from ..database import get_client

log = logging.getLogger(__name__)

MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
MAX_ANALYST_ROWS = 500
MAX_TOOL_ROUNDS = 4

# Matches all known Hermes-style function call variants from llama-3.3-70b:
#   <function=name {"q": "..."}></function>       → =name space JSON
#   <function/name>{"q": "..."}</function>         → /name> JSON
#   <function=name({"q": "..."})</function>        → =name(JSON)
#   <function(name){"q": "..."}</function>         → (name) JSON
_HERMES_RE = re.compile(
    r"<function[=/]?[(\[]?(\w+)[)\]>;\s(]*(\{.*?\})\s*[)\]]?\s*(?:</function>)?",
    re.DOTALL,
)


# ---------------------------------------------------------------------------
# SQL safety validator
# ---------------------------------------------------------------------------

def _safe_select(sql: str) -> str:
    stripped = re.sub(r"--[^\n]*", "", sql).strip().rstrip(";")
    if not re.match(r"(?i)^\s*SELECT\b", stripped):
        raise ValueError(f"Only SELECT statements are allowed, got: {stripped[:60]!r}")
    if re.search(r";(?!\s*$)", stripped):
        raise ValueError("Multiple SQL statements are not allowed")
    if not re.search(r"(?i)\bLIMIT\b", stripped):
        stripped = f"{stripped}\nLIMIT {MAX_ANALYST_ROWS}"
    else:
        def _cap(m):
            return f"LIMIT {min(int(m.group(1)), MAX_ANALYST_ROWS)}"
        stripped = re.sub(r"(?i)\bLIMIT\s+(\d+)", _cap, stripped)
    return stripped


# ---------------------------------------------------------------------------
# Groq tool definition (OpenAI format)
# ---------------------------------------------------------------------------

_ANALYST_TOOL = {
    "type": "function",
    "function": {
        "name": "run_sql_query",
        "description": (
            "Execute a ClickHouse SELECT query to answer a data question. "
            "Provide a natural-language question and the tool will generate and run the SQL."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The data question to answer with a SQL query",
                }
            },
            "required": ["question"],
        },
    },
}


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _thinking(text: str) -> str:
    return _sse({"type": "thinking", "text": text})


def _text(text: str) -> str:
    return _sse({"type": "text", "text": text})


def _tool_event(question: str) -> str:
    return _sse({"type": "tool_call", "question": question})


# ---------------------------------------------------------------------------
# Hermes fallback parser
# ---------------------------------------------------------------------------

def _parse_hermes_call(text: str) -> tuple[str, dict] | None:
    """Extract (function_name, args_dict) from a Hermes-format tool call string."""
    m = _HERMES_RE.search(text)
    if not m:
        return None
    try:
        return m.group(1), json.loads(m.group(2))
    except (json.JSONDecodeError, IndexError):
        return None


# ---------------------------------------------------------------------------
# Analyst agent
# ---------------------------------------------------------------------------

def run_analyst(question: str, schemas: list[dict]) -> dict:
    s = get_settings()
    if not s.groq_api_key:
        return {"error": "Groq API key not configured", "rows": [], "sql": ""}

    client = Groq(api_key=s.groq_api_key)
    db = get_client()

    schema_text = "\n\n".join(
        f"Table: databrief.`{sc['table']}`\nColumns: {', '.join(sc['columns'])}"
        for sc in schemas
    )

    analyst_system = (
        "You are a ClickHouse SQL analyst. Write ONE complete SELECT query that answers the question.\n\n"
        "CRITICAL RULES:\n"
        "• Return ONLY the raw SQL — absolutely no markdown, no fences (```), no explanation.\n"
        "• ClickHouse dialect — backtick-quoted table/column identifiers.\n"
        "• No trailing semicolon.\n"
        "• For aggregate questions (average, sum, count, percentage) ALWAYS use aggregate functions "
        "(AVG, SUM, COUNT, countIf, avgIf, sumIf) — do NOT return individual rows.\n"
        "• Do NOT use assumeNotNull() in GROUP BY or ORDER BY — only in SELECT or WHERE.\n\n"
        "CLICKHOUSE-SPECIFIC PATTERNS:\n"
        "• Average: SELECT AVG(`col`) AS avg_col FROM `tbl`\n"
        "• Percentage of all rows: ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM `tbl`), 2)\n"
        "• Conditional count: countIf(`col` = value)  — NOT COUNT(if(col=val,1,NULL))\n"
        "• Conditional avg: avgIf(`col`, `filter_col` = value)\n"
        "• Conditional pct: ROUND(countIf(`col` = val) * 100.0 / COUNT(*), 2)\n"
        "• Hour extraction: toHour(`datetime_col`)\n"
        "• Day of week: toDayOfWeek(`datetime_col`)\n"
        "• NEVER use window functions (OVER, PARTITION BY, PERCENT_RANK) — unsupported.\n"
        "• NEVER use CTEs (WITH clause) — use flat subqueries instead.\n"
        "• NEVER use ISNULL() — use isNull() if needed."
    )

    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=512,
        messages=[
            {"role": "system", "content": analyst_system},
            {
                "role": "user",
                "content": f"Available tables:\n{schema_text}\n\nQuestion: {question}",
            },
        ],
    )
    raw_sql = resp.choices[0].message.content.strip()
    # Extract SQL from code fence if model wrapped it (take first fence block if multiple)
    fence_match = re.search(r"```(?:sql)?\s*(.*?)\s*```", raw_sql, re.DOTALL | re.IGNORECASE)
    if fence_match:
        raw_sql = fence_match.group(1).strip()
    else:
        raw_sql = re.sub(r"^```(?:sql)?\s*", "", raw_sql, flags=re.IGNORECASE)
        raw_sql = re.sub(r"\s*```.*$", "", raw_sql, flags=re.DOTALL).strip()

    try:
        safe_sql = _safe_select(raw_sql)
    except ValueError as e:
        log.warning("Analyst SQL rejected (question=%r): %s", question, e)
        return {"error": str(e), "rows": [], "sql": raw_sql}

    log.info("Analyst SQL for %r: %s", question, safe_sql)
    try:
        result = db.query(safe_sql)
        rows = [
            {k: (str(v) if not isinstance(v, (int, float, bool, type(None))) else v)
             for k, v in r.items()}
            for r in result.named_results()
        ]
        return {"sql": safe_sql, "rows": rows, "error": None}
    except Exception as e:
        log.warning("Analyst SQL execution failed (question=%r, sql=%r): %s", question, safe_sql, e)
        return {"error": str(e), "rows": [], "sql": safe_sql}


# ---------------------------------------------------------------------------
# Writer agent
# ---------------------------------------------------------------------------

def run_writer(dataset_name: str, kpis: list[dict], analyst_result: dict | None = None) -> str:
    s = get_settings()
    if not s.groq_api_key:
        return "_Groq API key not configured — narrative generation unavailable._"

    client = Groq(api_key=s.groq_api_key)
    kpi_text = "\n".join(f"- {k['name']}: {k['value']}" for k in kpis)
    extra = ""
    if analyst_result and analyst_result.get("rows"):
        extra = f"\n\nAdditional query data:\n{json.dumps(analyst_result['rows'][:20], indent=2)}"

    resp = client.chat.completions.create(
        model=MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "system",
                "content": "You are a senior data analyst writing concise executive summaries.",
            },
            {
                "role": "user",
                "content": (
                    f"Dataset: {dataset_name}\n\nKey metrics:\n{kpi_text}{extra}\n\n"
                    "Write a 3–5 paragraph executive summary covering:\n"
                    "1. Overview of what the data shows\n"
                    "2. Key findings and patterns\n"
                    "3. Notable risks or anomalies\n"
                    "4. Actionable recommendations\n\n"
                    "Be specific, data-driven, and professional. Use the actual numbers."
                ),
            },
        ],
    )
    return resp.choices[0].message.content


# ---------------------------------------------------------------------------
# Chat agent — streams SSE with chain-of-thought thinking events
# ---------------------------------------------------------------------------

def stream_chat_response(
    thread_id: str,
    user_message: str,
    history: list[dict],
    schemas: list[dict],
    kpis: list[dict],
) -> Iterator[str]:
    s = get_settings()
    if not s.groq_api_key:
        yield _text("⚠️ Groq API key not configured. Set GROQ_API_KEY in .env.")
        yield _sse({"type": "done", "full_text": ""})
        yield "data: [DONE]\n\n"
        return

    client = Groq(api_key=s.groq_api_key)

    # Show ALL columns so the analyst can write accurate SQL for any field
    schema_text = "\n".join(
        f"• databrief.`{sc['table']}` ({sc.get('name', sc['table'])})\n"
        f"  Columns: {', '.join(sc['columns'])}"
        for sc in schemas
    )
    # Show all KPIs (not just 8)
    kpi_text = "\n".join(f"• {k['name']}: {k['value']}" for k in kpis)

    system = (
        "You are DataBrief, an AI data analyst. Answer questions about the loaded dataset(s).\n\n"
        f"Available datasets:\n{schema_text or 'No datasets loaded yet'}\n\n"
        f"Known KPIs (pre-computed):\n{kpi_text or 'No KPIs available'}\n\n"
        "Rules:\n"
        "1. If the exact answer is in the Known KPIs above, quote it directly — no query needed.\n"
        "2. For ANY question about figures NOT explicitly listed in KPIs, call run_sql_query.\n"
        "   This includes: averages of columns not in KPIs, counts with filters, breakdowns, \n"
        "   percentages, ratios, per-row calculations, and top-N queries.\n"
        "3. NEVER calculate statistics by dividing two KPI values (e.g. don't compute \n"
        "   fare-per-mile by dividing Avg Fare by Avg Distance — run the proper SQL instead).\n"
        "4. Never invent or estimate numbers — use only KPIs or run_sql_query results.\n"
        "5. Give direct, concise answers with the actual numbers. Do not show SQL code.\n"
        "6. When you have query results, state the answer immediately and clearly."
    )

    # Strategy:
    #   Phase 1 — non-streaming calls with tools (reliable JSON).
    #             - If model answers directly → stream and return.
    #             - If model uses tool_calls → execute analyst, loop.
    #             - If Groq returns tool_use_failed (Hermes format) → parse from error,
    #               execute analyst, inject result as user message, continue to Phase 2.
    #   Phase 2 — streaming call WITHOUT tools once tool results are in context.
    system_msg: dict = {"role": "system", "content": system}
    messages: list[dict] = [{"role": h["role"], "content": h["content"]} for h in history[-20:]]
    messages.append({"role": "user", "content": user_message})

    full_text = ""
    ran_any_tool = False
    answered = False
    hermes_fallback_done = False

    try:
        yield _thinking("Analyzing your question…")

        # ── Phase 1: agentic tool-call loop (non-streaming) ──────────────────
        for _ in range(MAX_TOOL_ROUNDS):
            try:
                response = client.chat.completions.create(
                    model=MODEL,
                    max_tokens=512,
                    tools=[_ANALYST_TOOL],
                    tool_choice="auto",
                    messages=[system_msg] + messages,
                )
            except RateLimitError as e:
                err_str = str(e)
                import re as _re
                wait_m = _re.search(r"try again in (\d+m[\d.]+s)", err_str)
                wait_hint = f" Try again in {wait_m.group(1)}." if wait_m else ""
                yield _text(f"⚠️ Groq rate limit reached.{wait_hint}")
                answered = True
                break
            except Exception as e:
                err_str = str(e)
                # Attempt to recover a Hermes-format function call from the error body
                parsed = _parse_hermes_call(err_str)
                if parsed and not hermes_fallback_done:
                    hermes_fallback_done = True
                    func_name, args = parsed
                    if func_name == "run_sql_query":
                        question = args.get("question", user_message)
                        yield _thinking(f"Querying: {question}")
                        yield _tool_event(question)
                        result = run_analyst(question, schemas)
                        if result.get("error"):
                            yield _thinking(f"Query error: {result['error'][:80]}")
                            messages.append({
                                "role": "user",
                                "content": f"[Data query failed: {result['error']}]",
                            })
                        else:
                            n = len(result["rows"])
                            yield _thinking(f"Got {n} row{'s' if n != 1 else ''} — building answer…")
                            messages.append({
                                "role": "assistant",
                                "content": f"I queried the data for: {question}",
                            })
                            messages.append({
                                "role": "user",
                                "content": (
                                    f"[Query results for '{question}':\n"
                                    f"{json.dumps({'sql': result['sql'], 'rows': result['rows'][:50]}, indent=2)}]"
                                ),
                            })
                            ran_any_tool = True
                else:
                    log.warning("Tool-use call failed with no parseable Hermes call (%s)", e)
                break

            choice = response.choices[0]

            if choice.finish_reason != "tool_calls" or not choice.message.tool_calls:
                direct = (choice.message.content or "").strip()
                # Check if model embedded a function call in content (finish_reason=stop).
                # This happens when llama-3.3 uses the Hermes <function/name>{} format.
                in_content_call = _parse_hermes_call(direct)
                if direct and in_content_call and not hermes_fallback_done:
                    hermes_fallback_done = True
                    func_name, args = in_content_call
                    if func_name == "run_sql_query":
                        question = args.get("question", user_message)
                        yield _thinking(f"Querying: {question}")
                        yield _tool_event(question)
                        result = run_analyst(question, schemas)
                        if result.get("error"):
                            yield _thinking(f"Query error: {result['error'][:80]}")
                            messages.append({
                                "role": "user",
                                "content": f"[Data query failed: {result['error']}]",
                            })
                        else:
                            n = len(result["rows"])
                            yield _thinking(f"Got {n} row{'s' if n != 1 else ''} — building answer…")
                            messages.append({
                                "role": "assistant",
                                "content": f"I queried the data for: {question}",
                            })
                            messages.append({
                                "role": "user",
                                "content": (
                                    f"[Query results for '{question}':\n"
                                    f"{json.dumps({'sql': result['sql'], 'rows': result['rows'][:50]}, indent=2)}]"
                                ),
                            })
                            ran_any_tool = True
                    continue  # loop again for Phase-1 final answer with results in context

                # Detect when model writes SQL code blocks instead of calling the tool.
                # Some models (e.g. llama-4-scout) propose SQL as prose rather than tool_calls.
                # Execute the user question via the analyst and inject results so Phase 2 can answer.
                _sql_in_direct = (
                    direct
                    and not hermes_fallback_done
                    and not ran_any_tool
                    and ("```sql" in direct.lower() or re.search(r"(?i)\bSELECT\b.*\bFROM\b", direct))
                )
                if _sql_in_direct:
                    hermes_fallback_done = True
                    yield _thinking(f"Querying: {user_message}")
                    yield _tool_event(user_message)
                    result = run_analyst(user_message, schemas)
                    if result.get("error"):
                        yield _thinking(f"Query error: {result['error'][:80]}")
                        messages.append({"role": "assistant", "content": direct})
                        messages.append({
                            "role": "user",
                            "content": f"[Data query failed: {result['error']}. Please answer from available KPIs.]",
                        })
                    else:
                        n = len(result["rows"])
                        yield _thinking(f"Got {n} row{'s' if n != 1 else ''} — building answer…")
                        messages.append({"role": "assistant", "content": direct})
                        messages.append({
                            "role": "user",
                            "content": (
                                f"[Query results:\n"
                                f"{json.dumps({'sql': result['sql'], 'rows': result['rows'][:50]}, indent=2)}]"
                                "\nPlease give a direct answer with the exact numbers from the results above."
                            ),
                        })
                        ran_any_tool = True
                    continue

                # Genuine direct answer — stream it.
                if direct:
                    answered = True
                    yield _thinking("Answer found — streaming response…")
                    for i in range(0, len(direct), 8):
                        chunk = direct[i : i + 8]
                        full_text += chunk
                        yield _text(chunk)
                break

            # Model wants to call a tool — execute it.
            ran_any_tool = True
            tool_call_defs = []
            tool_result_msgs = []

            for tc in choice.message.tool_calls:
                try:
                    question = json.loads(tc.function.arguments).get("question", "")
                except Exception:
                    question = tc.function.arguments

                yield _thinking(f"Querying: {question}")
                yield _tool_event(question)

                result = run_analyst(question, schemas)

                if result.get("error"):
                    yield _thinking(f"Query error: {result['error'][:80]}")
                    content = f"Error: {result['error']}"
                else:
                    n = len(result["rows"])
                    yield _thinking(f"Got {n} row{'s' if n != 1 else ''} — building answer…")
                    content = json.dumps({"sql": result["sql"], "rows": result["rows"][:50]})

                tool_call_defs.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                })
                tool_result_msgs.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": content,
                })

            messages.append({
                "role": "assistant",
                "content": choice.message.content,
                "tool_calls": tool_call_defs,
            })
            messages.extend(tool_result_msgs)

        # ── Phase 2: stream final answer once tool results are in context ──────
        if ran_any_tool and not answered:
            yield _thinking("Writing final response…")
            stream = client.chat.completions.create(
                model=MODEL,
                max_tokens=1024,
                messages=[system_msg] + messages,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta
                if delta.content:
                    full_text += delta.content
                    yield _text(delta.content)

    except AuthenticationError:
        yield _text("⚠️ Invalid Groq API key. Check GROQ_API_KEY in .env.")
    except RateLimitError as e:
        # Extract wait time hint from the error body if available
        err_str = str(e)
        import re as _re
        wait_m = _re.search(r"try again in (\d+m[\d.]+s)", err_str)
        wait_hint = f" Try again in {wait_m.group(1)}." if wait_m else ""
        yield _text(f"⚠️ Groq rate limit reached (daily token quota exceeded).{wait_hint}")
    except Exception as e:
        log.exception("Chat agent error")
        yield _sse({"type": "error", "text": str(e)})

    yield _sse({"type": "done", "full_text": full_text})
    yield "data: [DONE]\n\n"
