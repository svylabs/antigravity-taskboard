#!/usr/bin/env node
/**
 * Antigravity lifecycle hook for per-task cost tracking.
 *
 * Registered in the plugin root `hooks.json`:
 *   PostToolUse (matcher "*") -> `node taskboard/cost_hook.mjs post-tool`
 *   Stop                      -> `node taskboard/cost_hook.mjs stop`
 *
 * Reads the hook payload (JSON) from stdin and writes into the project's taskboard
 * SQLite DB (<workspace>/.agents/taskboard/tasks.sqlite). Only workspaces that already
 * have a taskboard DB are tracked; others are ignored.
 *
 * The hook must never block or break the agent: every error is swallowed and `{}` is
 * always printed to stdout with exit code 0.
 */
import fs from 'fs';
import path from 'path';
import {
  ensureCostSchema,
  recordToolUse,
  loadPricing,
  refreshTaskCost,
  getConversationBindings,
  bindConversation,
  getLatestBinding
} from './cost.mjs';

const mode = process.argv[2] || 'post-tool';

function done() {
  try { process.stdout.write('{}\n'); } catch {}
  process.exit(0);
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
    setTimeout(() => resolve(data), 3000);
  });
}

async function openDb(dbPath) {
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default || mod;
    const db = new Database(dbPath, { timeout: 2000 });
    try { db.pragma('journal_mode = WAL'); } catch {}
    return db;
  } catch {
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(dbPath);
    try { raw.exec('PRAGMA busy_timeout = 2000;'); } catch {}
    return {
      exec: sql => raw.exec(sql),
      prepare: sql => {
        const stmt = raw.prepare(sql);
        return { run: (...a) => stmt.run(...a), get: (...a) => stmt.get(...a), all: (...a) => stmt.all(...a) };
      },
      close: () => raw.close()
    };
  }
}

function findDbPath(payload) {
  if (process.env.TASKBOARD_DB_PATH && fs.existsSync(process.env.TASKBOARD_DB_PATH)) return process.env.TASKBOARD_DB_PATH;
  const roots = Array.isArray(payload.workspacePaths) ? payload.workspacePaths : [];
  for (const root of roots) {
    const p = path.join(root, '.agents', 'taskboard', 'tasks.sqlite');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  if (process.env.TASKBOARD_COST_TRACKING === '0') return done();
  const raw = await readStdin();
  if (!raw.trim()) return done();
  let payload;
  try { payload = JSON.parse(raw); } catch { return done(); }

  const dbPath = findDbPath(payload);
  if (!dbPath) return done();
  const db = await openDb(dbPath);
  try {
    ensureCostSchema(db);
    const pricing = loadPricing(path.dirname(dbPath));

    if (mode === 'post-tool') {
      recordToolUse(db, payload, pricing);
    } else if (mode === 'stop') {
      const conv = payload.conversationId;
      if (conv) {
        const latest = getLatestBinding(db, conv);
        // Keep transcript path/model fresh on the latest binding
        if (latest) {
          bindConversation(db, {
            conversationId: conv,
            taskId: latest.task_id,
            transcriptPath: payload.transcriptPath || null,
            modelName: payload.modelName || null
          });
        }
        // Refresh stored reports for active tasks this conversation worked on
        const taskIds = [...new Set(getConversationBindings(db, conv).map(b => b.task_id))];
        for (const taskId of taskIds) {
          let status = null;
          try { status = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(taskId)?.status; } catch {}
          if (status && !['in_progress', 'verification', 'planned'].includes(status)) continue;
          try { refreshTaskCost(db, taskId, { pricing }); } catch {}
        }
      }
    }
  } catch (e) {
    if (process.env.TASKBOARD_COST_DEBUG === '1') {
      try { fs.appendFileSync(path.join(path.dirname(dbPath), 'cost_hook.log'), `[${new Date().toISOString()}] ${mode}: ${e.stack || e}\n`); } catch {}
    }
  } finally {
    try { db.close(); } catch {}
  }
  done();
}

main().catch(() => done());
