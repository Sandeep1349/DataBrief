import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getDataset, manualCleanDataset, cleanDataset, revertDataset } from "../api/datasets";
import { getRows } from "../api/analytics";
import type { Dataset, DataRow, CleanRule, ColumnSchema } from "../types";

type RuleType =
  | "replace" | "delete_where" | "fill_null" | "trim_whitespace"
  | "normalize_spaces" | "to_uppercase" | "to_lowercase" | "remove_chars"
  | "regex_replace" | "round_numeric" | "clamp_range" | "drop_column" | "remove_duplicates";

type Operator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "contains" | "is_null";

interface PendingRule {
  id: string; type: RuleType; column: string;
  findValue: string; replaceValue: string; operator: Operator; value: string; fillValue: string;
}

function makeId() { return Math.random().toString(36).slice(2); }

function typeShort(t: string) {
  if (t.includes("DateTime")) return "DATE";
  if (t.includes("Float")) return "NUM";
  if (t.includes("Int") || t.includes("UInt")) return "INT";
  if (t === "String") return "STR";
  return "?";
}
function typeLabel(t: string) {
  if (t.includes("DateTime")) return "DateTime";
  if (t === "Float64") return "Decimal";
  if (t.includes("Int") || t.includes("UInt")) return "Integer";
  if (t === "String") return "Text";
  return t;
}

function ruleDesc(r: PendingRule): string {
  switch (r.type) {
    case "fill_null":         return `Fill nulls → "${r.fillValue}"`;
    case "replace":           return `"${r.findValue}" → "${r.replaceValue}"`;
    case "trim_whitespace":   return "Trim whitespace";
    case "normalize_spaces":  return "Normalize spaces";
    case "to_uppercase":      return "Convert to UPPERCASE";
    case "to_lowercase":      return "Convert to lowercase";
    case "regex_replace":     return `Regex /${r.findValue}/ → "${r.replaceValue}"`;
    case "remove_chars": {
      const l: Record<string, string> = { special: "Remove special chars", digits: "Remove digits", spaces: "Remove spaces", non_alpha: "Remove non-alpha", non_alphanumeric: "Keep letters+digits only", custom: `Remove "${r.findValue}"` };
      return l[r.value] ?? "Remove characters";
    }
    case "round_numeric":     return `Round to ${r.value} decimal${r.value === "1" ? "" : "s"}`;
    case "clamp_range":       return `Clamp [${r.findValue}, ${r.replaceValue}]`;
    case "delete_where": {
      const op: Record<string, string> = { eq: "=", neq: "≠", gt: ">", lt: "<", gte: "≥", lte: "≤", contains: "contains", is_null: "is null" };
      return `Delete where ${op[r.operator] ?? r.operator}${r.operator !== "is_null" ? ` "${r.value}"` : ""}`;
    }
    case "remove_duplicates": return "Remove duplicate rows";
    case "drop_column":       return "Drop this column";
    default: return r.type;
  }
}

