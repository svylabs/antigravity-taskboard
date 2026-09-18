#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { 
  getAllTasks, 
  getTaskById, 
  addTask, 
  updateTask, 
  deleteTask, 
  getProjectInfo,
  getComments,
  addComment,
  updateComment,
  deleteComment,
  getSubtasks,
  getNextSubtask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  getAttachments,
  getAttachment,
  addAttachment,
  deleteAttachment
} from './tasks.mjs';
import { handleRepoRequest } from './repo_viewer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') {
      opts.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--host' || args[i] === '-h') {
      opts.host = args[i + 1];
      i++;
    }
  }
  return opts;
}

const cliOpts = parseArgs();
const REQUESTED_PORT = cliOpts.port || (process.env.TASKBOARD_PORT ? parseInt(process.env.TASKBOARD_PORT, 10) : 4040);
const HOST = cliOpts.host || process.env.TASKBOARD_HOST || process.env.HOST || '0.0.0.0';
let ACTIVE_PORT = REQUESTED_PORT;

const PRIMARY_REGISTRY_DIR = path.join(os.homedir(), '.agy-taskboard-sessions');
const PRIMARY_REGISTRY_FILE = path.join(PRIMARY_REGISTRY_DIR, 'registry.json');
const FALLBACK_REGISTRY_FILE = path.join(os.tmpdir(), 'antigravity-taskboard-registry.json');
const LOCAL_SERVER_FILE = path.join(__dirname, '.server.json');

function getRegistryFilePath() {
  try {
    if (!fs.existsSync(PRIMARY_REGISTRY_DIR)) {
      fs.mkdirSync(PRIMARY_REGISTRY_DIR, { recursive: true });
    }
    const testPath = path.join(PRIMARY_REGISTRY_DIR, `.access-test-${process.pid}`);
    fs.writeFileSync(testPath, '1');
    fs.unlinkSync(testPath);
    return PRIMARY_REGISTRY_FILE;
  } catch {
    return FALLBACK_REGISTRY_FILE;
  }
}

function readCentralRegistry() {
  let reg = {};
  try {
    if (fs.existsSync(PRIMARY_REGISTRY_FILE)) {
      reg = JSON.parse(fs.readFileSync(PRIMARY_REGISTRY_FILE, 'utf8'));
      return reg;
    }
  } catch {}
  try {
    if (fs.existsSync(FALLBACK_REGISTRY_FILE)) {
      reg = JSON.parse(fs.readFileSync(FALLBACK_REGISTRY_FILE, 'utf8'));
      return reg;
    }
  } catch {}
  try {
    const altFallback = path.join(os.tmpdir(), 'agy-taskboard-sessions.json');
    if (fs.existsSync(altFallback)) {
      reg = JSON.parse(fs.readFileSync(altFallback, 'utf8'));
      return reg;
    }
  } catch {}
  return reg;
}

function writeCentralRegistry(registry) {
  const content = JSON.stringify(registry, null, 2);
  try {
    if (!fs.existsSync(PRIMARY_REGISTRY_DIR)) {
      fs.mkdirSync(PRIMARY_REGISTRY_DIR, { recursive: true });
    }
    fs.writeFileSync(PRIMARY_REGISTRY_FILE, content, 'utf8');
  } catch {}
  try {
    fs.writeFileSync(FALLBACK_REGISTRY_FILE, content, 'utf8');
  } catch {}
  try {
    const altFallback = path.join(os.tmpdir(), 'agy-taskboard-sessions.json');
    fs.writeFileSync(altFallback, content, 'utf8');
  } catch {}
}

