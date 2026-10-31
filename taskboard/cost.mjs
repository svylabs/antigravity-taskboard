/**
 * Cost tracking module for antigravity-taskboard.
 *
 * Tracks, per task, the LLM cost incurred by the agent conversations that worked on it:
 *   - input / cache-read / output tokens (parsed from Antigravity transcripts)
 *   - tool calls made
 *   - files read / written / searched, how many times, file size at access time,
 *     and estimated tokens consumed per file.
 *
 * Data sources:
 *   1. Lifecycle hooks (`hooks.json` -> `cost_hook.mjs`): every PostToolUse event is logged
 *      into `task_file_access` with the file size *at the time of access*, and conversations
 *      are auto-bound to tasks when they reference a task id via tasks.mjs / MCP tools.
 *   2. Explicit binding (`tasks.mjs cost-bind <TASK_ID> --transcript <path>`), for setups
 *      where hooks are not loaded.
 *   3. Transcripts (`transcript.jsonl`): per-step token usage (`input_tokens`,
 *      `cache_read_tokens`, `output_tokens`) and, as a fallback, tool calls/file reads.
 *
 * All data is stored in the project's SQLite DB (.agents/taskboard/tasks.sqlite).
 * This module has no dependency on tasks.mjs so it can be used by the lightweight hook.
 */
import fs from 'fs';
import path from 'path';

export const TASK_ID_REGEX = /\btask-[a-z0-9]{4,}-[a-z0-9]{2,}\b/gi;

// Default pricing (USD per 1M tokens). Override with .agents/taskboard/pricing.json
export const DEFAULT_PRICING = {
  currency: 'USD',
  chars_per_token: 4,
  default: { input: 3.0, cache_read: 0.3, output: 15.0 },
  // Matched case-insensitively as a substring of the model name reported by hooks.
  models: {
    opus: { input: 15.0, cache_read: 1.5, output: 75.0 },
    sonnet: { input: 3.0, cache_read: 0.3, output: 15.0 },
    haiku: { input: 0.8, cache_read: 0.08, output: 4.0 },
    'gemini-3-pro': { input: 2.0, cache_read: 0.2, output: 12.0 },
    'gemini-2.5-pro': { input: 1.25, cache_read: 0.31, output: 10.0 },
    flash: { input: 0.3, cache_read: 0.03, output: 2.5 }
  },
  // Thresholds used to generate optimization hints
  hints: {
    reread_threshold: 3,
    large_file_tokens: 8000,
    cache_ratio_warn: 0.5
  }
};

