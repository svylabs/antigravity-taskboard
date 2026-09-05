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
`);

// Safe migrations for existing databases
try {
  db.exec(`ALTER TABLE agent_tasks ADD COLUMN processed_by_agent INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE task_comments ADD COLUMN processed_by_agent INTEGER NOT NULL DEFAULT 0;`);
} catch (e) {}

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
    INSERT INTO agent_tasks (id, title, description, acceptance_criteria, verification_cmd, status, priority, subagent_role, order_index, processed_by_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, title, description, acceptance_criteria, verification_cmd, status, priority, subagent_role, order_index);

  return getTaskById(id);
}

export function updateTask(id, fields) {
  const allowed = ['title', 'description', 'acceptance_criteria', 'verification_cmd', 'status', 'priority', 'subagent_role', 'execution_logs', 'order_index', 'processed_by_agent'];
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
  
  // If agent wrote it, it is already processed. If user wrote it, processed_by_agent is 0.
  const isAgentAuthor = author.toLowerCase().includes('agent') || author.toLowerCase().includes('supervisor');
  const processed_by_agent = isAgentAuthor ? 1 : 0;

  db.prepare(`
    INSERT INTO task_comments (id, task_id, author, comment_type, content, processed_by_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, taskId, author, comment_type, content.trim(), processed_by_agent);

  return db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
}

export function deleteComment(id) {
  return db.prepare('DELETE FROM task_comments WHERE id = ?').run(id);
}

// Token-efficient polling and acknowledgement functions
export function checkPoll() {
  // 1. Is there an active running task?
  const activeTask = getActiveTask();
  if (activeTask) {
    return {
      has_work: true,
      action: 'monitor_active',
      task_id: activeTask.id,
      title: activeTask.title,
      status: activeTask.status
    };
  }

  // 2. Are there unread user comments on any task?
  const unreadComments = db.prepare(`
    SELECT c.id, c.task_id, c.content, c.comment_type, t.title as task_title, t.status as task_status
    FROM task_comments c
    JOIN agent_tasks t ON t.id = c.task_id
    WHERE c.processed_by_agent = 0 AND c.author NOT LIKE '%agent%' AND c.author NOT LIKE '%supervisor%'
    ORDER BY c.created_at ASC
  `).all();

  if (unreadComments.length > 0) {
    return {
      has_work: true,
      action: 'unread_user_comments',
      count: unreadComments.length,
      comments: unreadComments
    };
  }

  // 3. Is there a next 'todo' task ready to execute?
  const nextTask = getNextTodoTask();
  if (nextTask) {
    return {
      has_work: true,
      action: 'todo_task_available',
      task: {
        id: nextTask.id,
        title: nextTask.title,
        priority: nextTask.priority,
        verification_cmd: nextTask.verification_cmd,
        acceptance_criteria: nextTask.acceptance_criteria
      }
    };
  }

  // 4. Nothing new to do! Ultra-compact response (<10 tokens)
  return {
    has_work: false
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
    default: {
      console.log(`Supported commands: info, poll, active, next, list, json, get, update, add, comment, comments, ack-task, ack-comment.`);
    }
  }
}
