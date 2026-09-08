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

const PORT = process.env.TASKBOARD_PORT || 4040;
const HOST = process.env.TASKBOARD_HOST || process.env.HOST || '0.0.0.0';

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
    html = html.replace('{{PROJECT_NAME}}', projectName);
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
    return sendJson(res, 200, { success: true, ...getProjectInfo() });
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

const info = getProjectInfo();
const netIp = getNetworkIp();

server.listen(PORT, HOST, () => {
  console.log(`\n=============================================================`);
  console.log(`📋 Antigravity Task Board Plugin`);
  console.log(`📁 Project:  ${info.projectName}`);
  console.log(`🗄️ Database: ${info.dbPath}`);
  console.log(`🌐 Bound to: http://${HOST}:${PORT}`);
  console.log(`👉 Local:    http://localhost:${PORT}`);
  console.log(`👉 Network:  http://${netIp}:${PORT}`);
  console.log(`=============================================================\n`);
});
