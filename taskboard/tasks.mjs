#!/usr/bin/env node
import path from 'path';
import fs from 'fs';

let Database;
try {
  const mod = await import('better-sqlite3');
  Database = mod.default || mod;
} catch (e) {
  const { DatabaseSync } = await import('node:sqlite');
  Database = class NodeSqliteWrapper {
    constructor(filePath) {
      this._db = new DatabaseSync(filePath);
    }
    pragma(sql) {
      try {
        this._db.exec(`PRAGMA ${sql};`);
      } catch (err) {}
    }
    exec(sql) {
      return this._db.exec(sql);
    }
    prepare(sql) {
      const stmt = this._db.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    }
    close() {
      return this._db.close();
    }
  };
}

export function getProjectInfo() {
  const projectDir = process.cwd();
  const projectName = path.basename(projectDir);
  const dbDir = path.join(projectDir, '.agents', 'taskboard');
  const dbPath = process.env.TASKBOARD_DB_PATH || path.join(dbDir, 'tasks.sqlite');
  return { projectDir, projectName, dbDir, dbPath };
}

const { dbDir, dbPath } = getProjectInfo();
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Ensure schema exists
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acceptance_criteria TEXT,
    verification_cmd TEXT,
    status TEXT NOT NULL DEFAULT 'backlog', -- 'backlog', 'todo', 'in_progress', 'verification', 'done', 'failed'
    priority TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
    subagent_role TEXT DEFAULT 'Fullstack Engineer',
    scope TEXT DEFAULT '', -- target paths / files / subsystems
    scope_size TEXT DEFAULT 'small', -- 'small', 'medium', 'large'
    execution_logs TEXT,
    order_index INTEGER DEFAULT 0,
    processed_by_agent INTEGER NOT NULL DEFAULT 0, -- 0 = pending, 1 = processed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'agent',
    comment_type TEXT NOT NULL DEFAULT 'comment', -- 'comment', 'question', 'plan', 'walkthrough'
    content TEXT NOT NULL,
    processed_by_agent INTEGER NOT NULL DEFAULT 0, -- 0 = pending/unread by agent, 1 = processed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    verification_cmd TEXT,
    status TEXT NOT NULL DEFAULT 'todo', -- 'todo', 'in_progress', 'done', 'failed'
    order_index INTEGER DEFAULT 0,
    processed_by_agent INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

  CREATE TABLE IF NOT EXISTS board_metadata (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe migrations for existing databases
try {
  db.exec(`ALTER TABLE agent_tasks ADD COLUMN processed_by_agent INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE agent_tasks ADD COLUMN scope TEXT DEFAULT '';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE agent_tasks ADD COLUMN scope_size TEXT DEFAULT 'small';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE task_comments ADD COLUMN processed_by_agent INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE task_subtasks ADD COLUMN processed_by_agent INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);`);
} catch (e) {}

// Migration: Migrate any legacy 'needs_revision' task statuses to 'planned'
try {
  db.prepare("UPDATE agent_tasks SET status = 'planned' WHERE status = 'needs_revision'").run();
} catch (e) {}

// Metadata Key-Value API
export function getMetadata(key) {
  const row = db.prepare('SELECT value FROM board_metadata WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMetadata(key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM board_metadata WHERE key = ?').run(key);
  } else {
    db.prepare(`
      INSERT INTO board_metadata (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, String(value));
  }
}

export function getAllTasks() {
  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id) as subtask_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id AND s.status = 'done') as subtask_done_count,
      (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) as attachment_count
    FROM agent_tasks t 
    ORDER BY t.order_index ASC, t.created_at ASC
  `).all();
}

export function getActiveTasks() {
  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id) as subtask_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id AND s.status = 'done') as subtask_done_count,
      (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) as attachment_count
    FROM agent_tasks t 
    WHERE t.status = 'in_progress'
    ORDER BY t.order_index ASC, t.updated_at ASC
  `).all();
}

export function getActiveTask() {
  const activeTasks = getActiveTasks();
  return activeTasks.length > 0 ? activeTasks[0] : null;
}

export function getPendingReviewTasks() {
  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id) as subtask_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id AND s.status = 'done') as subtask_done_count,
      (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) as attachment_count
    FROM agent_tasks t 
    WHERE t.status = 'verification'
    ORDER BY t.order_index ASC, t.updated_at ASC
  `).all();
}