function updateProjectRegistration(projectName, projectDir, dbPath, port, pid) {
  const registry = readCentralRegistry();
  registry[projectName] = {
    projectName,
    projectDir,
    dbPath,
    port,
    url: `http://localhost:${port}`,
    pid,
    updatedAt: new Date().toISOString()
  };
  writeCentralRegistry(registry);

  try {
    fs.writeFileSync(LOCAL_SERVER_FILE, JSON.stringify({
      projectName,
      projectDir,
      dbPath,
      port,
      url: `http://localhost:${port}`,
      pid,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch {}
}

function cleanupRegistration(projectName) {
  try {
    const registry = readCentralRegistry();
    if (registry[projectName]) {
      delete registry[projectName];
      writeCentralRegistry(registry);
    }
    if (fs.existsSync(LOCAL_SERVER_FILE)) {
      fs.unlinkSync(LOCAL_SERVER_FILE);
    }
  } catch {}
}

// Reliable HTTP ping check for project liveness
async function pingProjectPort(port, expectedProjectName) {
  if (!port) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 400);
    const res = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (!expectedProjectName || data.projectName === expectedProjectName) {
        return true;
      }
    }
  } catch {}
  return false;
}

// Workspace auto-discovery to find sibling taskboard projects
function discoverWorkspaceProjects(currentProjectDir) {
  const discovered = [];
  const visited = new Set();

  const candidateRoots = [];
  let curr = currentProjectDir;
  for (let i = 0; i < 3; i++) {
    const parent = path.dirname(curr);
    if (parent && parent !== curr && !candidateRoots.includes(parent)) {
      candidateRoots.push(parent);
    }
    curr = parent;
  }

  function scanDir(dir, depth = 0, maxDepth = 2) {
    if (depth > maxDepth) return;
    if (visited.has(dir)) return;
    visited.add(dir);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (name.startsWith('.') || ['node_modules', 'dist', 'build', 'out', '.next', 'cache', 'scratch', 'temp', 'tmp'].includes(name)) continue;
        const fullPath = path.join(dir, name);

        if (fullPath.includes('/.agents') || fullPath.endsWith('/taskboard')) continue;

        const hasTaskboardDb = fs.existsSync(path.join(fullPath, '.agents/taskboard/tasks.sqlite'));
        const hasDirectDb = fs.existsSync(path.join(fullPath, 'tasks.sqlite'));
        const hasPlugin = fs.existsSync(path.join(fullPath, '.agents/plugins/antigravity-taskboard'));
        const hasPluginServer = fs.existsSync(path.join(fullPath, 'taskboard/server.mjs')) && fs.existsSync(path.join(fullPath, 'taskboard/board.html'));
        const hasLocalServer = fs.existsSync(path.join(fullPath, '.agents/taskboard/server.mjs'));

        if (hasTaskboardDb || hasDirectDb || hasPlugin || hasPluginServer || hasLocalServer) {
          const projectName = name;
          const dbPath = hasTaskboardDb 
            ? path.join(fullPath, '.agents/taskboard/tasks.sqlite')
            : (hasDirectDb ? path.join(fullPath, 'tasks.sqlite') : null);

          let savedPort = null;
          try {
            const sPath = path.join(fullPath, '.agents/taskboard/.server.json');
            if (fs.existsSync(sPath)) {
              const conf = JSON.parse(fs.readFileSync(sPath, 'utf8'));
              if (conf.port) savedPort = conf.port;
            }
          } catch {}

          discovered.push({
            projectName,
            projectDir: fullPath,
            dbPath,
            savedPort
          });
        }

        scanDir(fullPath, depth + 1, maxDepth);
      }
    } catch {}
  }

  for (const r of candidateRoots) {
    scanDir(r, 0, 2);
  }

  return discovered;
}

async function getActiveProjects(currentProjectName, currentPort) {
  const registry = readCentralRegistry();
  const info = getProjectInfo();
  let changed = false;

  // Run workspace discovery to identify sibling projects
  const discovered = discoverWorkspaceProjects(info.projectDir);
  for (const disc of discovered) {
    if (!registry[disc.projectName]) {
      let port = disc.savedPort;
      if (!port) {
        const usedPorts = new Set(Object.values(registry).map(p => p.port));
        usedPorts.add(currentPort);
        let candidate = 4040;
        while (usedPorts.has(candidate)) {
          candidate += 2;
        }
        port = candidate;
      }
      registry[disc.projectName] = {
        projectName: disc.projectName,
        projectDir: disc.projectDir,
        dbPath: disc.dbPath,
        port,
        url: `http://localhost:${port}`,
        pid: null,
        updatedAt: new Date().toISOString()
      };
      changed = true;
    }
  }

  const list = [];

  for (const [name, p] of Object.entries(registry)) {
    if (name.startsWith('.') || (p.projectName && p.projectName.startsWith('.')) || (p.projectDir && (p.projectDir.includes('/.agents') || !fs.existsSync(p.projectDir)))) {
      delete registry[name];
      changed = true;
      continue;
    }

    const isCurrent = (p.projectName || name) === currentProjectName || p.port === currentPort;
    let isAlive = false;

    if (isCurrent) {
      isAlive = true;
    } else {
      isAlive = await pingProjectPort(p.port, p.projectName || name);
      if (!isAlive && p.pid) {
        try {
          process.kill(p.pid, 0);
        } catch (e) {
          if (e.code === 'ESRCH') {
            p.pid = null;
            changed = true;
          }
        }
      }
    }

    list.push({
      projectName: p.projectName || name,
      port: p.port,
      url: p.url || `http://localhost:${p.port}`,
      projectDir: p.projectDir,
      status: isAlive ? 'online' : 'offline',
      isAlive,
      isCurrent
    });
  }

  if (changed) {
    writeCentralRegistry(registry);
  }

  if (!list.some(p => p.isCurrent)) {
    list.unshift({
      projectName: currentProjectName,
      port: currentPort,
      url: `http://localhost:${currentPort}`,
      projectDir: info.projectDir,
      status: 'online',
      isAlive: true,
      isCurrent: true
    });
  }

  list.sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  });

  return list;
}