// Apply a single cleaning rule to rows in memory for live preview
function applyRuleLocally(rows: DataRow[], rule: PendingRule): DataRow[] {
  const col = rule.column;
  switch (rule.type) {
    case "trim_whitespace":
      return rows.map(r => ({ ...r, [col]: typeof r[col] === "string" ? (r[col] as string).trim() : r[col] }));
    case "normalize_spaces":
      return rows.map(r => ({ ...r, [col]: typeof r[col] === "string" ? (r[col] as string).replace(/\s+/g, " ").trim() : r[col] }));
    case "to_uppercase":
      return rows.map(r => ({ ...r, [col]: typeof r[col] === "string" ? (r[col] as string).toUpperCase() : r[col] }));
    case "to_lowercase":
      return rows.map(r => ({ ...r, [col]: typeof r[col] === "string" ? (r[col] as string).toLowerCase() : r[col] }));
    case "fill_null":
      return rows.map(r => { const v = r[col]; return { ...r, [col]: (v === null || v === undefined || v === "") ? rule.fillValue : v }; });
    case "replace":
      return rows.map(r => ({ ...r, [col]: r[col] !== null && String(r[col]) === rule.findValue ? rule.replaceValue : r[col] }));
    case "regex_replace":
      return rows.map(r => {
        if (typeof r[col] !== "string") return r;
        try { return { ...r, [col]: (r[col] as string).replace(new RegExp(rule.findValue, "g"), rule.replaceValue) }; }
        catch { return r; }
      });
    case "remove_chars": {
      const v = rule.value;
      return rows.map(r => {
        if (typeof r[col] !== "string") return r;
        const s = r[col] as string;
        let out = s;
        if (v === "special")               out = s.replace(/[^a-zA-Z0-9\s]/g, "");
        else if (v === "digits")           out = s.replace(/\d/g, "");
        else if (v === "spaces")           out = s.replace(/\s/g, "");
        else if (v === "non_alpha")        out = s.replace(/[^a-zA-Z]/g, "");
        else if (v === "non_alphanumeric") out = s.replace(/[^a-zA-Z0-9]/g, "");
        else if (v === "custom" && rule.findValue) {
          const escaped = rule.findValue.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
          out = s.replace(new RegExp(`[${escaped}]`, "g"), "");
        }
        return { ...r, [col]: out };
      });
    }
    case "round_numeric": {
      const dp = parseInt(rule.value) || 0;
      return rows.map(r => {
        const v = r[col];
        if (v === null || v === undefined) return r;
        const n = typeof v === "number" ? v : parseFloat(String(v));
        if (isNaN(n)) return r;
        return { ...r, [col]: parseFloat(n.toFixed(dp)) };
      });
    }
    case "clamp_range": {
      const mn = parseFloat(rule.findValue), mx = parseFloat(rule.replaceValue);
      return rows.map(r => {
        const v = r[col];
        if (v === null || v === undefined) return r;
        const n = typeof v === "number" ? v : parseFloat(String(v));
        if (isNaN(n)) return r;
        return { ...r, [col]: Math.min(Math.max(n, mn), mx) };
      });
    }
    case "delete_where":
      return rows.filter(r => {
        const v = r[col];
        const s = v === null || v === undefined ? "" : String(v);
        const cv = rule.value;
        switch (rule.operator) {
          case "is_null":  return !(v === null || v === undefined || v === "");
          case "eq":       return s !== cv;
          case "neq":      return s === cv;
          case "gt":       return !(parseFloat(s) > parseFloat(cv));
          case "lt":       return !(parseFloat(s) < parseFloat(cv));
          case "gte":      return !(parseFloat(s) >= parseFloat(cv));
          case "lte":      return !(parseFloat(s) <= parseFloat(cv));
          case "contains": return !s.includes(cv);
          default: return true;
        }
      });
    case "remove_duplicates": {
      const seen = new Set<string>();
      return rows.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    case "drop_column":
      return rows.map(r => { const out = { ...r }; delete out[col]; return out; });
    default:
      return rows;
  }
}

const PAGE_SIZE = 100;
const inp = "w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 placeholder:text-slate-300 transition-colors";

// ─── Action button ─────────────────────────────────────────────────────────────
function Btn({ label, icon, active, variant = "sky", onClick }: {
  label: string; icon: React.ReactNode; active: boolean;
  variant?: "sky" | "violet" | "emerald" | "amber" | "red"; onClick: () => void;
}) {
  const on: Record<string, string> = {
    sky: "bg-sky-500 text-white border-sky-500 shadow-sm",
    violet: "bg-violet-500 text-white border-violet-500 shadow-sm",
    emerald: "bg-emerald-500 text-white border-emerald-500 shadow-sm",
    amber: "bg-amber-500 text-white border-amber-500 shadow-sm",
    red: "bg-red-500 text-white border-red-500 shadow-sm",
  };
  const off: Record<string, string> = {
    sky: "bg-white text-slate-600 border-slate-200 hover:border-sky-300 hover:text-sky-600 hover:bg-sky-50/60",
    violet: "bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50/60",
    emerald: "bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50/60",
    amber: "bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50/60",
    red: "bg-white text-slate-600 border-slate-200 hover:border-red-300 hover:text-red-600 hover:bg-red-50/60",
  };
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${active ? on[variant] : off[variant]}`}>
      <span className="w-4 h-4 shrink-0 opacity-80">{icon}</span>
      {label}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────
const I = {
  trim:   <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>,
  norm:   <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 000 2h14a1 1 0 000-2H3zm2 4a1 1 0 000 2h10a1 1 0 000-2H5zm-2 4a1 1 0 000 2h14a1 1 0 000-2H3z" /></svg>,
  upper:  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>,
  lower:  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" /></svg>,
  chars:  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>,
  regex:  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>,
  round:  <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" /></svg>,
  clamp:  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0-4a1 1 0 000 2h2a1 1 0 000-2H3zm12 0a1 1 0 100 2h2a1 1 0 100-2h-2zM3 14a1 1 0 100 2h2a1 1 0 100-2H3zm12 0a1 1 0 100 2h2a1 1 0 100-2h-2z" clipRule="evenodd" /></svg>,
  fill:   <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>,
  swap:   <svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" /></svg>,
  del:    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>,
  dedup:  <svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 3a1 1 0 000 2h6a1 1 0 000-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zm-2 4a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" /></svg>,
  drop:   <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4a3 3 0 00-3 3v6a3 3 0 003 3h10a3 3 0 003-3V7a3 3 0 00-3-3H5zm-1 9v-1h5v2H5a1 1 0 01-1-1zm7 1h4a1 1 0 001-1v-1h-5v2zm0-4h5V8h-5v2zM9 8H4v2h5V8z" clipRule="evenodd" /></svg>,
  search: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>,
  col:    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z" clipRule="evenodd" /></svg>,
  back:   <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>,
  x:      <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>,
  check:  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>,
  revert: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>,
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function DataCleaner() {
  const { id } = useParams<{ id: string }>();

  const [dataset, setDataset]         = useState<Dataset | null>(null);
  const [schema, setSchema]           = useState<ColumnSchema[]>([]);
  const [baseRows, setBaseRows]       = useState<DataRow[]>([]);
  const [page, setPage]               = useState(1);
  const [hasMore, setHasMore]         = useState(true);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [rules, setRules]             = useState<PendingRule[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNullsOnly, setShowNullsOnly] = useState(false);

  const [actionType, setActionType]         = useState<RuleType | null>(null);
  const [fillValue, setFillValue]           = useState("");
  const [findValue, setFindValue]           = useState("");
  const [replaceValue, setReplaceValue]     = useState("");
  const [operator, setOperator]             = useState<Operator>("is_null");
  const [conditionValue, setConditionValue] = useState("");
  const [roundDecimals, setRoundDecimals]   = useState("2");
  const [clampMin, setClampMin]             = useState("");
  const [clampMax, setClampMax]             = useState("");
  const [removeCharsVariant, setRemoveCharsVariant] = useState("special");
  const [customChars, setCustomChars]       = useState("");
  const [confirmType, setConfirmType]       = useState<RuleType | null>(null);

  const [applying, setApplying]       = useState(false);
  const [applyError, setApplyError]   = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [reverting, setReverting]     = useState(false);
  const [revertError, setRevertError] = useState("");
  const [revertSuccess, setRevertSuccess] = useState(false);
  const [aiCleaning, setAiCleaning]   = useState(false);
  const [aiError, setAiError]         = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const [ds, initial] = await Promise.all([getDataset(id), getRows(id, 1, PAGE_SIZE)]);
        setDataset(ds);
        setSchema(JSON.parse(ds.column_schema || "[]"));
        setBaseRows(initial);
        setHasMore(initial.length === PAGE_SIZE);
      } finally { setLoading(false); }
    })();
  }, [id]);

  const loadMore = useCallback(async () => {
    if (!id || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    const newRows = await getRows(id, next, PAGE_SIZE);
    setBaseRows(prev => [...prev, ...newRows]);
    setPage(next);
    setHasMore(newRows.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [id, page, loadingMore, hasMore]);

  // Replay all rules on base rows → live preview
  const previewRows = useMemo(() => {
    return rules.reduce((acc, rule) => applyRuleLocally(acc, rule), baseRows);
  }, [baseRows, rules]);

  // Schema with dropped columns removed
  const visibleSchema = useMemo(() => {
    return rules.reduce((sch, rule) =>
      rule.type === "drop_column" ? sch.filter(c => c.name !== rule.column) : sch,
      schema
    );
  }, [schema, rules]);

  const nullCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const row of baseRows)
      for (const k of Object.keys(row))
        if (row[k] === null || row[k] === undefined || row[k] === "") c[k] = (c[k] || 0) + 1;
    return c;
  }, [baseRows]);

  const displayedRows = useMemo(() => {
    let r = previewRows;
    const q = searchQuery.trim().toLowerCase();
    if (q) r = r.filter(row => Object.values(row).some(v => v !== null && String(v).toLowerCase().includes(q)));
    if (showNullsOnly && selectedCol)
      r = r.filter(row => { const v = row[selectedCol]; return v === null || v === undefined || v === ""; });
    return r;
  }, [previewRows, searchQuery, showNullsOnly, selectedCol]);

  function selectCol(name: string) {
    setSelectedCol(prev => prev === name ? null : name);
    setActionType(null); setConfirmType(null); setShowNullsOnly(false);
    resetForm();
  }

  function resetForm() {
    setFillValue(""); setFindValue(""); setReplaceValue(""); setConditionValue("");
    setRoundDecimals("2"); setClampMin(""); setClampMax(""); setCustomChars(""); setRemoveCharsVariant("special");
  }

  function pickAction(t: RuleType) {
    setActionType(prev => prev === t ? null : t);
    setConfirmType(null); resetForm();
  }

  function addRule(override?: Partial<PendingRule>) {
    if (!selectedCol) return;
    setRules(prev => [...prev, {
      id: makeId(), type: actionType!, column: selectedCol,
      findValue, replaceValue, operator, value: conditionValue, fillValue,
      ...override,
    }]);
    setActionType(null); resetForm();
  }

  function addNoFormRule(type: RuleType) {
    if (!selectedCol) return;
    setRules(prev => [...prev, { id: makeId(), type, column: selectedCol, findValue: "", replaceValue: "", operator: "eq", value: "", fillValue: "" }]);
    setActionType(null); setConfirmType(null);
  }

  async function pollUntilReady(): Promise<void> {
    if (!id) return;
    while (true) {
      await new Promise(r => setTimeout(r, 1500));
      const ds = await getDataset(id);
      if (ds.status === "ready" || ds.status === "failed") return;
    }
  }

  async function reloadData() {
    if (!id) return;
    const [ds, freshRows] = await Promise.all([getDataset(id), getRows(id, 1, PAGE_SIZE)]);
    setDataset(ds);
    setSchema(JSON.parse(ds.column_schema || "[]"));
    setBaseRows(freshRows);
    setHasMore(freshRows.length === PAGE_SIZE);
    setPage(1);
  }

  async function handleAiClean() {
    if (!id) return;
    setAiCleaning(true);
    setAiError("");
    try {
      await cleanDataset(id);
      await pollUntilReady();
      await reloadData();
      setRules([]);
      setSelectedCol(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "AI cleaning failed");
    } finally {
      setAiCleaning(false);
    }
  }

  async function applyChanges() {
    if (!id || !rules.length) return;
    const cleanRules: CleanRule[] = rules.map(r => ({
      type: r.type, column: r.column,
      find_value: r.findValue || undefined, replace_value: r.replaceValue || undefined,
      operator: r.operator || undefined, value: r.value || undefined, fill_value: r.fillValue || undefined,
    }));
    setApplying(true); setApplyError("");
    try {
      await manualCleanDataset(id, cleanRules);
      await pollUntilReady();
      await reloadData();
      setRules([]);
      setSelectedCol(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : "Failed to apply changes");
    } finally {
      setApplying(false);
    }
  }

  async function revertToRaw() {
    if (!id) return;
    setReverting(true); setRevertError("");
    setRules([]);
    try {
      await revertDataset(id);
      await pollUntilReady();
      await reloadData();
      setSelectedCol(null);
      setRevertSuccess(true);
      setTimeout(() => setRevertSuccess(false), 3000);
    } catch (e: unknown) {
      setRevertError(e instanceof Error ? e.message : "Revert failed");
    } finally {
      setReverting(false);
    }
  }

  const colSchema = visibleSchema.find(c => c.name === selectedCol);
  const colType   = colSchema?.type ?? "String";
  const isString  = colType === "String";
  const isNumeric = colType === "Float64" || colType.includes("Int");
  const colNulls  = selectedCol ? (nullCounts[selectedCol] ?? 0) : 0;

  // ─── Screens ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-slate-50">
      <div className="text-center">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 mx-auto mb-3 animate-pulse" />
        <p className="text-slate-400 text-sm">Loading data…</p>
      </div>
    </div>
  );

  if (!dataset) return (
    <div className="flex items-center justify-center h-full bg-slate-50">
      <p className="text-slate-500 text-sm">Dataset not found</p>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">

      {/* ── Full-screen overlay while saving/reverting ───────────────────── */}
      {(applying || reverting) && (
        <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin block" style={{ borderWidth: "3px" }} />
            </div>
            <p className="font-semibold text-slate-700 text-lg">
              {applying ? "Saving changes…" : "Reverting to original…"}
            </p>
            <p className="text-sm text-slate-400 mt-1">Applying to database, please wait</p>
          </div>
        </div>
      )}

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-4 shadow-sm z-10">
        <Link to="/databases" className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 transition-colors shrink-0">
          <span className="w-4 h-4">{I.back}</span>
          <span className="text-sm font-medium">Databases</span>
        </Link>
        <div className="w-px h-5 bg-slate-200 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{dataset.name}</p>
          <p className="text-xs text-slate-400">{previewRows.length.toLocaleString()} rows · {visibleSchema.length} columns</p>
        </div>
        <div className="flex-1" />

        {/* Inline status messages */}
        {applyError && <p className="text-xs text-red-500 shrink-0">{applyError}</p>}
        {revertError && <p className="text-xs text-red-500 shrink-0">{revertError}</p>}
        {saveSuccess && (
          <span className="shrink-0 flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 font-semibold">
            <span className="w-3.5 h-3.5">{I.check}</span> Changes saved
          </span>
        )}
        {revertSuccess && (
          <span className="shrink-0 flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 font-semibold">
            <span className="w-3.5 h-3.5">{I.revert}</span> Reverted to original
          </span>
        )}
        {rules.length > 0 && !saveSuccess && !revertSuccess && (
          <span className="shrink-0 text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2.5 py-1 font-semibold">
            {rules.length} unsaved change{rules.length > 1 ? "s" : ""}
          </span>
        )}

        <button
          onClick={revertToRaw}
          disabled={reverting || applying}
          className="shrink-0 flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium px-4 py-2 rounded-xl transition-all"
        >
          <span className="w-4 h-4">{I.revert}</span>
          Revert to Raw
        </button>
        <button
          onClick={applyChanges}
          disabled={rules.length === 0 || applying || reverting}
          className="shrink-0 flex items-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-sm"
        >
          {rules.length > 0 ? `Save ${rules.length} Change${rules.length > 1 ? "s" : ""}` : "Save Changes"}
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* ── Left: Column list ───────────────────────────────────────── */}
        <div className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Columns ({visibleSchema.length})</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Click to select &amp; clean</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visibleSchema.map(col => {
              const n     = nullCounts[col.name] ?? 0;
              const pct   = baseRows.length > 0 ? n / baseRows.length : 0;
              const dot   = n === 0 ? "bg-emerald-400" : pct > 0.1 ? "bg-red-400" : "bg-amber-400";
              const active = selectedCol === col.name;
              return (
                <button
                  key={col.name}
                  onClick={() => selectCol(col.name)}
                  className={`w-full px-4 py-3 flex items-center gap-3 text-left border-l-2 transition-all ${
                    active ? "border-l-sky-500 bg-sky-50" : "border-l-transparent hover:bg-slate-50"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-sm font-medium truncate ${active ? "text-sky-700" : "text-slate-700"}`}>{col.name}</span>
                      <span className={`text-[9px] font-bold rounded px-1 py-0.5 shrink-0 ${active ? "bg-sky-200 text-sky-600" : "bg-slate-100 text-slate-400"}`}>{typeShort(col.type)}</span>
                    </div>
                    {n > 0
                      ? <p className="text-[11px] text-amber-500 font-medium">{n.toLocaleString()} nulls</p>
                      : <p className="text-[11px] text-emerald-600">No nulls</p>}
                  </div>
                  {active && <span className="w-4 h-4 text-sky-400 shrink-0">{I.back}</span>}
                </button>
              );
            })}
          </div>

          {/* Applied changes list pinned at bottom */}
          {rules.length > 0 && (
            <div className="shrink-0 border-t border-slate-200 bg-white flex flex-col" style={{ maxHeight: "220px" }}>
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600">Changes ({rules.length})</p>
                <button onClick={() => setRules([])} className="text-[11px] text-red-400 hover:text-red-600 transition-colors font-medium">Undo all</button>
              </div>
              <div className="overflow-y-auto px-3 py-2 space-y-1.5">
                {rules.map((r, i) => (
                  <div key={r.id} className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-xs ${r.type === "drop_column" ? "bg-red-50 border-red-200" : "bg-sky-50 border-sky-100"}`}>
                    <span className="text-slate-400 font-semibold shrink-0 tabular-nums">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-700 truncate">{r.column}</p>
                      <p className="text-slate-400 text-[11px]">{ruleDesc(r)}</p>
                    </div>
                    <button onClick={() => setRules(prev => prev.filter(x => x.id !== r.id))} className="text-slate-300 hover:text-red-400 transition-colors shrink-0 mt-0.5">
                      <span className="w-3.5 h-3.5 block">{I.x}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Action panel + Data table ────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* ── Action panel ────────────────────────────────────────── */}
          {selectedCol ? (
            <div className="shrink-0 bg-white border-b border-slate-200 overflow-y-auto" style={{ maxHeight: "300px" }}>

              {/* Column header bar */}
              <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-3.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
                  <span className="w-4 h-4 text-sky-600">{I.col}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 text-sm">{selectedCol}</span>
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{typeLabel(colType)}</span>
                    {colNulls > 0 && (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        {colNulls.toLocaleString()} nulls in sample
                      </span>
                    )}
                    {colNulls === 0 && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                        No nulls
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">Pick an action — changes appear in the table instantly</p>
                </div>
                <button onClick={() => selectCol(selectedCol)} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0">
                  <span className="w-4 h-4 block">{I.x}</span>
                </button>
              </div>

              {/* Action buttons */}
              <div className="px-5 py-4 space-y-5">

                {isString && (
                  <Group title="Text">
                    <Btn label="Trim whitespace"   icon={I.trim}  active={actionType === "trim_whitespace"}   variant="sky"    onClick={() => pickAction("trim_whitespace")} />
                    <Btn label="Normalize spaces"  icon={I.norm}  active={actionType === "normalize_spaces"}  variant="sky"    onClick={() => pickAction("normalize_spaces")} />
                    <Btn label="UPPERCASE"         icon={I.upper} active={actionType === "to_uppercase"}      variant="sky"    onClick={() => pickAction("to_uppercase")} />
                    <Btn label="lowercase"         icon={I.lower} active={actionType === "to_lowercase"}      variant="sky"    onClick={() => pickAction("to_lowercase")} />
                    <Btn label="Remove characters" icon={I.chars} active={actionType === "remove_chars"}      variant="violet" onClick={() => pickAction("remove_chars")} />
                    <Btn label="Regex replace"     icon={I.regex} active={actionType === "regex_replace"}     variant="violet" onClick={() => pickAction("regex_replace")} />
                  </Group>
                )}

                {isNumeric && (
                  <Group title="Numbers">
                    <Btn label="Round numbers" icon={I.round} active={actionType === "round_numeric"} variant="sky" onClick={() => pickAction("round_numeric")} />
                    <Btn label="Clamp range"   icon={I.clamp} active={actionType === "clamp_range"}   variant="sky" onClick={() => pickAction("clamp_range")} />
                  </Group>
                )}

                <Group title="Values">
                  <Btn label="Fill missing values" icon={I.fill} active={actionType === "fill_null"} variant="emerald" onClick={() => pickAction("fill_null")} />
                  <Btn label="Find &amp; replace"  icon={I.swap} active={actionType === "replace"}    variant="emerald" onClick={() => pickAction("replace")} />
                </Group>

                <Group title="Rows &amp; Column">
                  <Btn label="Delete rows where…" icon={I.del}   active={actionType === "delete_where"}       variant="amber" onClick={() => pickAction("delete_where")} />
                  <Btn label="Remove duplicates"  icon={I.dedup} active={confirmType === "remove_duplicates"} variant="amber" onClick={() => { setConfirmType(p => p === "remove_duplicates" ? null : "remove_duplicates"); setActionType(null); }} />
                  <Btn label="Drop column"        icon={I.drop}  active={confirmType === "drop_column"}       variant="red"   onClick={() => { setConfirmType(p => p === "drop_column" ? null : "drop_column"); setActionType(null); }} />
                </Group>
              </div>

              {/* ── Inline form ────────────────────────────────────────── */}
              {(actionType || confirmType) && (
                <div className="mx-5 mb-5 bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 py-3 bg-slate-100/60 border-b border-slate-200 flex items-center gap-2">
                    <div className="w-1.5 h-4 rounded-full bg-sky-400 shrink-0" />
                    <p className="text-xs font-semibold text-slate-700 capitalize">
                      {actionType ? actionType.replace(/_/g, " ") : confirmType?.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="p-4 space-y-3">

                    {/* ── No-param text ops ── */}
                    {(actionType === "trim_whitespace" || actionType === "normalize_spaces" || actionType === "to_uppercase" || actionType === "to_lowercase") && (
                      <>
                        <p className="text-sm text-slate-600">
                          {actionType === "trim_whitespace"  && <>Remove leading &amp; trailing spaces from every cell in <strong>"{selectedCol}"</strong>.</>}
                          {actionType === "normalize_spaces" && <>Collapse runs of spaces into a single space in <strong>"{selectedCol}"</strong>.</>}
                          {actionType === "to_uppercase"     && <>Convert all text in <strong>"{selectedCol}"</strong> to UPPERCASE.</>}
                          {actionType === "to_lowercase"     && <>Convert all text in <strong>"{selectedCol}"</strong> to lowercase.</>}
                        </p>
                        <button onClick={() => addNoFormRule(actionType)} className="w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Remove characters ── */}
                    {actionType === "remove_chars" && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">What to remove</label>
                          <select value={removeCharsVariant} onChange={e => setRemoveCharsVariant(e.target.value)} className={inp}>
                            <option value="special">Special characters (punctuation, symbols)</option>
                            <option value="digits">Digits (0–9)</option>
                            <option value="spaces">All spaces &amp; whitespace</option>
                            <option value="non_alpha">Non-alphabetic characters</option>
                            <option value="non_alphanumeric">Non-alphanumeric (keep letters+digits)</option>
                            <option value="custom">Custom characters…</option>
                          </select>
                        </div>
                        {removeCharsVariant === "custom" && (
                          <input type="text" value={customChars} onChange={e => setCustomChars(e.target.value)} placeholder='Characters to remove, e.g.  .,;:"' className={inp} autoFocus />
                        )}
                        <button onClick={() => addRule({ value: removeCharsVariant, findValue: removeCharsVariant === "custom" ? customChars : "" })} className="w-full bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Regex replace ── */}
                    {actionType === "regex_replace" && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">Pattern (regex)</label>
                          <input type="text" value={findValue} onChange={e => setFindValue(e.target.value)} placeholder={`e.g.  \\d+  or  [aeiou]`} className={inp} autoFocus />
                          <p className="text-[11px] text-slate-400 mt-1">Uses re2 syntax. Capture groups: \1, \2…</p>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">Replace with</label>
                          <input type="text" value={replaceValue} onChange={e => setReplaceValue(e.target.value)} onKeyDown={e => e.key === "Enter" && findValue && addRule({ findValue, replaceValue })} placeholder="Leave empty to delete matches" className={inp} />
                        </div>
                        <button disabled={!findValue} onClick={() => addRule({ findValue, replaceValue })} className="w-full bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Round ── */}
                    {actionType === "round_numeric" && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">Decimal places</label>
                          <div className="flex items-center gap-3">
                            <input type="number" min={0} max={10} value={roundDecimals} onChange={e => setRoundDecimals(e.target.value)} className={inp + " max-w-[120px]"} autoFocus />
                            <span className="text-sm text-slate-500">decimal places</span>
                          </div>
                        </div>
                        <button onClick={() => addRule({ value: roundDecimals, findValue: "", replaceValue: "" })} className="w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Clamp ── */}
                    {actionType === "clamp_range" && (
                      <>
                        <p className="text-sm text-slate-600">Values outside the range will be clamped to the nearest boundary.</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-slate-600 block mb-1.5">Min value</label>
                            <input type="number" value={clampMin} onChange={e => setClampMin(e.target.value)} placeholder="e.g. 0" className={inp} autoFocus />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-600 block mb-1.5">Max value</label>
                            <input type="number" value={clampMax} onChange={e => setClampMax(e.target.value)} placeholder="e.g. 100" className={inp} />
                          </div>
                        </div>
                        <button disabled={!clampMin || !clampMax} onClick={() => addRule({ findValue: clampMin, replaceValue: clampMax, value: "" })} className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Fill nulls ── */}
                    {actionType === "fill_null" && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">Replace empty / null cells with</label>
                          <input type="text" value={fillValue} onChange={e => setFillValue(e.target.value)} onKeyDown={e => e.key === "Enter" && fillValue && addRule()} placeholder={isNumeric ? "e.g. 0" : "e.g. Unknown"} className={inp} autoFocus />
                        </div>
                        <button disabled={!fillValue} onClick={() => addRule()} className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Find & replace ── */}
                    {actionType === "replace" && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">Find (exact match)</label>
                          <input type="text" value={findValue} onChange={e => setFindValue(e.target.value)} placeholder="Value to find…" className={inp} autoFocus />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">Replace with</label>
                          <input type="text" value={replaceValue} onChange={e => setReplaceValue(e.target.value)} onKeyDown={e => e.key === "Enter" && findValue && addRule()} placeholder="New value…" className={inp} />
                        </div>
                        <button disabled={!findValue} onClick={() => addRule()} className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Delete where ── */}
                    {actionType === "delete_where" && (
                      <>
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1.5">Delete rows where <strong className="text-slate-800">"{selectedCol}"</strong> is…</label>
                          <select value={operator} onChange={e => setOperator(e.target.value as Operator)} className={inp}>
                            <option value="is_null">empty / null</option>
                            <option value="eq">= equals</option>
                            <option value="neq">≠ not equals</option>
                            <option value="gt">&gt; greater than</option>
                            <option value="lt">&lt; less than</option>
                            <option value="gte">≥ greater or equal</option>
                            <option value="lte">≤ less or equal</option>
                            <option value="contains">contains text</option>
                          </select>
                        </div>
                        {operator !== "is_null" && (
                          <div>
                            <label className="text-xs font-medium text-slate-600 block mb-1.5">Value</label>
                            <input type="text" value={conditionValue} onChange={e => setConditionValue(e.target.value)} onKeyDown={e => e.key === "Enter" && addRule()} placeholder="Value to match…" className={inp} autoFocus />
                          </div>
                        )}
                        <button onClick={() => addRule()} className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Remove duplicates ── */}
                    {confirmType === "remove_duplicates" && (
                      <>
                        <p className="text-sm text-slate-600">Remove all <strong>duplicate rows</strong> from the entire dataset (keeps the first occurrence of each).</p>
                        <button onClick={() => addNoFormRule("remove_duplicates")} className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Apply
                        </button>
                      </>
                    )}

                    {/* ── Drop column ── */}
                    {confirmType === "drop_column" && (
                      <>
                        <p className="text-sm text-red-600">Permanently remove the column <strong>"{selectedCol}"</strong> and all its data. A backup is saved so you can Revert at any time.</p>
                        <button onClick={() => addNoFormRule("drop_column")} className="w-full bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                          Confirm: Drop "{selectedCol}"
                        </button>
                      </>
                    )}

                  </div>
                </div>
              )}
            </div>

          ) : (
            /* ── No column selected: AI banner + prompt ───────────────── */
            <div className="shrink-0 bg-white border-b border-slate-200">

              {/* AI Clean banner */}
              <div className="mx-5 mt-5 mb-4 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm shadow-violet-200">
                    <svg viewBox="0 0 20 20" fill="white" className="w-5 h-5">
                      <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-violet-900">AI Auto-Clean</p>
                    <p className="text-xs text-violet-600 mt-0.5">Automatically detect and fix nulls, formatting issues, duplicates and outliers</p>
                    {aiError && <p className="text-xs text-red-500 mt-1">{aiError}</p>}
                  </div>
                  <button
                    onClick={handleAiClean}
                    disabled={aiCleaning}
                    className="shrink-0 flex items-center gap-2 bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-sm whitespace-nowrap"
                  >
                    {aiCleaning ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Running…
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                        </svg>
                        Run AI Clean
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 px-5 pb-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">or clean manually</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Column prompt */}
              <div className="px-6 pb-5 flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <span className="w-4 h-4 text-slate-400">{I.col}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">Select a column to start cleaning</p>
                  <p className="text-xs text-slate-400 mt-0.5">Changes appear live in the table below. Hit "Save Changes" to persist.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Data table ──────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0">

            {/* Toolbar */}
            <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center gap-3">
              <div className="relative">
                <span className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">{I.search}</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search all rows…"
                  className="pl-8 pr-7 py-1.5 text-xs border border-slate-200 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 placeholder:text-slate-300"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                    <span className="w-3.5 h-3.5 block">{I.x}</span>
                  </button>
                )}
              </div>

              {selectedCol && colNulls > 0 && (
                <button
                  onClick={() => setShowNullsOnly(!showNullsOnly)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${showNullsOnly ? "bg-amber-500 text-white border-amber-500" : "bg-white text-amber-600 border-amber-200 hover:bg-amber-50"}`}
                >
                  {showNullsOnly ? "← Show all rows" : `Show ${colNulls} null rows`}
                </button>
              )}

              <div className="flex-1" />

              {rules.length > 0 && (
                <span className="text-[11px] text-sky-600 font-medium bg-sky-50 border border-sky-100 rounded-full px-2.5 py-1">
                  Live preview · {rules.length} change{rules.length > 1 ? "s" : ""}
                </span>
              )}

              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-100 border border-amber-300 inline-block" />null cell
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-sky-100 border border-sky-200 inline-block" />selected column
                </span>
              </div>

              <div className="w-px h-4 bg-slate-200" />
              <span className="text-xs text-slate-400 whitespace-nowrap">
                <span className="font-semibold text-slate-600">{displayedRows.length.toLocaleString()}</span>
                {" / "}
                <span className="font-semibold text-slate-600">{previewRows.length.toLocaleString()}</span>
                {" rows"}
                {hasMore && <span className="text-slate-300 ml-1">(partial)</span>}
              </span>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto bg-white">
              <table className="text-xs border-collapse w-max min-w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="sticky left-0 z-20 px-3 py-2.5 text-left text-slate-400 font-medium text-[11px] bg-slate-100 border-b border-r border-slate-200 w-10 select-none">#</th>
                    {visibleSchema.map(col => {
                      const sel   = selectedCol === col.name;
                      const hasN  = (nullCounts[col.name] ?? 0) > 0;
                      return (
                        <th
                          key={col.name}
                          onClick={() => selectCol(col.name)}
                          title={`${col.name} · ${typeLabel(col.type)}${hasN ? ` · ${nullCounts[col.name]} nulls` : ""}`}
                          className={`text-left px-3 py-2.5 font-semibold whitespace-nowrap cursor-pointer border-b select-none transition-colors ${sel ? "bg-sky-100 text-sky-700 border-sky-200" : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasN ? "bg-amber-400" : "bg-emerald-400"}`} />
                            {col.name}
                            <span className={`text-[9px] font-bold rounded px-1 py-0.5 ${sel ? "bg-sky-200 text-sky-600" : "bg-slate-200 text-slate-400"}`}>{typeShort(col.type)}</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleSchema.length + 1} className="px-6 py-16 text-center text-slate-400 text-sm">
                        {searchQuery ? `No rows match "${searchQuery}"` : "No rows to display"}
                      </td>
                    </tr>
                  ) : displayedRows.map((row, i) => (
                    <tr key={i} className="group border-b border-slate-100 hover:bg-blue-50/30 transition-colors">
                      <td className="sticky left-0 z-[5] px-3 py-1.5 text-slate-300 text-[11px] font-mono tabular-nums select-none bg-white group-hover:bg-blue-50/30 border-r border-slate-100 w-10">{i + 1}</td>
                      {visibleSchema.map(col => {
                        const val  = row[col.name];
                        const isNull = val === null || val === undefined || val === "";
                        const sel  = selectedCol === col.name;
                        return (
                          <td key={col.name} className={`px-3 py-1.5 transition-colors max-w-[200px] ${isNull ? (sel ? "bg-amber-100/70" : "bg-amber-50/50") : (sel ? "bg-sky-50/60" : "")}`}>
                            {isNull
                              ? <span className="text-amber-400 italic font-medium text-[11px]">null</span>
                              : <span className="text-slate-600 truncate block" title={String(val)}>{String(val)}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              {hasMore && !searchQuery && !showNullsOnly && (
                <div className="py-5 border-t border-slate-100 text-center">
                  <button onClick={loadMore} disabled={loadingMore} className="flex items-center gap-2 mx-auto text-sm text-sky-600 hover:text-sky-700 font-semibold disabled:opacity-50 transition-colors">
                    {loadingMore && <span className="w-3.5 h-3.5 border-2 border-sky-300 border-t-sky-600 rounded-full animate-spin" />}
                    {loadingMore ? "Loading…" : `Load next ${PAGE_SIZE} rows`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
