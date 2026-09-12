#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
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
  try {
    if (fs.existsSync(PRIMARY_REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(PRIMARY_REGISTRY_FILE, 'utf8'));
    }
  } catch {}
  try {
    if (fs.existsSync(FALLBACK_REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(FALLBACK_REGISTRY_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function writeCentralRegistry(registry) {
  const filePath = getRegistryFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf8');
  } catch {}
  if (filePath !== PRIMARY_REGISTRY_FILE) {
    try {
      fs.writeFileSync(PRIMARY_REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf8');
    } catch {}
  }
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

function getActiveProjects(currentProjectName, currentPort) {
  const registry = readCentralRegistry();
  const list = [];
  let changed = false;

  for (const [name, p] of Object.entries(registry)) {
    // If the project directory was deleted from disk, clean up from registry
    if (p.projectDir && !fs.existsSync(p.projectDir)) {
      delete registry[name];
      changed = true;
      continue;
    }

    let isAlive = true;
    if (p.pid && p.pid !== process.pid) {
      try {
        process.kill(p.pid, 0);
      } catch (e) {
        if (e.code === 'ESRCH') {
          isAlive = false;
        } else {
          // EPERM or other error means process exists but running under different permission
          isAlive = true;
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
      isCurrent: (p.projectName || name) === currentProjectName || p.port === currentPort
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
      status: 'online',
      isAlive: true,
      isCurrent: true
    });
  }

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
    const projects = getActiveProjects(info.projectName, ACTIVE_PORT);
    return sendJson(res, 200, {
      success: true,
      currentProject: info.projectName,
      currentPort: ACTIVE_PORT,
      projects
    });
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

  // REST API: GET /api/tasks/:id/images
  const taskImagesGetMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/images$/);
  if (taskImagesGetMatch && req.method === 'GET') {
    const taskId = taskImagesGetMatch[1];
    const attachments = getAttachments(taskId);
    return sendJson(res, 200, { success: true, attachments });
  }

  // REST API: POST /api/tasks/:id/images
  const taskImagesPostMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/images$/);
  if (taskImagesPostMatch && req.method === 'POST') {
    const taskId = taskImagesPostMatch[1];
    try {
      const body = await parseBody(req);
      let { fileName, mimeType, dataBase64, data } = body;
      const rawBase64 = dataBase64 || data;
      if (!rawBase64) {
        return sendJson(res, 400, { success: false, error: 'Image data (dataBase64) is required' });
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
        return sendJson(res, 400, { success: false, error: 'Empty image data' });
      }
      if (buffer.length > 10 * 1024 * 1024) {
        return sendJson(res, 413, { success: false, error: 'Image size exceeds 10MB limit' });
      }

      const attachment = addAttachment(taskId, {
        fileName: fileName || `screenshot_${Date.now()}.png`,
        mimeType: mimeType || 'image/png',
        buffer
      });
      return sendJson(res, 201, { success: true, attachment });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }

  // REST API: GET/HEAD /api/images/:id
  const imageGetMatch = pathname.match(/^\/api\/images\/([^/]+)$/);
  if (imageGetMatch && (req.method === 'GET' || req.method === 'HEAD')) {
    const imageId = imageGetMatch[1];
    const attachment = getAttachment(imageId);
    if (!attachment) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Image not found');
    }
    res.writeHead(200, {
      'Content-Type': attachment.mime_type || 'image/png',
      'Content-Length': attachment.data.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') {
      return res.end();
    }
    return res.end(attachment.data);
  }

  // REST API: DELETE /api/images/:id
  const imageDeleteMatch = pathname.match(/^\/api\/images\/([^/]+)$/);
  if (imageDeleteMatch && req.method === 'DELETE') {
    const imageId = imageDeleteMatch[1];
    deleteAttachment(imageId);
    return sendJson(res, 200, { success: true, deleted: imageId });
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
