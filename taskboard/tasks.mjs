#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
    execution_logs TEXT,
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'agent',
    comment_type TEXT NOT NULL DEFAULT 'comment', -- 'comment', 'question', 'plan', 'walkthrough'
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
  );
`);

export function getAllTasks() {
  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count
    FROM agent_tasks t 
    ORDER BY t.order_index ASC, t.created_at ASC
  `).all();
}

export function getActiveTask() {
  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count
    FROM agent_tasks t 
    WHERE t.status IN ('in_progress', 'verification')
    LIMIT 1
  `).get();
}

export function getNextTodoTask() {
  // If a task is already active, enforce completing it first
  const active = getActiveTask();
  if (active) {
    return null;
  }

  const priorityOrder = `
    CASE priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE 5
    END
  `;
  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count
    FROM agent_tasks t 
    WHERE t.status = 'todo' 
    ORDER BY ${priorityOrder} ASC, t.order_index ASC, t.created_at ASC 
    LIMIT 1
  `).get();
}

export function getTaskById(id) {
  return db.prepare(`
    SELECT 
      t.*,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.comment_type = 'question') as question_count
    FROM agent_tasks t 
    WHERE t.id = ?
  `).get(id);
}

export function addTask({
  title,
  description = '',
  acceptance_criteria = '',
  verification_cmd = '',
  status = 'backlog',
  priority = 'medium',
  subagent_role = 'Fullstack Engineer'
}) {
  const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const maxOrder = db.prepare('SELECT MAX(order_index) as max_order FROM agent_tasks WHERE status = ?').get(status);
  const order_index = (maxOrder?.max_order ?? 0) + 1;

  db.prepare(`
    INSERT INTO agent_tasks (id, title, description, acceptance_criteria, verification_cmd, status, priority, subagent_role, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, description, acceptance_criteria, verification_cmd, status, priority, subagent_role, order_index);

  return getTaskById(id);
}

export function updateTask(id, fields) {
  const allowed = ['title', 'description', 'acceptance_criteria', 'verification_cmd', 'status', 'priority', 'subagent_role', 'execution_logs', 'order_index'];
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

  return getTaskById(id);
}

export function deleteTask(id) {
  return db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(id);
}

// Comments API
export function getComments(taskId) {
  return db.prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC').all(taskId);
}

export function addComment(taskId, { author = 'agent', comment_type = 'comment', content }) {
  if (!content || !content.trim()) {
    throw new Error('Comment content cannot be empty');
  }
  const id = `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO task_comments (id, task_id, author, comment_type, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, taskId, author, comment_type, content.trim());

  return db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
}

export function deleteComment(id) {
  return db.prepare('DELETE FROM task_comments WHERE id = ?').run(id);
}

// CLI handler
const [,, command, ...args] = process.argv;

if (command) {
  switch (command) {
    case 'info': {
      console.log(JSON.stringify(getProjectInfo(), null, 2));
      break;
    }
    case 'active': {
      const active = getActiveTask();
      if (!active) {
        console.log(JSON.stringify({ active: false }));
      } else {
        console.log(JSON.stringify({ active: true, task: active }, null, 2));
      }
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
      const columns = ['backlog', 'todo', 'in_progress', 'verification', 'done', 'failed'];
      console.log(`\n================== 📋 KANBAN: [${projectName}] ==================`);
      console.log(`📂 DB: ${dbPath}\n`);
      for (const col of columns) {
        const inCol = tasks.filter(t => t.status === col);
        console.log(`▶ [${col.toUpperCase()}] (${inCol.length} tasks)`);
        if (inCol.length === 0) {
          console.log('    (empty)');
        } else {
          for (const t of inCol) {
            const qBadge = t.question_count > 0 ? ' [❓ QUESTION]' : '';
            const cBadge = t.comment_count > 0 ? ` (${t.comment_count} 💬)` : '';
            console.log(`    • [${t.priority.toUpperCase()}] ${t.id}: ${t.title}${qBadge}${cBadge}`);
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
      console.log(JSON.stringify(getTaskById(id), null, 2));
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
    default: {
      console.log(`Supported commands: info, next, list, json, get, update, add, comment, comments.`);
    }
  }
}