const READ_TOOLS = /^(view_file|read_file|view_code_item|view_file_outline|read_url_content|open_file|cat_file)$/i;
const WRITE_TOOLS = /^(write_to_file|write_file|edit_file|replace_file_content|multi_replace_file_content|create_file|apply_patch|propose_code)$/i;
const SEARCH_TOOLS = /^(grep_search|grep|codebase_search|search_files|find_by_name|search)$/i;
const LIST_TOOLS = /^(list_dir|list_directory|ls)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|heic|tiff?)$/i;
const PATH_KEYS = ['AbsolutePath', 'Path', 'TargetFile', 'FilePath', 'File', 'file_path', 'path', 'SearchPath', 'SearchDirectory', 'DirectoryPath', 'Directory'];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export function ensureCostSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_cost_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      from_step INTEGER NOT NULL DEFAULT 0,
      transcript_path TEXT,
      model_name TEXT,
      source TEXT DEFAULT 'hook',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_cost_bindings_conv ON task_cost_bindings(conversation_id, from_step);
    CREATE INDEX IF NOT EXISTS idx_cost_bindings_task ON task_cost_bindings(task_id);

    CREATE TABLE IF NOT EXISTS task_file_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      conversation_id TEXT,
      step_idx INTEGER,
      tool_name TEXT NOT NULL,
      access_type TEXT NOT NULL, -- 'read' | 'write' | 'search' | 'list' | 'other'
      file_path TEXT,
      file_size_bytes INTEGER,  -- full file size at the time of access
      bytes_read INTEGER,       -- bytes actually covered by the access (ranged reads)
      lines_read INTEGER,
      est_tokens INTEGER,
      is_error INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_file_access_task ON task_file_access(task_id);
    CREATE INDEX IF NOT EXISTS idx_file_access_conv ON task_file_access(conversation_id, step_idx);

    CREATE TABLE IF NOT EXISTS task_cost_reports (
      task_id TEXT PRIMARY KEY,
      input_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      est_cost_usd REAL DEFAULT 0,
      model_calls INTEGER DEFAULT 0,
      tool_calls INTEGER DEFAULT 0,
      files_read INTEGER DEFAULT 0,
      file_reads INTEGER DEFAULT 0,
      file_read_tokens INTEGER DEFAULT 0,
      report_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
export function loadPricing(dbDir) {
  const pricing = JSON.parse(JSON.stringify(DEFAULT_PRICING));
  try {
    const p = dbDir ? path.join(dbDir, 'pricing.json') : null;
    if (p && fs.existsSync(p)) {
      const custom = JSON.parse(fs.readFileSync(p, 'utf-8'));
      Object.assign(pricing, custom, {
        default: { ...pricing.default, ...(custom.default || {}) },
        models: { ...pricing.models, ...(custom.models || {}) },
        hints: { ...pricing.hints, ...(custom.hints || {}) }
      });
    }
  } catch {}
  return pricing;
}

export function ratesForModel(pricing, modelName) {
  const name = String(modelName || '').toLowerCase();
  if (name) {
    for (const [key, rates] of Object.entries(pricing.models || {})) {
      if (name.includes(key.toLowerCase())) return { ...pricing.default, ...rates, matched: key };
    }
  }
  return { ...pricing.default, matched: 'default' };
}

function priceTokens(rates, { input = 0, cache_read = 0, output = 0 }) {
  return (input * rates.input + cache_read * rates.cache_read + output * rates.output) / 1e6;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function unquote(v) {
  // Transcript args are sometimes double JSON-encoded ("\"/abs/path\"")
  if (typeof v === 'string' && v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  return v;
}

function normArgs(args) {
  const out = {};
  if (!args || typeof args !== 'object') return out;
  for (const [k, v] of Object.entries(args)) out[k] = unquote(v);
  return out;
}

export function classifyTool(toolName) {
  const n = String(toolName || '').replace(/^mcp_[^_]+_/, '');
  if (READ_TOOLS.test(n)) return 'read';
  if (WRITE_TOOLS.test(n)) return 'write';
  if (SEARCH_TOOLS.test(n)) return 'search';
  if (LIST_TOOLS.test(n)) return 'list';
  return 'other';
}

function extractPath(args) {
  for (const k of PATH_KEYS) {
    if (typeof args[k] === 'string' && args[k].trim()) {
      const p = args[k].trim().replace(/^file:\/\//, '').replace(/^~(?=\/)/, process.env.HOME || '~');
      return path.isAbsolute(p) ? path.resolve(p) : p;
    }
  }
  return null;
}

/**
 * Measures a file access: full size at this moment and (for ranged reads) the size
 * of the slice that was read. Returns token estimates using chars_per_token.
 */
export function measureFileAccess(filePath, args, accessType, charsPerToken = 4) {
  const res = { file_size_bytes: null, bytes_read: null, lines_read: null, est_tokens: null };
  if (!filePath) return res;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) {
      res.file_size_bytes = 0;
      return res;
    }
    res.file_size_bytes = st.size;
    let bytes = st.size;
    if (accessType === 'read' && IMAGE_EXT.test(filePath)) {
      // Images are billed by resolution, not bytes; use a flat estimate
      res.bytes_read = st.size;
      res.est_tokens = parseInt(process.env.TASKBOARD_IMAGE_TOKENS || '1600', 10);
      res.is_image = true;
      return res;
    }
    if (accessType === 'read') {
      const start = parseInt(args.StartLine ?? args.start_line ?? args.offset, 10);
      const end = parseInt(args.EndLine ?? args.end_line ?? args.limit, 10);
      const hasRange = Number.isFinite(start) || Number.isFinite(end);
      // Only scan text content for ranged reads of reasonably sized files
      if (hasRange && st.size < 20 * 1024 * 1024) {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        const s = Number.isFinite(start) ? Math.max(1, start) : 1;
        const e = Number.isFinite(end) ? Math.min(lines.length, end) : lines.length;
        const slice = lines.slice(s - 1, e);
        res.lines_read = slice.length;
        bytes = Buffer.byteLength(slice.join('\n'), 'utf-8');
      } else if (st.size < 20 * 1024 * 1024) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          res.lines_read = content.split('\n').length;
        } catch {}
      }
      // Tools usually cap a single read (e.g. 800 lines / ~46KB)
      const cap = parseInt(process.env.TASKBOARD_READ_CAP_BYTES || '46080', 10);
      if (cap > 0) bytes = Math.min(bytes, cap);
    } else if (accessType === 'write') {
      const content = args.CodeContent ?? args.Content ?? args.Replacement ?? args.ReplacementContent;
      if (typeof content === 'string') bytes = Buffer.byteLength(content, 'utf-8');
    } else {
      bytes = 0;
    }
    res.bytes_read = bytes;
    res.est_tokens = Math.ceil(bytes / (charsPerToken || 4));
  } catch {}
  return res;
}

