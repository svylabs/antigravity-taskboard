import { db } from './tasks.mjs';

/**
 * Returns today's date formatted as YYYY-MM-DD in local time.
 */
export function getTodaySessionName() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Ensures SQLite schema for sessions exists and migrates agent_tasks table.
 */
export function ensureSessionSchema(database = db) {
  // 1. Create task_sessions table
  database.prepare(`
    CREATE TABLE IF NOT EXISTS task_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // 2. Add session_id and completed_at to agent_tasks if not present
  const taskCols = database.prepare('PRAGMA table_info(agent_tasks)').all().map(c => c.name);
  if (!taskCols.includes('session_id')) {
    database.prepare('ALTER TABLE agent_tasks ADD COLUMN session_id TEXT').run();
  }
  if (!taskCols.includes('completed_at')) {
    database.prepare('ALTER TABLE agent_tasks ADD COLUMN completed_at DATETIME').run();
  }

  // 3. Create index for fast session queries
  database.prepare(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON agent_tasks(session_id)`).run();

  // 4. Ensure at least one active default session exists
  ensureDefaultSession(database);
}

/**
 * Ensures a default session exists. If no sessions exist, creates one with today's date
 * and links any existing unassigned tasks to it.
 */
export function ensureDefaultSession(database = db) {
  const countRow = database.prepare('SELECT COUNT(*) as count FROM task_sessions').get();
  let activeId = getActiveSessionId(database);

  if (countRow.count === 0) {
    const defaultName = getTodaySessionName();
    const id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    database.prepare(`
      INSERT INTO task_sessions (id, name, description, status, started_at)
      VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)
    `).run(id, defaultName, `Sprint session for ${defaultName}`);

    // Link any existing tasks without a session to this default session
    database.prepare(`
      UPDATE agent_tasks SET session_id = ? WHERE session_id IS NULL
    `).run(id);

    setActiveSessionId(database, id);
    return id;
  }

  // If there's no valid active session in board_metadata, pick the first active one or the newest
  if (!activeId || !database.prepare('SELECT id FROM task_sessions WHERE id = ?').get(activeId)) {
    const active = database.prepare("SELECT id FROM task_sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get()
      || database.prepare("SELECT id FROM task_sessions ORDER BY created_at DESC LIMIT 1").get();
    if (active) {
      setActiveSessionId(database, active.id);
      return active.id;
    }
  }

  return activeId;
}

/**
 * Gets the active session ID from board_metadata.
 */
export function getActiveSessionId(database = db) {
  const row = database.prepare("SELECT value FROM board_metadata WHERE key = 'active_session_id'").get();
  return row ? row.value : null;
}

/**
 * Sets the active session ID in board_metadata.
 */
export function setActiveSessionId(database = db, sessionId) {
  database.prepare(`
    INSERT INTO board_metadata (key, value, updated_at)
    VALUES ('active_session_id', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(sessionId);
}

/**
 * Retrieves all sessions with calculated statistics.
 */
export function getAllSessions(database = db) {
  ensureSessionSchema(database);
  const activeId = getActiveSessionId(database);
  const sessions = database.prepare(`
    SELECT * FROM task_sessions ORDER BY created_at DESC
  `).all();

  // Get task stats grouped by session_id
  const statsRows = database.prepare(`
    SELECT 
      session_id,
      status,
      COUNT(*) as count
    FROM agent_tasks
    WHERE status != 'backlog' AND session_id IS NOT NULL
    GROUP BY session_id, status
  `).all();

  const statsMap = {};
  for (const r of statsRows) {
    if (!statsMap[r.session_id]) {
      statsMap[r.session_id] = { total: 0, done: 0, in_progress: 0, todo: 0, planned: 0, failed: 0 };
    }
    const s = statsMap[r.session_id];
    s.total += r.count;
    if (r.status === 'done') s.done += r.count;
    else if (r.status === 'in_progress' || r.status === 'verification') s.in_progress += r.count;
    else if (r.status === 'todo') s.todo += r.count;
    else if (r.status === 'planned') s.planned += r.count;
    else if (r.status === 'failed') s.failed += r.count;
  }

  return sessions.map(sess => {
    const stats = statsMap[sess.id] || { total: 0, done: 0, in_progress: 0, todo: 0, planned: 0, failed: 0 };
    const completion_rate = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
    return {
      ...sess,
      is_active: sess.id === activeId,
      stats: {
        ...stats,
        completion_rate
      }
    };
  });
}

/**
 * Gets a single session by ID with its stats.
 */
export function getSessionById(database = db, id) {
  ensureSessionSchema(database);
  const activeId = getActiveSessionId(database);
  const sess = database.prepare('SELECT * FROM task_sessions WHERE id = ?').get(id);
  if (!sess) return null;

  const tasks = database.prepare(`
    SELECT id, title, status, priority, completed_at, created_at, updated_at
    FROM agent_tasks
    WHERE session_id = ? AND status != 'backlog'
    ORDER BY order_index ASC, created_at DESC
  `).all(id);

  const stats = { total: tasks.length, done: 0, in_progress: 0, todo: 0, planned: 0, failed: 0 };
  for (const t of tasks) {
    if (t.status === 'done') stats.done++;
    else if (t.status === 'in_progress' || t.status === 'verification') stats.in_progress++;
    else if (t.status === 'todo') stats.todo++;
    else if (t.status === 'planned') stats.planned++;
    else if (t.status === 'failed') stats.failed++;
  }
  const completion_rate = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return {
    ...sess,
    is_active: sess.id === activeId,
    stats: {
      ...stats,
      completion_rate
    },
    tasks
  };
}

/**
 * Generates an automatic next name if a session with today's date already exists.
 */
export function suggestNextSessionName(database = db) {
  const base = getTodaySessionName();
  const existing = database.prepare(`
    SELECT name FROM task_sessions WHERE name = ? OR name LIKE ?
  `).all(base, `${base} #%`);

  if (existing.length === 0) return base;

  let maxNum = 1;
  for (const row of existing) {
    if (row.name === base) {
      if (maxNum < 1) maxNum = 1;
    } else {
      const m = row.name.match(/#(\d+)$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  return `${base} #${maxNum + 1}`;
}

/**
 * Creates a new session.
 */
export function createSession(database = db, { name, description = '', status = 'active', set_active = true } = {}) {
  ensureSessionSchema(database);
  const sessionName = (name && name.trim()) ? name.trim() : suggestNextSessionName(database);
  const id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

  database.prepare(`
    INSERT INTO task_sessions (id, name, description, status, started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, sessionName, description || '', status || 'active');

  if (set_active) {
    setActiveSessionId(database, id);
  }

  return getSessionById(database, id);
}

/**
 * Updates an existing session.
 */
export function updateSession(database = db, id, { name, description, status } = {}) {
  ensureSessionSchema(database);
  const sess = database.prepare('SELECT * FROM task_sessions WHERE id = ?').get(id);
  if (!sess) throw new Error(`Session ${id} not found`);

  const newName = name !== undefined && name.trim() ? name.trim() : sess.name;
  const newDesc = description !== undefined ? description : sess.description;
  const newStatus = status !== undefined ? status : sess.status;

  let endedAt = sess.ended_at;
  if (newStatus === 'completed' && sess.status !== 'completed') {
    endedAt = new Date().toISOString();
  } else if (newStatus === 'active') {
    endedAt = null;
  }

  database.prepare(`
    UPDATE task_sessions 
    SET name = ?, description = ?, status = ?, ended_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newName, newDesc, newStatus, endedAt, id);

  return getSessionById(database, id);
}

/**
 * Deletes a session and safely unlinks associated tasks.
 */
export function deleteSession(database = db, id) {
  ensureSessionSchema(database);
  const sess = database.prepare('SELECT * FROM task_sessions WHERE id = ?').get(id);
  if (!sess) throw new Error(`Session ${id} not found`);

  // Unlink tasks belonging to this session
  database.prepare('UPDATE agent_tasks SET session_id = NULL WHERE session_id = ?').run(id);

  // Delete session
  database.prepare('DELETE FROM task_sessions WHERE id = ?').run(id);

  // If this was the active session, pick another or create default
  const activeId = getActiveSessionId(database);
  if (activeId === id) {
    ensureDefaultSession(database);
  }

  return { success: true, deleted: id };
}

/**
 * Assigns a task to a session.
 */
export function setTaskSession(database = db, taskId, sessionId) {
  ensureSessionSchema(database);
  database.prepare(`
    UPDATE agent_tasks SET session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(sessionId || null, taskId);
}

/**
 * Handles completed status change for a task, recording completion timestamp and session.
 */
export function onTaskStatusChanged(database = db, taskId, newStatus) {
  ensureSessionSchema(database);
  if (newStatus === 'done') {
    const task = database.prepare('SELECT session_id, completed_at FROM agent_tasks WHERE id = ?').get(taskId);
    if (task) {
      const activeId = getActiveSessionId(database);
      const targetSessionId = task.session_id || activeId;
      database.prepare(`
        UPDATE agent_tasks 
        SET completed_at = CURRENT_TIMESTAMP, session_id = COALESCE(session_id, ?)
        WHERE id = ?
      `).run(targetSessionId, taskId);
    }
  } else {
    database.prepare(`
      UPDATE agent_tasks SET completed_at = NULL WHERE id = ?
    `).run(taskId);
  }
}