export function getNextTodoTask(excludeIds = []) {
  const priorityOrder = `
    CASE priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END
  `;
  
  let excludeClause = '';
  const params = [];
  if (Array.isArray(excludeIds) && excludeIds.length > 0) {
    excludeClause = `AND t.id NOT IN (${excludeIds.map(() => '?').join(', ')})`;
    params.push(...excludeIds);
  }

  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id) as subtask_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id AND s.status = 'done') as subtask_done_count,
      (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) as attachment_count
    FROM agent_tasks t 
    WHERE t.status IN ('planned', 'todo') ${excludeClause}
    ORDER BY 
      CASE t.status 
        WHEN 'planned' THEN 1 
        WHEN 'todo' THEN 2 
        ELSE 3 
      END ASC,
      ${priorityOrder} ASC, 
      t.order_index ASC, 
      t.created_at ASC 
    LIMIT 1
  `).get(...params);
}

export function getTaskById(id) {
  const task = db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id) as subtask_count,
      (SELECT COUNT(*) FROM task_subtasks s WHERE s.task_id = t.id AND s.status = 'done') as subtask_done_count,
      (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) as attachment_count
    FROM agent_tasks t 
    WHERE t.id = ?
  `).get(id);

  if (task) {
    task.attachments = getAttachments(id);
  }
  return task;
}

