import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getRepoRoot() {
  if (process.env.TASKBOARD_REPO_ROOT) return path.resolve(process.env.TASKBOARD_REPO_ROOT);
  
  let curr = process.cwd();
  while (curr !== path.parse(curr).root) {
    if (fs.existsSync(path.join(curr, '.git')) || fs.existsSync(path.join(curr, 'package.json'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }

  curr = __dirname;
  while (curr !== path.parse(curr).root) {
    if (fs.existsSync(path.join(curr, '.git')) || (fs.existsSync(path.join(curr, 'package.json')) && !curr.endsWith('.agents'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }

  return process.cwd();
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.sql': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

export function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderBreadcrumbs(repoName, relPath, isDir = false) {
  const parts = relPath ? relPath.split('/').filter(Boolean) : [];
  let html = `<a href="/repo" class="crumb-link">📁 ${escapeHtml(repoName)}</a>`;
  let accum = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    accum += (accum ? '/' : '') + part;
    const isLast = i === parts.length - 1;
    html += ` <span class="crumb-sep">/</span> `;
    if (isLast && !isDir) {
      html += `<span class="crumb-current">📄 ${escapeHtml(part)}</span>`;
    } else {
      html += `<a href="/repo/${accum}" class="crumb-link">${isLast && isDir ? '📁 ' + escapeHtml(part) : escapeHtml(part)}</a>`;
    }
  }

  return html;
}

function getCommonStyles() {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #F8FAFC;
      color: #0F172A;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    header.repo-header {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid #E2E8F0;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
      overflow: hidden;
      white-space: nowrap;
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #EDE9FE;
      color: #7C3AED;
      font-weight: 600;
      font-size: 13px;
      padding: 6px 12px;
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }
    .back-btn:hover {
      background: #DDD6FE;
      transform: translateY(-1px);
    }
    .crumb-container {
      font-size: 13px;
      color: #64748B;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .crumb-link {
      color: #475569;
      text-decoration: none;
      font-weight: 500;
    }
    .crumb-link:hover {
      color: #7C3AED;
      text-decoration: underline;
    }
    .crumb-sep {
      color: #94A3B8;
      margin: 0 4px;
    }
    .crumb-current {
      color: #0F172A;
      font-weight: 600;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      color: #334155;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 6px;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-action:hover {
      background: #F1F5F9;
      border-color: #94A3B8;
      color: #0F172A;
    }
    .container {
      max-width: 1100px;
      margin: 28px auto;
      padding: 0 20px;
    }
    .viewer-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .viewer-meta-bar {
      padding: 10px 16px;
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: #64748B;
    }
    .meta-tags {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .meta-tag {
      background: #EDE9FE;
      color: #7C3AED;
      padding: 2px 8px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 11px;
    }
    /* Markdown Styles */
    .markdown-body {
      padding: 32px 40px;
      font-size: 15px;
      line-height: 1.7;
      color: #1E293B;
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
      color: #0F172A;
      margin-top: 24px;
      margin-bottom: 12px;
      font-weight: 700;
      line-height: 1.3;
    }
    .markdown-body h1 { font-size: 26px; border-bottom: 1px solid #E2E8F0; padding-bottom: 10px; margin-top: 0; }
    .markdown-body h2 { font-size: 20px; border-bottom: 1px solid #F1F5F9; padding-bottom: 6px; }
    .markdown-body h3 { font-size: 17px; }
    .markdown-body h4 { font-size: 15px; }
    .markdown-body p { margin-bottom: 16px; }
    .markdown-body ul, .markdown-body ol {
      margin-bottom: 16px;
      padding-left: 28px;
    }
    .markdown-body li { margin-bottom: 6px; }
    .markdown-body a { color: #7C3AED; text-decoration: underline; text-underline-offset: 3px; }
    .markdown-body a:hover { color: #6D28D9; }
    .markdown-body code {
      background: #F1F5F9;
      color: #7C3AED;
      border: 1px solid #E2E8F0;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
    }
    .markdown-body pre {
      background: #0F172A;
      color: #F8FAFC;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      margin-bottom: 18px;
      line-height: 1.5;
    }
    .markdown-body pre code {
      background: transparent;
      border: none;
      color: inherit;
      padding: 0;
      font-size: 13px;
    }
    .markdown-body blockquote {
      border-left: 4px solid #7C3AED;
      background: #FAF5FF;
      padding: 12px 18px;
      border-radius: 0 8px 8px 0;
      color: #4C1D95;
      margin-bottom: 16px;
    }
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid #E2E8F0;
      padding: 10px 14px;
      text-align: left;
    }
    .markdown-body th {
      background: #F8FAFC;
      font-weight: 600;
      color: #0F172A;
    }
    .markdown-body tr:nth-child(even) td {
      background: #FDFEFE;
    }
    .markdown-body hr {
      border: none;
      border-top: 1px solid #E2E8F0;
      margin: 28px 0;
    }
    /* Code Viewer Styles */
    .code-container {
      display: flex;
      background: #0F172A;
      color: #F8FAFC;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
      overflow-x: auto;
    }
    .line-numbers {
      user-select: none;
      text-align: right;
      padding: 16px 12px;
      color: #475569;
      background: #090D16;
      border-right: 1px solid #1E293B;
      font-size: 12px;
    }
    .code-lines {
      padding: 16px;
      white-space: pre;
      overflow-x: auto;
      flex-grow: 1;
    }
    /* Directory Table Styles */
    .dir-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .dir-table th, .dir-table td {
      padding: 12px 18px;
      border-bottom: 1px solid #F1F5F9;
      text-align: left;
    }
    .dir-table th {
      background: #F8FAFC;
      font-weight: 600;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .dir-table tr:hover td {
      background: #F8FAFC;
    }
    .dir-entry-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #0F172A;
      text-decoration: none;
      font-weight: 500;
    }
    .dir-entry-link:hover {
      color: #7C3AED;
    }
    .dir-filter-bar {
      padding: 12px 18px;
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .dir-filter-input {
      padding: 6px 12px;
      font-size: 13px;
      border: 1px solid #CBD5E1;
      border-radius: 6px;
      outline: none;
      width: 260px;
    }
    .dir-filter-input:focus {
      border-color: #7C3AED;
      box-shadow: 0 0 0 2px #DDD6FE;
    }
    @media (max-width: 640px) {
      .markdown-body { padding: 20px 16px; }
      header.repo-header { padding: 10px 14px; }
      .container { padding: 0 10px; margin: 16px auto; }
    }
  `;
}

export function renderMarkdownViewer({ relPath, fileName, content, repoName, stat }) {
  const breadcrumbsHtml = renderBreadcrumbs(repoName, relPath, false);
  const sizeStr = formatBytes(stat.size);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)} - ${escapeHtml(repoName)}</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <header class="repo-header">
    <div class="header-left">
      <a href="/" class="back-btn" title="Return to Taskboard">← Taskboard</a>
      <div class="crumb-container">${breadcrumbsHtml}</div>
    </div>
    <div class="header-right">
      <button class="btn-action" id="copyPathBtn" onclick="copyPath('${escapeHtml(relPath)}')">📋 Copy Path</button>
      <a href="/repo/${escapeHtml(relPath)}?raw=true" class="btn-action" target="_blank">📄 Raw</a>
    </div>
  </header>

  <div class="container">
    <div class="viewer-card">
      <div class="viewer-meta-bar">
        <div class="meta-tags">
          <span class="meta-tag">Markdown</span>
          <span>${sizeStr}</span>
        </div>
        <div>Last modified: ${formatDate(stat.mtime)}</div>
      </div>
      <div id="markdownContent" class="markdown-body">
        <div style="color: #94A3B8; text-align: center; padding: 20px;">Rendering document...</div>
      </div>
    </div>
  </div>

  <script id="rawSource" type="text/markdown">${escapeHtml(content)}</script>
  <script>
    function copyPath(text) {
      navigator.clipboard.writeText(text);
      const btn = document.getElementById('copyPathBtn');
      const original = btn.innerText;
      btn.innerText = '✅ Copied!';
      setTimeout(() => { btn.innerText = original; }, 2000);
    }

    (function() {
      const raw = document.getElementById('rawSource').textContent;
      const target = document.getElementById('markdownContent');
      if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        try {
          target.innerHTML = marked.parse(raw, { breaks: true, gfm: true });
        } catch (e) {
          target.innerText = raw;
        }
      } else {
        target.innerText = raw;
      }
    })();
  </script>
</body>
</html>`;
}

export function renderCodeViewer({ relPath, fileName, content, repoName, stat, ext }) {
  const breadcrumbsHtml = renderBreadcrumbs(repoName, relPath, false);
  const sizeStr = formatBytes(stat.size);
  const lines = content.split('\n');
  const lineCount = lines.length;
  const lineNumsHtml = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  const escapedContent = escapeHtml(content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)} - ${escapeHtml(repoName)}</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <header class="repo-header">
    <div class="header-left">
      <a href="/" class="back-btn" title="Return to Taskboard">← Taskboard</a>
      <div class="crumb-container">${breadcrumbsHtml}</div>
    </div>
    <div class="header-right">
      <button class="btn-action" id="copyPathBtn" onclick="copyPath('${escapeHtml(relPath)}')">📋 Copy Path</button>
      <button class="btn-action" id="copyCodeBtn" onclick="copyCode()">📋 Copy Code</button>
      <a href="/repo/${escapeHtml(relPath)}?raw=true" class="btn-action" target="_blank">📄 Raw</a>
    </div>
  </header>

  <div class="container">
    <div class="viewer-card">
      <div class="viewer-meta-bar">
        <div class="meta-tags">
          <span class="meta-tag">${escapeHtml(ext.replace('.', '').toUpperCase() || 'CODE')}</span>
          <span>${lineCount} lines</span>
          <span>${sizeStr}</span>
        </div>
        <div>Last modified: ${formatDate(stat.mtime)}</div>
      </div>
      <div class="code-container">
        <div class="line-numbers">${lineNumsHtml}</div>
        <div class="code-lines" id="codeText">${escapedContent}</div>
      </div>
    </div>
  </div>

  <script>
    function copyPath(text) {
      navigator.clipboard.writeText(text);
      const btn = document.getElementById('copyPathBtn');
      const original = btn.innerText;
      btn.innerText = '✅ Copied!';
      setTimeout(() => { btn.innerText = original; }, 2000);
    }

    function copyCode() {
      const code = document.getElementById('codeText').innerText;
      navigator.clipboard.writeText(code);
      const btn = document.getElementById('copyCodeBtn');
      const original = btn.innerText;
      btn.innerText = '✅ Code Copied!';
      setTimeout(() => { btn.innerText = original; }, 2000);
    }
  </script>
</body>
</html>`;
}

export function renderDirectoryViewer({ relPath, dirName, entries, repoName, isRoot }) {
  const breadcrumbsHtml = renderBreadcrumbs(repoName, relPath, true);
  const dirCount = entries.filter(e => e.isDirectory).length;
  const fileCount = entries.filter(e => !e.isDirectory).length;

  let rowsHtml = '';
  if (!isRoot) {
    const parentRel = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
    rowsHtml += `
      <tr>
        <td colspan="4">
          <a href="/repo/${parentRel ? escapeHtml(parentRel) : ''}" class="dir-entry-link" style="color: #64748B;">
            📁 <b>.. (Parent Directory)</b>
          </a>
        </td>
      </tr>
    `;
  }

  for (const ent of entries) {
    const entRel = relPath ? `${relPath}/${ent.name}` : ent.name;
    const icon = ent.isDirectory 
      ? '📁' 
      : (ent.name.endsWith('.md') ? '📝' : (/\.(js|mjs|ts|tsx|jsx|json|sql|sh|html|css)$/i.test(ent.name) ? '⚙️' : (/\.(png|jpg|jpeg|svg|webp|gif)$/i.test(ent.name) ? '🖼️' : '📄')));
    const sizeStr = ent.isDirectory ? '-' : formatBytes(ent.size);

    rowsHtml += `
      <tr class="entry-row" data-name="${escapeHtml(ent.name.toLowerCase())}">
        <td>
          <a href="/repo/${escapeHtml(entRel)}" class="dir-entry-link">
            <span>${icon}</span>
            <span>${escapeHtml(ent.name)}</span>
          </a>
        </td>
        <td><span class="meta-tag" style="background:#F1F5F9; color:#475569;">${ent.isDirectory ? 'DIR' : 'FILE'}</span></td>
        <td style="color: #64748B;">${sizeStr}</td>
        <td style="color: #94A3B8;">${formatDate(ent.mtime)}</td>
      </tr>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(dirName || repoName)} - Repository Browser</title>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <header class="repo-header">
    <div class="header-left">
      <a href="/" class="back-btn" title="Return to Taskboard">← Taskboard</a>
      <div class="crumb-container">${breadcrumbsHtml}</div>
    </div>
    <div class="header-right">
      <button class="btn-action" id="copyPathBtn" onclick="copyPath('${escapeHtml(relPath || '.')}')">📋 Copy Path</button>
    </div>
  </header>

  <div class="container">
    <div class="viewer-card">
      <div class="dir-filter-bar">
        <input type="text" id="filterInput" class="dir-filter-input" placeholder="🔍 Filter files in folder..." oninput="filterEntries()">
        <span style="font-size: 12px; color: #64748B;">${dirCount} directories, ${fileCount} files</span>
      </div>
      <table class="dir-table">
        <thead>
          <tr>
            <th>Name</th>
            <th style="width: 90px;">Type</th>
            <th style="width: 110px;">Size</th>
            <th style="width: 180px;">Modified</th>
          </tr>
        </thead>
        <tbody id="entriesBody">
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function copyPath(text) {
      navigator.clipboard.writeText(text);
      const btn = document.getElementById('copyPathBtn');
      const original = btn.innerText;
      btn.innerText = '✅ Copied!';
      setTimeout(() => { btn.innerText = original; }, 2000);
    }

    function filterEntries() {
      const q = document.getElementById('filterInput').value.toLowerCase().trim();
      const rows = document.querySelectorAll('.entry-row');
      rows.forEach(r => {
        const name = r.getAttribute('data-name') || '';
        r.style.display = name.includes(q) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

export function renderErrorPage(status, message, repoName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${status} - Taskboard Repo</title>
  <style>
    ${getCommonStyles()}
    .error-box {
      max-width: 500px;
      margin: 80px auto;
      background: #FFFFFF;
      padding: 36px 30px;
      border-radius: 12px;
      border: 1px solid #E2E8F0;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    .error-code { font-size: 48px; font-weight: 800; color: #7C3AED; line-height: 1; margin-bottom: 12px; }
    .error-msg { font-size: 15px; color: #475569; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="error-box">
    <div class="error-code">${status}</div>
    <div class="error-msg">${escapeHtml(message)}</div>
    <div style="display: flex; gap: 10px; justify-content: center;">
      <a href="/" class="back-btn">← Back to Taskboard</a>
      <a href="/repo" class="btn-action">📁 Browse Repository</a>
    </div>
  </div>
</body>
</html>`;
}

export function handleRepoRequest(req, res, pathname, urlObj) {
  const repoRoot = getRepoRoot();
  const repoName = path.basename(repoRoot);

  const rawRel = pathname.replace(/^\/(repo|files|view)\/?/, '');
  const cleanRel = decodeURIComponent(rawRel).replace(/^\/+/, '');
  const targetPath = cleanRel ? path.resolve(repoRoot, cleanRel) : repoRoot;

  if (!targetPath.startsWith(repoRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderErrorPage(403, 'Access denied: Path traversal outside repository root.', repoName));
  }

  const relFromRoot = path.relative(repoRoot, targetPath);
  const parts = relFromRoot.split(path.sep);
  const baseName = path.basename(targetPath);
  
  const isRestricted = 
    parts.some(p => p === '.git') ||
    (baseName.startsWith('.env') && !baseName.includes('.example') && !baseName.includes('.template')) ||
    baseName.startsWith('tasks.sqlite') ||
    /\.(key|pem|p12|id_rsa)$/i.test(baseName);

  if (isRestricted) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderErrorPage(403, 'Access to this file or directory is restricted for security.', repoName));
  }

  if (!fs.existsSync(targetPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderErrorPage(404, `File or directory "${cleanRel}" not found in repository.`, repoName));
  }

  const stat = fs.statSync(targetPath);

  if (stat.isDirectory()) {
    try {
      const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true });
      const entries = [];
      for (const ent of dirEntries) {
        if (ent.name === '.git' || ent.name === '.DS_Store' || (ent.name.startsWith('.env') && !ent.name.includes('.example'))) {
          continue;
        }
        try {
          const itemStat = fs.statSync(path.join(targetPath, ent.name));
          entries.push({
            name: ent.name,
            isDirectory: ent.isDirectory(),
            size: itemStat.size,
            mtime: itemStat.mtime
          });
        } catch (err) {}
      }

      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      const html = renderDirectoryViewer({
        relPath: cleanRel,
        dirName: path.basename(targetPath),
        entries,
        repoName,
        isRoot: targetPath === repoRoot
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderErrorPage(500, `Failed to read directory: ${e.message}`, repoName));
    }
  }

  const isRaw = urlObj.searchParams.get('raw') === 'true' || req.headers.accept?.includes('application/octet-stream');
  const mimeType = getMimeType(targetPath);
  const ext = path.extname(targetPath).toLowerCase();

  const isBinaryOrMedia = /\.(png|jpg|jpeg|gif|svg|webp|ico|pdf|woff2|woff|ttf|eot)$/i.test(ext);
  if (isRaw || isBinaryOrMedia) {
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    const stream = fs.createReadStream(targetPath);
    return stream.pipe(res);
  }

  let fileContent = '';
  try {
    fileContent = fs.readFileSync(targetPath, 'utf-8');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderErrorPage(500, `Unable to read file: ${err.message}`, repoName));
  }

  if (ext === '.md' || ext === '.markdown') {
    const html = renderMarkdownViewer({
      relPath: cleanRel,
      fileName: baseName,
      content: fileContent,
      repoName,
      stat
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  const html = renderCodeViewer({
    relPath: cleanRel,
    fileName: baseName,
    content: fileContent,
    repoName,
    stat,
    ext
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(html);
}