// ---------------------------------------------------------------------------
// Bindings (conversation -> task attribution by step ranges)
// ---------------------------------------------------------------------------
export function getLatestBinding(db, conversationId) {
  return db.prepare(
    'SELECT * FROM task_cost_bindings WHERE conversation_id = ? ORDER BY from_step DESC, id DESC LIMIT 1'
  ).get(conversationId);
}

export function bindConversation(db, { conversationId, taskId, stepIdx = 0, transcriptPath = null, modelName = null, source = 'hook' }) {
  if (!conversationId || !taskId) return null;
  const latest = getLatestBinding(db, conversationId);
  if (latest && latest.task_id === taskId) {
    // Keep transcript path / model fresh
    if ((transcriptPath && !latest.transcript_path) || (modelName && latest.model_name !== modelName)) {
      db.prepare('UPDATE task_cost_bindings SET transcript_path = COALESCE(?, transcript_path), model_name = COALESCE(?, model_name) WHERE id = ?')
        .run(transcriptPath, modelName, latest.id);
    }
    return latest;
  }
  // First binding of a conversation claims everything from the start
  const fromStep = latest ? Math.max(0, Number(stepIdx) || 0) : 0;
  db.prepare(
    'INSERT INTO task_cost_bindings (conversation_id, task_id, from_step, transcript_path, model_name, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, taskId, fromStep, transcriptPath, modelName, source);
  if (!latest) {
    // Attribute file accesses logged before the first binding to this task
    db.prepare('UPDATE task_file_access SET task_id = ? WHERE conversation_id = ? AND task_id IS NULL').run(taskId, conversationId);
  }
  return getLatestBinding(db, conversationId);
}

function taskForStep(bindings, stepIdx) {
  let current = null;
  for (const b of bindings) {
    if (b.from_step <= stepIdx) current = b;
    else break;
  }
  return current ? current.task_id : null;
}

export function getConversationBindings(db, conversationId) {
  return db.prepare('SELECT * FROM task_cost_bindings WHERE conversation_id = ? ORDER BY from_step ASC, id ASC').all(conversationId);
}

function taskExists(db, taskId) {
  try {
    return !!db.prepare('SELECT 1 FROM agent_tasks WHERE id = ?').get(taskId);
  } catch {
    return true;
  }
}

/**
 * Detects task ids referenced by a tool call (tasks.mjs CLI commands, MCP taskboard tools).
 */
export function detectTaskReference(toolName, args) {
  const a = normArgs(args);
  if (/taskboard_/i.test(toolName || '')) {
    const id = a.task_id || a.taskId || a.id;
    if (typeof id === 'string' && /^task-/i.test(id)) return id;
  }
  const cmd = a.CommandLine || a.command || a.cmd;
  if (typeof cmd === 'string' && /tasks(\.mjs)?\b|taskctl/.test(cmd)) {
    // Ignore read-only listing commands that mention many tasks
    if (/\b(list|json|poll|sessions|followups|costs?)\b/.test(cmd) && !/cost-bind/.test(cmd)) return null;
    const matches = cmd.match(TASK_ID_REGEX);
    if (matches && matches.length) return matches[matches.length - 1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook ingestion
// ---------------------------------------------------------------------------
export function recordToolUse(db, payload, pricing = DEFAULT_PRICING) {
  const conversationId = payload.conversationId || null;
  const stepIdx = Number(payload.stepIdx ?? 0);
  const toolName = payload.toolCall?.name || 'unknown';
  const args = normArgs(payload.toolCall?.args || {});

  // 1. Auto-bind conversation to task if this tool call references one
  const referenced = detectTaskReference(toolName, args);
  if (referenced && conversationId && taskExists(db, referenced)) {
    bindConversation(db, {
      conversationId,
      taskId: referenced,
      stepIdx,
      transcriptPath: payload.transcriptPath || null,
      modelName: payload.modelName || null,
      source: 'hook'
    });
  }

  // 2. Log file access
  const accessType = classifyTool(toolName);
  let filePath = extractPath(args);
  if (accessType === 'other' && !filePath) return { bound: referenced || null, logged: false };
  if (filePath && !path.isAbsolute(filePath) && Array.isArray(payload.workspacePaths) && payload.workspacePaths[0]) {
    filePath = path.join(payload.workspacePaths[0], filePath);
  }
  const m = measureFileAccess(filePath, args, accessType, pricing.chars_per_token);
  const latest = conversationId ? getLatestBinding(db, conversationId) : null;
  db.prepare(`
    INSERT INTO task_file_access (task_id, conversation_id, step_idx, tool_name, access_type, file_path,
      file_size_bytes, bytes_read, lines_read, est_tokens, is_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    latest ? latest.task_id : null,
    conversationId,
    stepIdx,
    toolName,
    accessType,
    filePath,
    m.file_size_bytes,
    m.bytes_read,
    m.lines_read,
    m.est_tokens,
    payload.error ? 1 : 0
  );
  return { bound: referenced || null, logged: true };
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------
export function resolveTranscriptPath(p) {
  if (!p) return null;
  const candidates = [p];
  if (p.endsWith('transcript_full.jsonl')) candidates.push(p.replace('transcript_full.jsonl', 'transcript.jsonl'));
  else if (p.endsWith('transcript.jsonl')) candidates.push(p.replace('transcript.jsonl', 'transcript_full.jsonl'));
  return candidates.find(c => { try { return fs.existsSync(c); } catch { return false; } }) || null;
}

export function transcriptPathForConversation(conversationId, appDataDir) {
  const base = appDataDir || process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(process.env.HOME || '', '.gemini', 'antigravity');
  return path.join(base, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
}

export function parseTranscript(transcriptPath) {
  const resolved = resolveTranscriptPath(transcriptPath);
  if (!resolved) return null;
  const steps = [];
  const text = fs.readFileSync(resolved, 'utf-8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let s;
    try { s = JSON.parse(line); } catch { continue; }
    if (s.type !== 'PLANNER_RESPONSE') continue;
    steps.push({
      step_index: Number(s.step_index ?? 0),
      created_at: s.created_at,
      input_tokens: Number(s.input_tokens || 0),
      cache_read_tokens: Number(s.cache_read_tokens || 0),
      output_tokens: Number(s.output_tokens || 0),
      tool_calls: Array.isArray(s.tool_calls) ? s.tool_calls.map(t => ({ name: t.name, args: normArgs(t.args) })) : []
    });
  }
  return { path: resolved, steps };
}

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------
export function computeTaskCost(db, taskId, { pricing = DEFAULT_PRICING } = {}) {
  const convRows = db.prepare('SELECT DISTINCT conversation_id FROM task_cost_bindings WHERE task_id = ?').all(taskId);
  const totals = { input_tokens: 0, cache_read_tokens: 0, output_tokens: 0, model_calls: 0, tool_calls: 0, est_cost_usd: 0 };
  const conversations = [];
  const toolCounts = {};
  const transcriptFileAccess = [];
  const hookConversations = new Set();

  for (const { conversation_id } of convRows) {
    const bindings = getConversationBindings(db, conversation_id);
    const withPath = [...bindings].reverse().find(b => b.transcript_path);
    const modelName = ([...bindings].reverse().find(b => b.model_name) || {}).model_name || null;
    const rates = ratesForModel(pricing, modelName);
    const tPath = withPath ? withPath.transcript_path : transcriptPathForConversation(conversation_id);
    const hookCount = db.prepare('SELECT COUNT(*) AS c FROM task_file_access WHERE conversation_id = ?').get(conversation_id).c;
    if (hookCount > 0) hookConversations.add(conversation_id);

    const conv = {
      conversation_id,
      model: modelName,
      rate_key: rates.matched,
      transcript_found: false,
      input_tokens: 0, cache_read_tokens: 0, output_tokens: 0, model_calls: 0, tool_calls: 0, est_cost_usd: 0,
      shared_with_tasks: [...new Set(bindings.map(b => b.task_id))].filter(t => t !== taskId)
    };
    let parsed = null;
    try { parsed = parseTranscript(tPath); } catch {}
    if (parsed) {
      conv.transcript_found = true;
      for (const step of parsed.steps) {
        if (taskForStep(bindings, step.step_index) !== taskId) continue;
        conv.model_calls++;
        conv.input_tokens += step.input_tokens;
        conv.cache_read_tokens += step.cache_read_tokens;
        conv.output_tokens += step.output_tokens;
        conv.tool_calls += step.tool_calls.length;
        for (const tc of step.tool_calls) {
          toolCounts[tc.name] = (toolCounts[tc.name] || 0) + 1;
          if (!hookConversations.has(conversation_id)) {
            const type = classifyTool(tc.name);
            const fp = extractPath(tc.args);
            if (type !== 'other' && fp) transcriptFileAccess.push({ tool_name: tc.name, access_type: type, file_path: fp, args: tc.args });
          }
        }
      }
    }
    conv.est_cost_usd = priceTokens(rates, { input: conv.input_tokens, cache_read: conv.cache_read_tokens, output: conv.output_tokens });
    for (const k of ['input_tokens', 'cache_read_tokens', 'output_tokens', 'model_calls', 'tool_calls', 'est_cost_usd']) totals[k] += conv[k];
    conversations.push(conv);
  }

  // File access aggregation: hook rows (size at access time) + transcript fallback
  const fileMap = new Map();
  const addAccess = (row, source) => {
    if (!row.file_path) return;
    const key = row.file_path;
    if (!fileMap.has(key)) {
      fileMap.set(key, {
        file_path: key, reads: 0, writes: 0, searches: 0, lists: 0,
        bytes_read: 0, est_tokens: 0, size_at_first_access: null, size_at_last_access: null, current_size: null, source
      });
    }
    const f = fileMap.get(key);
    if (row.access_type === 'read') f.reads++;
    else if (row.access_type === 'write') f.writes++;
    else if (row.access_type === 'search') f.searches++;
    else if (row.access_type === 'list') f.lists++;
    if (row.access_type === 'read') {
      f.bytes_read += Number(row.bytes_read || 0);
      f.est_tokens += Number(row.est_tokens || 0);
    }
    if (row.file_size_bytes != null) {
      if (f.size_at_first_access == null) f.size_at_first_access = row.file_size_bytes;
      f.size_at_last_access = row.file_size_bytes;
    }
  };
  const hookRows = db.prepare('SELECT * FROM task_file_access WHERE task_id = ? ORDER BY id ASC').all(taskId);
  hookRows.forEach(r => addAccess(r, 'hook'));
  for (const t of transcriptFileAccess) {
    const m = measureFileAccess(t.file_path, t.args, t.access_type, pricing.chars_per_token);
    addAccess({ ...t, ...m, file_size_bytes: null }, 'transcript');
  }
  for (const f of fileMap.values()) {
    try { const st = fs.statSync(f.file_path); f.current_size = st.isFile() ? st.size : 0; } catch { f.current_size = null; }
  }
  const files = [...fileMap.values()].sort((a, b) => b.est_tokens - a.est_tokens || b.reads - a.reads);
  const readFiles = files.filter(f => f.reads > 0);

  const report = {
    task_id: taskId,
    generated_at: new Date().toISOString(),
    currency: pricing.currency || 'USD',
    totals: {
      ...totals,
      total_tokens: totals.input_tokens + totals.cache_read_tokens + totals.output_tokens,
      cache_hit_ratio: (totals.input_tokens + totals.cache_read_tokens) > 0
        ? totals.cache_read_tokens / (totals.input_tokens + totals.cache_read_tokens) : 0,
      files_read: readFiles.length,
      file_reads: readFiles.reduce((s, f) => s + f.reads, 0),
      file_read_tokens: readFiles.reduce((s, f) => s + f.est_tokens, 0),
      files_written: files.filter(f => f.writes > 0).length
    },
    conversations,
    tools: Object.entries(toolCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    files,
    data_sources: {
      hooks: hookRows.length > 0,
      transcripts: conversations.some(c => c.transcript_found),
      bound_conversations: conversations.length
    }
  };
  report.hints = buildHints(report, pricing);
  return report;
}

export function buildHints(report, pricing = DEFAULT_PRICING) {
  const h = pricing.hints || DEFAULT_PRICING.hints;
  const hints = [];
  const t = report.totals;
  if (report.conversations.length === 0) {
    hints.push({ level: 'info', message: 'No agent conversation is bound to this task yet. Enable the plugin hooks or run `tasks.mjs cost-bind <TASK_ID> --transcript <path>` from the agent working on it.' });
    return hints;
  }
  for (const f of report.files) {
    if (f.reads >= h.reread_threshold) {
      hints.push({ level: 'warn', file: f.file_path, message: `Read ${f.reads}× (~${fmtNum(f.est_tokens)} tokens). Consider reading once and keeping notes, or narrowing reads with line ranges.` });
    }
    const size = f.size_at_last_access ?? f.current_size ?? 0;
    if (f.reads > 0 && !IMAGE_EXT.test(f.file_path) && size / (pricing.chars_per_token || 4) >= h.large_file_tokens) {
      hints.push({ level: 'warn', file: f.file_path, message: `Large file (~${fmtNum(Math.round(size / (pricing.chars_per_token || 4)))} tokens). Split it into smaller modules or point agents at specific line ranges / symbols.` });
    }
  }
  if ((t.input_tokens + t.cache_read_tokens) > 50000 && t.cache_hit_ratio < h.cache_ratio_warn) {
    hints.push({ level: 'warn', message: `Low prompt-cache hit ratio (${Math.round(t.cache_hit_ratio * 100)}%). Long-running single conversations cache better than many short ones.` });
  }
  const shared = report.conversations.filter(c => c.shared_with_tasks.length > 0);
  if (shared.length) {
    hints.push({ level: 'info', message: `${shared.length} conversation(s) also worked on other tasks; tokens were attributed by step ranges.` });
  }
  return hints.slice(0, 15);
}

export function saveCostReport(db, report) {
  const t = report.totals;
  db.prepare(`
    INSERT INTO task_cost_reports (task_id, input_tokens, cache_read_tokens, output_tokens, total_tokens, est_cost_usd,
      model_calls, tool_calls, files_read, file_reads, file_read_tokens, report_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(task_id) DO UPDATE SET
      input_tokens = excluded.input_tokens, cache_read_tokens = excluded.cache_read_tokens,
      output_tokens = excluded.output_tokens, total_tokens = excluded.total_tokens,
      est_cost_usd = excluded.est_cost_usd, model_calls = excluded.model_calls, tool_calls = excluded.tool_calls,
      files_read = excluded.files_read, file_reads = excluded.file_reads, file_read_tokens = excluded.file_read_tokens,
      report_json = excluded.report_json, updated_at = CURRENT_TIMESTAMP
  `).run(
    report.task_id, t.input_tokens, t.cache_read_tokens, t.output_tokens, t.total_tokens, t.est_cost_usd,
    t.model_calls, t.tool_calls, t.files_read, t.file_reads, t.file_read_tokens, JSON.stringify(report)
  );
  return report;
}

export function refreshTaskCost(db, taskId, opts = {}) {
  return saveCostReport(db, computeTaskCost(db, taskId, opts));
}

export function getSavedCostReport(db, taskId) {
  const row = db.prepare('SELECT report_json FROM task_cost_reports WHERE task_id = ?').get(taskId);
  if (!row) return null;
  try { return JSON.parse(row.report_json); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Project-wide summary (for optimization decisions)
// ---------------------------------------------------------------------------
export function getProjectCostSummary(db, { pricing = DEFAULT_PRICING, limit = 25 } = {}) {
  const tasks = db.prepare(`
    SELECT r.task_id, t.title, t.status, r.input_tokens, r.cache_read_tokens, r.output_tokens, r.total_tokens,
      r.est_cost_usd, r.model_calls, r.tool_calls, r.files_read, r.file_reads, r.file_read_tokens, r.updated_at
    FROM task_cost_reports r LEFT JOIN agent_tasks t ON t.id = r.task_id
    ORDER BY r.est_cost_usd DESC
  `).all();
  const totals = tasks.reduce((acc, t) => {
    for (const k of ['input_tokens', 'cache_read_tokens', 'output_tokens', 'total_tokens', 'est_cost_usd', 'model_calls', 'tool_calls', 'file_reads', 'file_read_tokens']) acc[k] += Number(t[k] || 0);
    return acc;
  }, { input_tokens: 0, cache_read_tokens: 0, output_tokens: 0, total_tokens: 0, est_cost_usd: 0, model_calls: 0, tool_calls: 0, file_reads: 0, file_read_tokens: 0 });
  totals.tasks = tasks.length;
  totals.avg_cost_per_task = tasks.length ? totals.est_cost_usd / tasks.length : 0;

  // Aggregate files across all saved reports (covers hook + transcript sources)
  const fileAgg = new Map();
  for (const row of db.prepare('SELECT task_id, report_json FROM task_cost_reports').all()) {
    let rep; try { rep = JSON.parse(row.report_json); } catch { continue; }
    for (const f of rep.files || []) {
      if (!f.reads) continue;
      if (!fileAgg.has(f.file_path)) fileAgg.set(f.file_path, { file_path: f.file_path, reads: 0, est_tokens: 0, tasks: 0, current_size: f.current_size, max_size: 0 });
      const a = fileAgg.get(f.file_path);
      a.reads += f.reads;
      a.est_tokens += f.est_tokens;
      a.tasks += 1;
      a.max_size = Math.max(a.max_size, f.size_at_last_access || f.current_size || 0);
      if (f.current_size != null) a.current_size = f.current_size;
    }
  }
  const files = [...fileAgg.values()];
  const topFilesByTokens = [...files].sort((a, b) => b.est_tokens - a.est_tokens).slice(0, limit);
  const topFilesByReads = [...files].sort((a, b) => b.reads - a.reads).slice(0, limit);

  const toolAgg = {};
  for (const row of db.prepare('SELECT tool_name, access_type, COUNT(*) AS c FROM task_file_access GROUP BY tool_name, access_type').all()) {
    toolAgg[row.tool_name] = (toolAgg[row.tool_name] || 0) + row.c;
  }

  const recommendations = [];
  const cpt = pricing.chars_per_token || 4;
  for (const f of topFilesByTokens.slice(0, 5)) {
    if (f.tasks >= 2 && f.est_tokens > 5000) {
      recommendations.push(`\`${f.file_path}\` was read by ${f.tasks} tasks (~${fmtNum(f.est_tokens)} tokens total). A short summary doc or splitting it would cut repeated reads.`);
    }
    if (!IMAGE_EXT.test(f.file_path) && f.max_size / cpt >= (pricing.hints?.large_file_tokens || 8000)) {
      recommendations.push(`\`${f.file_path}\` is ~${fmtNum(Math.round(f.max_size / cpt))} tokens. Point agents at line ranges/symbols or split it up.`);
    }
  }
  const inTot = totals.input_tokens + totals.cache_read_tokens;
  if (inTot > 0 && totals.cache_read_tokens / inTot < (pricing.hints?.cache_ratio_warn || 0.5)) {
    recommendations.push(`Overall prompt-cache hit ratio is ${Math.round((totals.cache_read_tokens / inTot) * 100)}%. Fewer, longer subagent runs reuse cached context better.`);
  }
  if (totals.tasks && totals.output_tokens / Math.max(1, totals.total_tokens) > 0.2) {
    recommendations.push('Output tokens are a large share of usage. Ask agents for shorter plans and walkthroughs.');
  }

  return {
    generated_at: new Date().toISOString(),
    currency: pricing.currency || 'USD',
    pricing: { default: pricing.default, models: pricing.models, chars_per_token: cpt },
    totals,
    tasks,
    top_files_by_tokens: topFilesByTokens,
    top_files_by_reads: topFilesByReads,
    tool_usage: Object.entries(toolAgg).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    recommendations: [...new Set(recommendations)].slice(0, 10)
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function fmtNum(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function fmtBytes(b) {
  if (b == null) return '—';
  b = Number(b);
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

export function fmtUsd(v) {
  return '$' + Number(v || 0).toFixed(Number(v || 0) < 1 ? 4 : 2);
}

function shortPath(p, projectDir) {
  if (!p) return '';
  if (projectDir && p.startsWith(projectDir + path.sep)) return p.slice(projectDir.length + 1);
  return p.replace(process.env.HOME || '\u0000', '~');
}

export function formatCostMarkdown(report, { projectDir = process.cwd(), maxFiles = 10 } = {}) {
  const t = report.totals;
  const lines = [];
  lines.push('### 💰 Cost Report');
  lines.push(`- Estimated cost: **${fmtUsd(t.est_cost_usd)}** (${report.currency})`);
  lines.push(`- Tokens: input **${fmtNum(t.input_tokens)}**, cache read **${fmtNum(t.cache_read_tokens)}** (${Math.round(t.cache_hit_ratio * 100)}% hit), output **${fmtNum(t.output_tokens)}**`);
  lines.push(`- Model calls: ${t.model_calls} · Tool calls: ${t.tool_calls} · Conversations: ${report.conversations.length}`);
  lines.push(`- Files read: ${t.files_read} unique / ${t.file_reads} reads (~${fmtNum(t.file_read_tokens)} tokens) · Files written: ${t.files_written}`);
  const readFiles = report.files.filter(f => f.reads > 0).slice(0, maxFiles);
  if (readFiles.length) {
    lines.push('');
    lines.push('| File | Reads | Size at access | Current size | ~Tokens |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const f of readFiles) {
      lines.push(`| \`${shortPath(f.file_path, projectDir)}\` | ${f.reads} | ${fmtBytes(f.size_at_last_access)} | ${fmtBytes(f.current_size)} | ${fmtNum(f.est_tokens)} |`);
    }
  }
  if (report.hints && report.hints.length) {
    lines.push('');
    lines.push('**Optimization hints**');
    for (const h of report.hints.slice(0, 6)) {
      lines.push(`- ${h.level === 'warn' ? '⚠️' : 'ℹ️'} ${h.file ? '`' + shortPath(h.file, projectDir) + '`: ' : ''}${h.message}`);
    }
  }
  lines.push('');
  lines.push(`<!-- COST_REPORT ${report.task_id} -->`);
  return lines.join('\n');
}