export function addTask({
  title,
  description = '',
  acceptance_criteria = '',
  verification_cmd = '',
  status = 'backlog',
  priority = 'medium',
  subagent_role = 'Fullstack Engineer',
  scope = '',
  scope_size = 'small',
  subtasks = null,
  attachments = null,
  images = null
}) {
  if (status === 'needs_revision') status = 'planned';
  const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const maxOrder = db.prepare('SELECT MAX(order_index) as max_order FROM agent_tasks WHERE status = ?').get(status);
  const order_index = (maxOrder?.max_order ?? 0) + 1;

  db.prepare(`
    INSERT INTO agent_tasks (id, title, description, acceptance_criteria, verification_cmd, status, priority, subagent_role, scope, scope_size, order_index, processed_by_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, title, description, acceptance_criteria, verification_cmd, status, priority, subagent_role, scope, scope_size, order_index);

  if (subtasks) {
    const subtaskList = Array.isArray(subtasks)
      ? subtasks
      : String(subtasks).split('\n').map(s => s.trim()).filter(Boolean);
    subtaskList.forEach((st, idx) => {
      const subTitle = typeof st === 'string' ? st.replace(/^[-*•\d.]+\s*/, '').trim() : (st.title || '').trim();
      if (subTitle) {
        addSubtask(id, {
          title: subTitle,
          order_index: idx + 1,
          verification_cmd: typeof st === 'object' ? (st.verification_cmd || '') : '',
          acceptance_criteria: typeof st === 'object' ? (st.acceptance_criteria || '') : ''
        });
      }
    });
  }

  const imageList = attachments || images;
  if (Array.isArray(imageList) && imageList.length > 0) {
    for (const img of imageList) {
      if (img && (img.buffer || img.dataBase64 || img.data)) {
        addAttachment(id, {
          fileName: img.fileName || img.file_name || 'image.png',
          mimeType: img.mimeType || img.mime_type || 'image/png',
          buffer: img.buffer || img.dataBase64 || img.data
        });
      }
    }
  }

  setMetadata('idle_since', null);
  return getTaskById(id);
}

export function updateTask(id, fields) {
  if (fields.status === 'needs_revision') fields.status = 'planned';
  const allowed = ['title', 'description', 'acceptance_criteria', 'verification_cmd', 'status', 'priority', 'subagent_role', 'scope', 'scope_size', 'execution_logs', 'order_index', 'processed_by_agent'];
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return getTaskById(id);

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(id);

  db.prepare(`
    UPDATE agent_tasks 
    SET ${setClauses.join(', ')} 
    WHERE id = ?
  `).run(...params);

  setMetadata('idle_since', null);
  return getTaskById(id);
}

export function deleteTask(id) {
  return db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(id);
}

// Comments API
export function getComments(taskId) {
  return db.prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC').all(taskId);
}

export function formatCommentContent(content, comment_type) {
  if (!content) return '';
  let text = String(content).trim();
  if (comment_type === 'plan' || /^(Plan|Implementation Plan):\s*/i.test(text)) {
    text = text.replace(/^(Plan|Implementation Plan):\s*/i, '### Implementation Plan\n\n');
    text = text.replace(/:\s*(\d+)[\.\)]\s+/g, ':\n\n$1. ');
    text = text.replace(/([^\n])\s+(\d+)[\.\)]\s+/g, '$1\n$2. ');
  }
  return text;
}

export function addComment(taskId, { author = 'agent', comment_type = 'comment', content }) {
  if (!content || !content.trim()) {
    throw new Error('Comment content cannot be empty');
  }
  const id = `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  
  // If agent wrote it, it is already processed. If user wrote it, processed_by_agent is 0.
  const isAgentAuthor = author.toLowerCase().includes('agent') || author.toLowerCase().includes('supervisor');
  const processed_by_agent = isAgentAuthor ? 1 : 0;
  const formattedContent = formatCommentContent(content, comment_type);

  db.prepare(`
    INSERT INTO task_comments (id, task_id, author, comment_type, content, processed_by_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, taskId, author, comment_type, formattedContent, processed_by_agent);

  // If an implementation plan is posted on a 'todo' task, advance task to 'planned'
  if (comment_type === 'plan') {
    const task = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(taskId);
    if (task && task.status === 'todo') {
      db.prepare(`
        UPDATE agent_tasks 
        SET status = 'planned', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(taskId);
    }
  }

  // If agent posted a question / waiting for user input, move task to 'verification' (Pending Review)
  if (isAgentAuthor && comment_type === 'question') {
    db.prepare(`
      UPDATE agent_tasks 
      SET status = 'verification', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ? AND status != 'done'
    `).run(taskId);
  } else if (!isAgentAuthor) {
    // If a user replies to a task in 'verification' (Input Required), move task back to 'todo'
    const task = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(taskId);
    if (task && task.status === 'verification') {
      db.prepare(`
        UPDATE agent_tasks 
        SET status = 'todo', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(taskId);
    }
  }

  setMetadata('idle_since', null);
  return db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
}

export function updateComment(id, content) {
  if (!content || !content.trim()) {
    throw new Error('Comment content cannot be empty');
  }
  db.prepare('UPDATE task_comments SET content = ? WHERE id = ?').run(content.trim(), id);
  return db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
}

export function deleteComment(id) {
  return db.prepare('DELETE FROM task_comments WHERE id = ?').run(id);
}

// Subtasks API (Ordered Sequential Execution)
export function getSubtasks(taskId) {
  return db.prepare(`
    SELECT * FROM task_subtasks 
    WHERE task_id = ? 
    ORDER BY order_index ASC, created_at ASC
  `).all(taskId);
}

export function getNextSubtask(taskId) {
  return db.prepare(`
    SELECT * FROM task_subtasks 
    WHERE task_id = ? AND status = 'todo' 
    ORDER BY order_index ASC, created_at ASC 
    LIMIT 1
  `).get(taskId);
}

export function addSubtask(taskId, {
  title,
  description = '',
  acceptance_criteria = '',
  verification_cmd = '',
  status = 'todo',
  order_index
}) {
  if (!title || !title.trim()) {
    throw new Error('Subtask title is required');
  }
  const id = `subtask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let finalOrder = order_index;
  if (finalOrder === undefined || finalOrder === null) {
    const maxOrder = db.prepare('SELECT MAX(order_index) as max_order FROM task_subtasks WHERE task_id = ?').get(taskId);
    finalOrder = (maxOrder?.max_order ?? 0) + 1;
  }

  db.prepare(`
    INSERT INTO task_subtasks (id, task_id, title, description, acceptance_criteria, verification_cmd, status, order_index, processed_by_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, taskId, title.trim(), description, acceptance_criteria, verification_cmd, status, finalOrder);

  setMetadata('idle_since', null);
  return db.prepare('SELECT * FROM task_subtasks WHERE id = ?').get(id);
}

export function updateSubtask(subtaskId, fields) {
  const allowed = ['title', 'description', 'acceptance_criteria', 'verification_cmd', 'status', 'order_index', 'processed_by_agent'];
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (setClauses.length === 0) return db.prepare('SELECT * FROM task_subtasks WHERE id = ?').get(subtaskId);

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(subtaskId);

  db.prepare(`
    UPDATE task_subtasks 
    SET ${setClauses.join(', ')} 
    WHERE id = ?
  `).run(...params);

  setMetadata('idle_since', null);
  return db.prepare('SELECT * FROM task_subtasks WHERE id = ?').get(subtaskId);
}

export function deleteSubtask(subtaskId) {
  return db.prepare('DELETE FROM task_subtasks WHERE id = ?').run(subtaskId);
}

// Attachments API (SQLite BLOB Storage)
export function getAttachments(taskId) {
  const rows = db.prepare(`
    SELECT id, task_id, file_name, mime_type, file_size, created_at
    FROM task_attachments
    WHERE task_id = ?
    ORDER BY created_at ASC
  `).all(taskId);

  return rows.map(r => ({
    ...r,
    url: `/api/images/${r.id}`,
    markdown: `![${r.file_name}](/api/images/${r.id})`
  }));
}

export function getAttachment(id) {
  return db.prepare(`
    SELECT id, task_id, file_name, mime_type, file_size, data, created_at
    FROM task_attachments
    WHERE id = ?
  `).get(id);
}

export function addAttachment(taskId, { fileName, mimeType, buffer }) {
  const task = db.prepare('SELECT id FROM agent_tasks WHERE id = ?').get(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  let buf = buffer;
  let safeMime = mimeType || 'image/png';
  if (typeof buffer === 'string') {
    let cleanBase64 = buffer;
    const commaIdx = cleanBase64.indexOf(',');
    if (commaIdx !== -1 && cleanBase64.slice(0, commaIdx).includes('base64')) {
      const header = cleanBase64.slice(0, commaIdx);
      const m = header.match(/data:([^;]+)/);
      if (m && !mimeType) safeMime = m[1];
      cleanBase64 = cleanBase64.slice(commaIdx + 1);
    }
    buf = Buffer.from(cleanBase64, 'base64');
  } else if (!(buffer instanceof Buffer)) {
    buf = Buffer.from(buffer);
  }

  if (!buf || buf.length === 0) {
    throw new Error('Attachment buffer is empty');
  }

  const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const cleanFileName = (fileName || `image_${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileSize = buf.length;

  db.prepare(`
    INSERT INTO task_attachments (id, task_id, file_name, mime_type, file_size, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, taskId, cleanFileName, safeMime, fileSize, buf);

  db.prepare('UPDATE agent_tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(taskId);
  setMetadata('idle_since', null);

  return {
    id,
    task_id: taskId,
    file_name: cleanFileName,
    mime_type: safeMime,
    file_size: fileSize,
    url: `/api/images/${id}`,
    markdown: `![${cleanFileName}](/api/images/${id})`,
    created_at: new Date().toISOString()
  };
}

export function deleteAttachment(id) {
  const row = db.prepare('SELECT task_id FROM task_attachments WHERE id = ?').get(id);
  db.prepare('DELETE FROM task_attachments WHERE id = ?').run(id);
  if (row?.task_id) {
    db.prepare('UPDATE agent_tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.task_id);
  }
  setMetadata('idle_since', null);
  return { success: true, id };
}

// Scope & Conflict Analysis Engine
export function extractTaskPaths(task) {
  const paths = new Set();
  if (task.scope && typeof task.scope === 'string' && task.scope.trim()) {
    task.scope.split(/[,;\n]+/)
      .map(p => p.trim().toLowerCase().replace(/^\.?\//, '').replace(/\/+$/, ''))
      .filter(Boolean)
      .forEach(p => paths.add(p));
  }
  // Also scan title, description, and acceptance criteria for directory/file patterns
  const combined = `${task.title || ''} ${task.description || ''} ${task.acceptance_criteria || ''}`;
  const matches = combined.match(/(?:[a-zA-Z0-9_\-\.]+\/)+[a-zA-Z0-9_\-\.]+/g) || [];
  matches.forEach(m => {
    const clean = m.toLowerCase().replace(/^\.?\//, '').replace(/\/+$/, '');
    if (clean && !clean.startsWith('http') && !clean.includes('localhost') && clean.includes('.')) {
      paths.add(clean);
    }
  });
  return Array.from(paths);
}

export function analyzeScopeAndConflict(candidateTask, activeTasks = [], pendingReviewTasks = [], maxConcurrency = 2) {
  if (!candidateTask) {
    return { can_run_parallel: false, reason: 'No candidate task provided.' };
  }

  // 0. Concurrency Cap Gate
  if (activeTasks.length >= maxConcurrency) {
    return {
      can_run_parallel: false,
      conflict_type: 'concurrency_limit',
      reason: `Max concurrent tasks limit reached (${activeTasks.length}/${maxConcurrency}).`
    };
  }

  const candidateSize = (candidateTask.scope_size || 'small').toLowerCase();

  // 1. Large Scope Gate (Candidate): If candidate is large, it must run strictly one at a time.
  if (candidateSize === 'large') {
    if (activeTasks.length > 0) {
      return {
        can_run_parallel: false,
        conflict_type: 'large_scope',
        reason: `Candidate task "${candidateTask.title}" (${candidateTask.id}) is large scope. Large tasks must run strictly sequentially. Currently active: ${activeTasks.map(t => t.id).join(', ')}.`
      };
    }
  }

  // 2. Large Scope Gate (Active Tasks): If any active task is large, no other task can start.
  const activeLarge = activeTasks.find(t => (t.scope_size || 'small').toLowerCase() === 'large');
  if (activeLarge) {
    return {
      can_run_parallel: false,
      conflict_type: 'active_large_task',
      reason: `Active task "${activeLarge.title}" (${activeLarge.id}) is large scope. Running strictly sequentially.`
    };
  }

  const candidatePaths = extractTaskPaths(candidateTask);

  // Helper to test database migration conflict
  const isDbMigrationTask = (task, paths) => {
    return paths.some(p => p.includes('migration') || p.includes('src/db/')) ||
      /migration|database schema|sqlite/i.test(`${task.title} ${task.description}`);
  };

  const candidateIsDb = isDbMigrationTask(candidateTask, candidatePaths);

  // 3. Check against active running tasks
  for (const active of activeTasks) {
    const activePaths = extractTaskPaths(active);
    
    // DB migration check
    if (candidateIsDb && isDbMigrationTask(active, activePaths)) {
      return {
        can_run_parallel: false,
        conflict_type: 'database_migration',
        conflicting_task_id: active.id,
        reason: `Both candidate "${candidateTask.id}" and active task "${active.id}" touch database migrations. Database operations must run strictly sequentially.`
      };
    }

    // Path overlap check
    for (const cp of candidatePaths) {
      for (const ap of activePaths) {
        if (cp === ap || cp.startsWith(ap + '/') || ap.startsWith(cp + '/')) {
          return {
            can_run_parallel: false,
            conflict_type: 'file_overlap',
            conflicting_task_id: active.id,
            conflict_path: cp,
            reason: `Scope conflict with active task "${active.id}" on path "${cp}".`
          };
        }
      }
    }
  }

  // 4. Check against Pending Review tasks (File Lock)
  for (const review of pendingReviewTasks) {
    const reviewPaths = extractTaskPaths(review);

    if (candidateIsDb && isDbMigrationTask(review, reviewPaths)) {
      return {
        can_run_parallel: false,
        conflict_type: 'database_migration_review',
        conflicting_task_id: review.id,
        reason: `Candidate touches database migrations while task "${review.id}" is in Pending Review. Migrations must be reviewed and approved before continuing.`
      };
    }

    for (const cp of candidatePaths) {
      for (const rp of reviewPaths) {
        if (cp === rp || cp.startsWith(rp + '/') || rp.startsWith(cp + '/')) {
          return {
            can_run_parallel: false,
            conflict_type: 'pending_review_lock',
            conflicting_task_id: review.id,
            conflict_path: cp,
            reason: `Path "${cp}" is locked by task "${review.id}" in Pending Review. Must await user verification.`
          };
        }
      }
    }
  }

  return {
    can_run_parallel: true,
    candidate_size: candidateSize,
    candidate_paths: candidatePaths,
    reason: activeTasks.length > 0
      ? `Zero file or scope conflicts with ${activeTasks.length} active task(s). Cleared for parallel execution.`
      : `Ready for execution.`
  };
}

// Token-efficient polling and acknowledgement functions
export function checkPoll(maxConcurrency = 2) {
  // 1. Unread user comments (Always top priority)
  const unreadComments = db.prepare(`
    SELECT c.id, c.task_id, c.content, c.comment_type, t.title as task_title, t.status as task_status
    FROM task_comments c
    JOIN agent_tasks t ON t.id = c.task_id
    WHERE c.processed_by_agent = 0 AND c.author NOT LIKE '%agent%' AND c.author NOT LIKE '%supervisor%'
    ORDER BY c.created_at ASC
  `).all();

  if (unreadComments.length > 0) {
    setMetadata('idle_since', null);
    return {
      has_work: true,
      action: 'unread_user_comments',
      count: unreadComments.length,
      comments: unreadComments
    };
  }

  // 2. Retrieve active running tasks and pending review tasks
  const activeTasks = getActiveTasks();
  const reviewTasks = getPendingReviewTasks();

  // If we have capacity for more tasks (activeTasks.length < maxConcurrency)
  if (activeTasks.length < maxConcurrency) {
    const candidateTask = getNextTodoTask();
    if (candidateTask) {
      const analysis = analyzeScopeAndConflict(candidateTask, activeTasks, reviewTasks);
      
      if (analysis.can_run_parallel) {
        setMetadata('idle_since', null);
        const subtasks = getSubtasks(candidateTask.id);
        const attachments = getAttachments(candidateTask.id);
        
        if (activeTasks.length > 0) {
          return {
            has_work: true,
            action: 'parallel_candidate_available',
            active_tasks: activeTasks.map(t => ({ id: t.id, title: t.title, scope: t.scope, scope_size: t.scope_size })),
            pending_review_tasks: reviewTasks.map(t => ({ id: t.id, title: t.title, scope: t.scope, scope_size: t.scope_size })),
            task: {
              ...candidateTask,
              subtasks,
              attachments
            },
            analysis
          };
        } else {
          return {
            has_work: true,
            action: candidateTask.status === 'planned' ? 'planned_task_available' : 'todo_task_available',
            pending_review_tasks: reviewTasks.map(t => ({ id: t.id, title: t.title })),
            task: {
              ...candidateTask,
              subtasks,
              attachments
            },
            analysis
          };
        }
      } else {
        // Candidate task exists but CANNOT run in parallel due to conflict or large scope
        if (activeTasks.length > 0) {
          setMetadata('idle_since', null);
          return {
            has_work: true,
            action: 'monitor_active',
            active_tasks: activeTasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
            deferred_candidate: candidateTask.id,
            deferral_reason: analysis.reason
          };
        } else if (reviewTasks.length > 0) {
          // No active tasks, but candidate conflicts with a task in Pending Review!
          const now = Date.now();
          let idleSinceVal = getMetadata('idle_since');
          let idleSince = idleSinceVal ? parseInt(idleSinceVal, 10) : null;
          if (!idleSince) {
            idleSince = now;
            setMetadata('idle_since', String(now));
          }
          const idleSeconds = Math.max(0, Math.floor((now - idleSince) / 1000));
          const idleTimeout = parseInt(process.env.TASKBOARD_IDLE_TIMEOUT || '28800', 10);
          const stopLoop = idleSeconds >= idleTimeout;
          return {
            has_work: false,
            waiting_for_input: true,
            action: 'waiting_for_user_input',
            task_id: reviewTasks[0].id,
            title: reviewTasks[0].title,
            deferred_candidate: candidateTask.id,
            deferral_reason: analysis.reason,
            idle_seconds: idleSeconds,
            idle_timeout_seconds: idleTimeout,
            stop_loop: stopLoop,
            message: stopLoop
              ? `Waiting for review on "${reviewTasks[0].title}" for 8 hours (${idleSeconds}s). Autonomous loop stopping.`
              : `Candidate "${candidateTask.title}" (${candidateTask.id}) deferred: ${analysis.reason} Idle for ${idleSeconds}s.`
          };
        }
      }
    }
  }

  // 3. If active tasks are running (either maxConcurrency reached or no candidate available)
  if (activeTasks.length > 0) {
    setMetadata('idle_since', null);
    return {
      has_work: true,
      action: 'monitor_active',
      active_tasks: activeTasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
      message: `${activeTasks.length} task(s) currently in progress.`
    };
  }

  // 4. If no active tasks and no candidates, but tasks are in Pending Review
  if (reviewTasks.length > 0) {
    const now = Date.now();
    let idleSinceVal = getMetadata('idle_since');
    let idleSince = idleSinceVal ? parseInt(idleSinceVal, 10) : null;
    if (!idleSince) {
      idleSince = now;
      setMetadata('idle_since', String(now));
    }
    const idleSeconds = Math.max(0, Math.floor((now - idleSince) / 1000));
    const idleTimeout = parseInt(process.env.TASKBOARD_IDLE_TIMEOUT || '28800', 10);
    const stopLoop = idleSeconds >= idleTimeout;
    return {
      has_work: false,
      waiting_for_input: true,
      action: 'waiting_for_user_input',
      task_id: reviewTasks[0].id,
      title: reviewTasks[0].title,
      idle_seconds: idleSeconds,
      idle_timeout_seconds: idleTimeout,
      stop_loop: stopLoop,
      message: stopLoop
        ? `No user review received for task "${reviewTasks[0].title}" for 8 hours (${idleSeconds}s). Autonomous loop stopping.`
        : `Task "${reviewTasks[0].title}" (${reviewTasks[0].id}) is in Pending Review column waiting for user verification/review. Idle for ${idleSeconds}s.`
    };
  }

  // 5. Complete idle
  const now = Date.now();
  let idleSinceVal = getMetadata('idle_since');
  let idleSince = idleSinceVal ? parseInt(idleSinceVal, 10) : null;
  if (!idleSince) {
    idleSince = now;
    setMetadata('idle_since', String(now));
  }
  const idleSeconds = Math.max(0, Math.floor((now - idleSince) / 1000));
  const idleTimeout = parseInt(process.env.TASKBOARD_IDLE_TIMEOUT || '28800', 10);
  const stopLoop = idleSeconds >= idleTimeout;

  return {
    has_work: false,
    action: 'idle',
    idle_seconds: idleSeconds,
    idle_timeout_seconds: idleTimeout,
    stop_loop: stopLoop,
    message: stopLoop
      ? `Taskboard has been idle with no active tasks for 8 hours (${idleSeconds}s). Autonomous loop stopping.`
      : `No active tasks. Idle for ${idleSeconds}s.`
  };
}

export function markTaskProcessed(taskId) {
  db.prepare(`UPDATE agent_tasks SET processed_by_agent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);
  db.prepare(`UPDATE task_comments SET processed_by_agent = 1 WHERE task_id = ?`).run(taskId);
  return { success: true, taskId, processed: true };
}

export function markCommentProcessed(commentId) {
  db.prepare(`UPDATE task_comments SET processed_by_agent = 1 WHERE id = ?`).run(commentId);
  return { success: true, commentId, processed: true };
}

// CLI handler
const [,, command, ...args] = process.argv;

if (command) {
  switch (command) {
    case 'info': {
      console.log(JSON.stringify(getProjectInfo(), null, 2));
      break;
    }
    case 'poll': {
      // Ultra-lightweight check for loop timers
      console.log(JSON.stringify(checkPoll()));
      break;
    }
    case 'reset-idle': {
      setMetadata('idle_since', null);
      console.log(JSON.stringify({ success: true, message: 'Idle timer reset.' }));
      break;
    }
    case 'active': {
      const activeList = getActiveTasks();
      if (activeList.length === 0) {
        console.log(JSON.stringify({ active: false, tasks: [] }));
      } else {
        console.log(JSON.stringify({ active: true, count: activeList.length, tasks: activeList }, null, 2));
      }
      break;
    }
    case 'check-conflict': {
      const [candidateId] = args;
      const candidate = getTaskById(candidateId);
      if (!candidate) {
        console.log(JSON.stringify({ error: `Task ${candidateId} not found` }));
        break;
      }
      const activeTasks = getActiveTasks().filter(t => t.id !== candidateId);
      const reviewTasks = getPendingReviewTasks().filter(t => t.id !== candidateId);
      const result = analyzeScopeAndConflict(candidate, activeTasks, reviewTasks);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'next': {
      const task = getNextTodoTask();
      if (!task) {
        console.log(JSON.stringify({ found: false }));
      } else {
        console.log(JSON.stringify({ found: true, task }, null, 2));
      }
      break;
    }
    case 'list': {
      const { projectName, dbPath } = getProjectInfo();
      const tasks = getAllTasks();
      const columns = ['backlog', 'todo', 'planned', 'in_progress', 'verification', 'done', 'failed'];
      console.log(`\n================== 📋 KANBAN: [${projectName}] ==================`);
      console.log(`📂 DB: ${dbPath}\n`);
      for (const col of columns) {
        const inCol = tasks.filter(t => t.status === col);
        const colTitle = col === 'verification' ? 'PENDING REVIEW' : col.toUpperCase();
        console.log(`▶ [${colTitle}] (${inCol.length} tasks)`);
        if (inCol.length === 0) {
          console.log('    (empty)');
        } else {
          for (const t of inCol) {
            const qBadge = t.question_count > 0 ? ' [❓ QUESTION]' : '';
            const cBadge = t.comment_count > 0 ? ` (${t.comment_count} 💬)` : '';
            const sBadge = t.subtask_count > 0 ? ` [${t.subtask_done_count}/${t.subtask_count} subtasks]` : '';
            const aBadge = t.attachment_count > 0 ? ` [🖼️ ${t.attachment_count}]` : '';
            const scopeBadge = t.scope ? ` [🏷️ ${t.scope}]` : '';
            const sizeBadge = t.scope_size && t.scope_size !== 'small' ? ` [${t.scope_size.toUpperCase()}]` : '';
            console.log(`    • [${t.priority.toUpperCase()}] ${t.id}: ${t.title}${scopeBadge}${sizeBadge}${sBadge}${aBadge}${qBadge}${cBadge}`);
          }
        }
        console.log('');
      }
      console.log('==================================================================\n');
      break;
    }
    case 'json': {
      console.log(JSON.stringify(getAllTasks(), null, 2));
      break;
    }
    case 'get': {
      const id = args[0];
      const task = getTaskById(id);
      if (task) {
        task.subtasks = getSubtasks(id);
      }
      console.log(JSON.stringify(task, null, 2));
      break;
    }
    case 'update': {
      const [id, status, ...logParts] = args;
      const logs = logParts.join(' ');
      const fields = { status };
      if (logs) fields.execution_logs = logs;
      const updated = updateTask(id, fields);
      console.log(`✅ Updated ${id} to ${status}:`, JSON.stringify(updated, null, 2));
      break;
    }
    case 'add': {
      const [title, description, priority, verification_cmd] = args;
      const created = addTask({
        title,
        description: description || '',
        priority: priority || 'medium',
        verification_cmd: verification_cmd || '',
        status: 'todo'
      });
      console.log(`✅ Task created with ID ${created.id}`);
      break;
    }
    case 'subtasks': {
      const [taskId] = args;
      const subtasks = getSubtasks(taskId);
      console.log(JSON.stringify(subtasks, null, 2));
      break;
    }
    case 'next-subtask': {
      const [taskId] = args;
      const subtask = getNextSubtask(taskId);
      if (!subtask) {
        console.log(JSON.stringify({ found: false, message: 'All subtasks completed or none defined' }));
      } else {
        console.log(JSON.stringify({ found: true, subtask }, null, 2));
      }
      break;
    }
    case 'add-subtask': {
      const [taskId, title, order_index, verification_cmd] = args;
      const subtask = addSubtask(taskId, {
        title,
        order_index: order_index ? parseInt(order_index, 10) : undefined,
        verification_cmd: verification_cmd || ''
      });
      console.log(`✅ Subtask added to ${taskId}:`, JSON.stringify(subtask, null, 2));
      break;
    }
    case 'update-subtask': {
      const [subtaskId, status] = args;
      const updated = updateSubtask(subtaskId, { status });
      console.log(`✅ Updated subtask ${subtaskId} to ${status}:`, JSON.stringify(updated, null, 2));
      break;
    }
    case 'comment': {
      const [taskId, content, author, comment_type] = args;
      const comment = addComment(taskId, {
        content,
        author: author || 'agent',
        comment_type: comment_type || 'comment'
      });
      console.log(`✅ Added comment to ${taskId}:`, JSON.stringify(comment, null, 2));
      break;
    }
    case 'comments': {
      const [taskId] = args;
      const comments = getComments(taskId);
      console.log(JSON.stringify(comments, null, 2));
      break;
    }
    case 'update-comment': {
      const [commentId, content] = args;
      if (!commentId || !content) {
        console.error('Usage: tasks.mjs update-comment <commentId> <content>');
        process.exit(1);
      }
      const updated = updateComment(commentId, content);
      console.log(`✅ Updated comment ${commentId}:`, JSON.stringify(updated, null, 2));
      break;
    }
    case 'ack-task': {
      const [taskId] = args;
      console.log(JSON.stringify(markTaskProcessed(taskId)));
      break;
    }
    case 'ack-comment': {
      const [commentId] = args;
      console.log(JSON.stringify(markCommentProcessed(commentId)));
      break;
    }
    case 'attachments': {
      const [taskId] = args;
      const attachments = getAttachments(taskId);
      console.log(JSON.stringify(attachments, null, 2));
      break;
    }
    case 'add-attachment': {
      const [taskId, filePath] = args;
      if (!taskId || !filePath) {
        console.error('Usage: tasks.mjs add-attachment <taskId> <filePath>');
        process.exit(1);
      }
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }
      const buffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      const att = addAttachment(taskId, { fileName, mimeType, buffer });
      console.log(`✅ Attachment added to ${taskId}:`, JSON.stringify(att, null, 2));
      break;
    }
    case 'get-attachment': {
      const [id, outputPath] = args;
      const att = getAttachment(id);
      if (!att) {
        console.error(`Attachment ${id} not found`);
        process.exit(1);
      }
      if (outputPath) {
        fs.writeFileSync(outputPath, att.data);
        console.log(`✅ Saved attachment ${id} (${att.file_name}) to ${outputPath}`);
      } else {
        const { data, ...meta } = att;
        console.log(JSON.stringify({ ...meta, size: data.length }, null, 2));
      }
      break;
    }
    case 'delete-attachment': {
      const [id] = args;
      console.log(JSON.stringify(deleteAttachment(id)));
      break;
    }
    default: {
      console.log(`Supported commands: info, poll, active, next, list, json, get, update, add, subtasks, next-subtask, add-subtask, update-subtask, comment, update-comment, comments, attachments, add-attachment, get-attachment, delete-attachment, ack-task, ack-comment.`);
    }
  }
}