function isPortAvailable(port, host = '0.0.0.0') {
  return new Promise(resolve => {
    const tester = http.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function findAvailablePort(startPort, host, projectInfo) {
  const isFree = await isPortAvailable(startPort, host);
  if (isFree) return startPort;

  try {
    const res = await fetch(`http://127.0.0.1:${startPort}/api/info`);
    if (res.ok) {
      const data = await res.json();
      if (data.projectName === projectInfo.projectName && data.dbPath === projectInfo.dbPath) {
        console.log(`ℹ️ Taskboard for "${projectInfo.projectName}" is already running on port ${startPort}.`);
        return startPort;
      }
    }
  } catch {}

  console.log(`⚠️ Port ${startPort} is already in use. Searching for next free port for "${projectInfo.projectName}"...`);
  for (let port = 4041; port <= 4099; port++) {
    const free = await isPortAvailable(port, host);
    if (free) {
      console.log(`✅ Discovered free port ${port} for project "${projectInfo.projectName}".`);
      return port;
    }
  }
  throw new Error('No available port found in range 4040-4099');
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', chunk => { 
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large (max 15MB)'));
        return;
      }
      body += chunk; 
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // Serve static board.html
  if (pathname === '/' || pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'board.html');
    if (!fs.existsSync(htmlPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('board.html not found');
    }
    let html = fs.readFileSync(htmlPath, 'utf-8');
    const { projectName } = getProjectInfo();
    html = html.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
    html = html.replace(/\{\{PROJECT_PORT\}\}/g, String(ACTIVE_PORT));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // Serve static done.html (Archive of all completed tasks)
  if (pathname === '/done' || pathname === '/archive' || pathname === '/completed') {
    const htmlPath = path.join(__dirname, 'done.html');
    if (!fs.existsSync(htmlPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('done.html not found');
    }
    let html = fs.readFileSync(htmlPath, 'utf-8');
    const { projectName } = getProjectInfo();
    html = html.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
    html = html.replace(/\{\{PROJECT_PORT\}\}/g, String(ACTIVE_PORT));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // Serve repository files, docs, and code viewer: /repo/*, /files/*, /view/*
  if (pathname === '/repo' || pathname.startsWith('/repo/') || 
      pathname === '/files' || pathname.startsWith('/files/') || 
      pathname === '/view' || pathname.startsWith('/view/')) {
    return handleRepoRequest(req, res, pathname, urlObj);
  }

  // REST API: GET /api/info
  if (pathname === '/api/info' && req.method === 'GET') {
    return sendJson(res, 200, { 
      success: true, 
      ...getProjectInfo(),
      port: ACTIVE_PORT,
      url: `http://localhost:${ACTIVE_PORT}`
    });
  }

  // REST API: GET /api/projects - Multi-project registry
  if (pathname === '/api/projects' && req.method === 'GET') {
    const info = getProjectInfo();
    const projects = await getActiveProjects(info.projectName, ACTIVE_PORT);
    return sendJson(res, 200, {
      success: true,
      currentProject: info.projectName,
      currentPort: ACTIVE_PORT,
      projects
    });
  }

  // REST API: POST /api/projects/start - Auto-boot an offline project taskboard server
  if (pathname === '/api/projects/start' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const targetName = body.projectName;
      if (!targetName) {
        return sendJson(res, 400, { success: false, error: 'Project name is required' });
      }

      const registry = readCentralRegistry();
      let project = registry[targetName];

      if (!project) {
        const info = getProjectInfo();
        const discList = discoverWorkspaceProjects(info.projectDir);
        const match = discList.find(p => p.projectName === targetName);
        if (match) {
          project = {
            projectName: match.projectName,
            projectDir: match.projectDir,
            dbPath: match.dbPath,
            port: match.savedPort || (ACTIVE_PORT === 4040 ? 4042 : 4040),
            url: `http://localhost:${match.savedPort || (ACTIVE_PORT === 4040 ? 4042 : 4040)}`,
            pid: null,
            updatedAt: new Date().toISOString()
          };
          registry[targetName] = project;
        }
      }

      if (!project || !project.projectDir || !fs.existsSync(project.projectDir)) {
        return sendJson(res, 404, { success: false, error: `Project directory for "${targetName}" not found` });
      }

      function resolveServerScript(pDir) {
        const candidates = [
          path.join(pDir, '.agents', 'taskboard', 'server.mjs'),
          path.join(pDir, '.agents', 'plugins', 'antigravity-taskboard', 'taskboard', 'server.mjs'),
          path.join(pDir, 'taskboard', 'server.mjs'),
          path.join(pDir, 'server.mjs')
        ];
        for (const cand of candidates) {
          if (fs.existsSync(cand)) return cand;
        }
        const tbDir = path.join(pDir, '.agents', 'taskboard');
        if (fs.existsSync(tbDir)) {
          try {
            fs.copyFileSync(path.join(__dirname, 'server.mjs'), path.join(tbDir, 'server.mjs'));
            fs.copyFileSync(path.join(__dirname, 'board.html'), path.join(tbDir, 'board.html'));
            if (fs.existsSync(path.join(__dirname, 'done.html'))) {
              fs.copyFileSync(path.join(__dirname, 'done.html'), path.join(tbDir, 'done.html'));
            }
            fs.copyFileSync(path.join(__dirname, 'repo_viewer.mjs'), path.join(tbDir, 'repo_viewer.mjs'));
            if (fs.existsSync(path.join(__dirname, 'tasks.mjs')) && !fs.existsSync(path.join(tbDir, 'tasks.mjs'))) {
              fs.copyFileSync(path.join(__dirname, 'tasks.mjs'), path.join(tbDir, 'tasks.mjs'));
            }
            return path.join(tbDir, 'server.mjs');
          } catch {}
        }
        return null;
      }

      const scriptPath = resolveServerScript(project.projectDir);
      if (!scriptPath) {
        return sendJson(res, 500, { success: false, error: `No taskboard server script found for "${targetName}"` });
      }

      const targetPort = project.port || 4042;
      const isAlreadyUp = await pingProjectPort(targetPort, project.projectName);
      if (isAlreadyUp) {
        return sendJson(res, 200, {
          success: true,
          projectName: project.projectName,
          port: targetPort,
          url: `http://localhost:${targetPort}`,
          alreadyRunning: true
        });
      }

      const assignedPort = await findAvailablePort(targetPort, HOST, project);

      const doraNodeModules = path.resolve(__dirname, '../../node_modules');
      const nodePath = [
        path.join(project.projectDir, 'node_modules'),
        doraNodeModules,
        process.env.NODE_PATH || ''
      ].filter(Boolean).join(':');

      function ensureDependencies(targetDir) {
        const targetNm = path.join(targetDir, 'node_modules');
        const targetSqlite = path.join(targetNm, 'better-sqlite3');
        if (!fs.existsSync(targetSqlite)) {
          const knownSources = [
            path.resolve(__dirname, '../../node_modules/better-sqlite3'),
            path.resolve(__dirname, '../node_modules/better-sqlite3'),
            path.resolve(__dirname, 'node_modules/better-sqlite3'),
            '/Users/sg/Documents/workspace/svylabs/vindoralabs/doraapp/node_modules/better-sqlite3',
            '/Users/sg/Documents/workspace/svylabs/antigravity-taskboard/node_modules/better-sqlite3'
          ];
          for (const src of knownSources) {
            if (fs.existsSync(src)) {
              try {
                if (!fs.existsSync(targetNm)) {
                  fs.mkdirSync(targetNm, { recursive: true });
                }
                fs.symlinkSync(src, targetSqlite, 'dir');
                break;
              } catch (e) {
                try {
                  fs.cpSync(src, targetSqlite, { recursive: true });
                  break;
                } catch {}
              }
            }
          }
        }
      }

      ensureDependencies(project.projectDir);

      console.log(`🚀 Auto-booting taskboard for "${project.projectName}" on port ${assignedPort}...`);
      const child = spawn(process.execPath, [scriptPath, '--port', String(assignedPort)], {
        cwd: project.projectDir,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          TASKBOARD_PORT: String(assignedPort),
          NODE_PATH: nodePath
        }
      });
      child.unref();

      let launched = false;
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (await pingProjectPort(assignedPort, project.projectName)) {
          launched = true;
          break;
        }
      }

      project.port = assignedPort;
      project.url = `http://localhost:${assignedPort}`;
      project.pid = child.pid;
      project.updatedAt = new Date().toISOString();
      writeCentralRegistry(registry);

      return sendJson(res, 200, {
        success: true,
        projectName: project.projectName,
        port: assignedPort,
        url: `http://localhost:${assignedPort}`,
        launched
      });
    } catch (e) {
      console.error('Failed to start project taskboard:', e);
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // REST API: GET /api/tasks
  if (pathname === '/api/tasks' && req.method === 'GET') {
    const tasks = getAllTasks();
    return sendJson(res, 200, { success: true, tasks, project: getProjectInfo().projectName });
  }

  // REST API: POST /api/tasks
  if (pathname === '/api/tasks' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.title) {
        return sendJson(res, 400, { success: false, error: 'Title is required' });
      }
      const task = addTask(body);
      return sendJson(res, 201, { success: true, task });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: GET /api/tasks/:id/comments
  const commentsGetMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments$/);
  if (commentsGetMatch && req.method === 'GET') {
    const taskId = commentsGetMatch[1];
    const comments = getComments(taskId);
    return sendJson(res, 200, { success: true, comments });
  }

  // REST API: POST /api/tasks/:id/comments
  const commentsPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/comments$/);
  if (commentsPostMatch && req.method === 'POST') {
    const taskId = commentsPostMatch[1];
    try {
      const body = await parseBody(req);
      const comment = addComment(taskId, body);
      return sendJson(res, 201, { success: true, comment });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: DELETE /api/comments/:id
  const commentDeleteMatch = pathname.match(/^\/api\/comments\/([^/]+)$/);
  if (commentDeleteMatch && req.method === 'DELETE') {
    const commentId = commentDeleteMatch[1];
    deleteComment(commentId);
    return sendJson(res, 200, { success: true, deleted: commentId });
  }

  // REST API: PATCH /api/comments/:id
  const commentPatchMatch = pathname.match(/^\/api\/comments\/([^/]+)$/);
  if (commentPatchMatch && req.method === 'PATCH') {
    const commentId = commentPatchMatch[1];
    try {
      const body = await parseBody(req);
      const updated = updateComment(commentId, body.content);
      return sendJson(res, 200, { success: true, comment: updated });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: GET /api/tasks/:id/subtasks
  const subtasksGetMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/subtasks$/);
  if (subtasksGetMatch && req.method === 'GET') {
    const taskId = subtasksGetMatch[1];
    const subtasks = getSubtasks(taskId);
    return sendJson(res, 200, { success: true, subtasks });
  }

  // REST API: POST /api/tasks/:id/subtasks
  const subtasksPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/subtasks$/);
  if (subtasksPostMatch && req.method === 'POST') {
    const taskId = subtasksPostMatch[1];
    try {
      const body = await parseBody(req);
      const subtask = addSubtask(taskId, body);
      return sendJson(res, 201, { success: true, subtask });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: PATCH /api/subtasks/:id
  const subtaskPatchMatch = pathname.match(/^\/api\/subtasks\/([^/]+)$/);
  if (subtaskPatchMatch && req.method === 'PATCH') {
    const subtaskId = subtaskPatchMatch[1];
    try {
      const body = await parseBody(req);
      const updated = updateSubtask(subtaskId, body);
      return sendJson(res, 200, { success: true, subtask: updated });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: DELETE /api/subtasks/:id
  const subtaskDeleteMatch = pathname.match(/^\/api\/subtasks\/([^/]+)$/);
  if (subtaskDeleteMatch && req.method === 'DELETE') {
    const subtaskId = subtaskDeleteMatch[1];
    deleteSubtask(subtaskId);
    return sendJson(res, 200, { success: true, deleted: subtaskId });
  }

  // REST API: GET /api/tasks/:id
  const taskGetMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskGetMatch && req.method === 'GET') {
    const id = taskGetMatch[1];
    const task = getTaskById(id);
    if (!task) {
      return sendJson(res, 404, { success: false, error: 'Task not found' });
    }
    task.subtasks = getSubtasks(id);
    return sendJson(res, 200, { success: true, task });
  }

  // REST API: PATCH /api/tasks/:id
  const patchMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    const id = patchMatch[1];
    try {
      const body = await parseBody(req);
      const updated = updateTask(id, body);
      return sendJson(res, 200, { success: true, task: updated });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: DELETE /api/tasks/:id
  const deleteMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const id = deleteMatch[1];
    deleteTask(id);
    return sendJson(res, 200, { success: true, deleted: id });
  }

  // REST API: GET /api/tasks/:id/attachments or /images
  const taskAttachmentsGetMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/(images|attachments)$/);
  if (taskAttachmentsGetMatch && req.method === 'GET') {
    const taskId = taskAttachmentsGetMatch[1];
    const attachments = getAttachments(taskId);
    return sendJson(res, 200, { success: true, attachments });
  }

  // REST API: POST /api/tasks/:id/attachments or /images
  const taskAttachmentsPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/(images|attachments)$/);
  if (taskAttachmentsPostMatch && req.method === 'POST') {
    const taskId = taskAttachmentsPostMatch[1];
    try {
      const body = await parseBody(req);
      let { fileName, mimeType, dataBase64, data } = body;
      const rawBase64 = dataBase64 || data;
      if (!rawBase64) {
        return sendJson(res, 400, { success: false, error: 'File data (dataBase64) is required' });
      }

      let cleanBase64 = rawBase64;
      const commaIdx = cleanBase64.indexOf(',');
      if (commaIdx !== -1 && cleanBase64.slice(0, commaIdx).includes('base64')) {
        const header = cleanBase64.slice(0, commaIdx);
        if (!mimeType) {
          const m = header.match(/data:([^;]+)/);
          if (m) mimeType = m[1];
        }
        cleanBase64 = cleanBase64.slice(commaIdx + 1);
      }

      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length === 0) {
        return sendJson(res, 400, { success: false, error: 'Empty file data' });
      }
      if (buffer.length > 10 * 1024 * 1024) {
        return sendJson(res, 413, { success: false, error: 'File size exceeds 10MB limit' });
      }

      const attachment = addAttachment(taskId, {
        fileName: fileName || `attachment_${Date.now()}.bin`,
        mimeType: mimeType || 'application/octet-stream',
        buffer
      });
      return sendJson(res, 201, { success: true, attachment });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: GET/HEAD /api/attachments/:id or /images/:id
  const attachmentGetMatch = pathname.match(/^\/api\/(images|attachments)\/([^/]+)$/);
  if (attachmentGetMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    const attachmentId = attachmentGetMatch[2];
    const attachment = getAttachment(attachmentId);
    if (!attachment) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Attachment not found');
    }
    const isDownload = url.searchParams.get('download') === '1';
    const disposition = isDownload ? 'attachment' : 'inline';
    res.writeHead(200, {
      'Content-Type': attachment.mime_type || 'application/octet-stream',
      'Content-Length': attachment.data.length,
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(attachment.file_name)}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') {
      return res.end();
    }
    return res.end(attachment.data);
  }

  // REST API: DELETE /api/attachments/:id or /images/:id
  const attachmentDeleteMatch = pathname.match(/^\/api\/(images|attachments)\/([^/]+)$/);
  if (attachmentDeleteMatch && req.method === 'DELETE') {
    const attachmentId = attachmentDeleteMatch[2];
    deleteAttachment(attachmentId);
    return sendJson(res, 200, { success: true, deleted: attachmentId });
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function getNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

async function startServer() {
  const info = getProjectInfo();
  ACTIVE_PORT = await findAvailablePort(REQUESTED_PORT, HOST, info);
  const netIp = getNetworkIp();

  server.listen(ACTIVE_PORT, HOST, () => {
    updateProjectRegistration(info.projectName, info.projectDir, info.dbPath, ACTIVE_PORT, process.pid);
    console.log(`\n=============================================================`);
    console.log(`📋 Antigravity Task Board Plugin`);
    console.log(`📁 Project:  ${info.projectName}`);
    console.log(`🗄️ Database: ${info.dbPath}`);
    console.log(`🌐 Bound to: http://${HOST}:${ACTIVE_PORT}`);
    console.log(`👉 Local:    http://localhost:${ACTIVE_PORT}`);
    console.log(`👉 Network:  http://${netIp}:${ACTIVE_PORT}`);
    console.log(`=============================================================\n`);
  });

  const onExit = () => {
    cleanupRegistration(info.projectName);
    process.exit(0);
  };
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);
}

startServer().catch(err => {
  console.error(`❌ Failed to start taskboard server:`, err);
  process.exit(1);
});
