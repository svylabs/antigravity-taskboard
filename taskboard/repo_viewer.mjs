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

export function getSiblingDocs(targetPath, repoRoot) {
  const dirPath = path.dirname(targetPath);
  const docsDir = path.join(repoRoot, 'docs');
  
  let searchDir = dirPath;
  const isTargetInDocs = targetPath.startsWith(docsDir);

  if (!isTargetInDocs && fs.existsSync(docsDir)) {
    const dirEntries = fs.existsSync(dirPath) ? fs.readdirSync(dirPath, { withFileTypes: true }) : [];
    const localMds = dirEntries.filter(e => !e.isDirectory() && (e.name.endsWith('.md') || e.name.endsWith('.markdown')));
    if (localMds.length <= 1) {
      searchDir = docsDir;
    }
  }

  try {
    if (!fs.existsSync(searchDir)) return [];
    const entries = fs.readdirSync(searchDir, { withFileTypes: true });
    const mdEntries = entries
      .filter(e => !e.isDirectory() && (e.name.endsWith('.md') || e.name.endsWith('.markdown')))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (mdEntries.length === 0) return [];

    return mdEntries.map(fName => {
      const fullPath = path.join(searchDir, fName);
      const relToRepo = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
      const isActive = path.resolve(fullPath) === path.resolve(targetPath);
      let title = '';
      try {
        const chunk = fs.readFileSync(fullPath, 'utf-8').slice(0, 1500);
        const match = chunk.match(/^#\s+(.*)$/m);
        if (match) {
          title = match[1].replace(/^[0-9]+[.\-:]\s*/, '').trim();
        }
      } catch (e) {}

      if (!title) {
        title = fName
          .replace(/\.(md|markdown)$/i, '')
          .replace(/^(\d+)[-_.]\s*/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
      }

      const isDocsFolder = relToRepo.startsWith('docs/');
      const url = isDocsFolder ? `/docs/${encodeURIComponent(fName)}` : `/repo/${encodeURIComponent(relToRepo)}`;

      return {
        fileName: fName,
        relPath: relToRepo,
        url,
        title,
        isActive
      };
    });
  } catch (err) {
    return [];
  }
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
      background: rgba(255, 255, 255, 0.95);
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
    .btn-sidebar-toggle {
      display: none;
    }

    /* Container for standalone views */
    .container {
      max-width: 1100px;
      margin: 28px auto;
      padding: 0 20px;
    }

    /* Docs 3-Column / 2-Column Responsive Layout */
    .docs-layout {
      display: flex;
      max-width: 1480px;
      margin: 0 auto;
      min-height: calc(100vh - 58px);
    }
    .docs-sidebar {
      width: 290px;
      flex-shrink: 0;
      background: #FFFFFF;
      border-right: 1px solid #E2E8F0;
      padding: 24px 18px;
      position: sticky;
      top: 57px;
      height: calc(100vh - 57px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .sidebar-title {
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748B;
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sidebar-count {
      background: #F1F5F9;
      color: #475569;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 12px;
      font-weight: 600;
    }
    .sidebar-search {
      width: 100%;
      padding: 8px 12px;
      font-size: 12.5px;
      border: 1px solid #CBD5E1;
      border-radius: 7px;
      outline: none;
      margin-bottom: 14px;
      background: #F8FAFC;
      transition: all 0.15s;
    }
    .sidebar-search:focus {
      border-color: #7C3AED;
      background: #FFFFFF;
      box-shadow: 0 0 0 2px #EDE9FE;
    }
    .sidebar-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 3px;
      overflow-y: auto;
      flex: 1;
    }
    .sidebar-item {
      list-style: none;
    }
    .sidebar-link {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      padding: 8px 10px;
      border-radius: 7px;
      text-decoration: none;
      color: #334155;
      font-size: 13px;
      line-height: 1.4;
      transition: all 0.15s ease;
      border-left: 3px solid transparent;
    }
    .sidebar-link:hover {
      background: #F1F5F9;
      color: #0F172A;
    }
    .sidebar-link.active {
      background: #F5F3FF;
      color: #6D28D9;
      font-weight: 600;
      border-left-color: #7C3AED;
    }
    .sidebar-num {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      background: #EDE9FE;
      color: #7C3AED;
      padding: 1px 6px;
      border-radius: 4px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .sidebar-link.active .sidebar-num {
      background: #7C3AED;
      color: #FFFFFF;
    }
    .sidebar-doc-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .docs-main {
      flex: 1;
      min-width: 0;
      padding: 32px 36px 64px 36px;
      display: flex;
      justify-content: center;
      gap: 36px;
    }
    .docs-content-wrap {
      flex: 1;
      max-width: 900px;
      min-width: 0;
    }
    .docs-toc {
      width: 230px;
      flex-shrink: 0;
      position: sticky;
      top: 90px;
      max-height: calc(100vh - 110px);
      overflow-y: auto;
      padding-left: 8px;
    }
    .toc-title {
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748B;
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .toc-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-left: 2px solid #E2E8F0;
      padding-left: 12px;
      font-size: 13px;
    }
    .toc-item {
      list-style: none;
    }
    .toc-link {
      color: #64748B;
      text-decoration: none;
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color 0.15s, transform 0.15s;
    }
    .toc-link:hover {
      color: #7C3AED;
      transform: translateX(2px);
    }
    .toc-link.active {
      color: #7C3AED;
      font-weight: 600;
    }
    .toc-item.depth-3 {
      padding-left: 12px;
      font-size: 12px;
    }

    /* Viewer Card */
    .viewer-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .viewer-meta-bar {
      padding: 12px 20px;
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: #64748B;
      flex-wrap: wrap;
      gap: 8px;
    }
    .meta-tags {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .meta-tag {
      background: #EDE9FE;
      color: #7C3AED;
      padding: 2px 9px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 11.5px;
    }

    /* Markdown Document Styles */
    .markdown-body {
      padding: 36px 44px;
      font-size: 15.5px;
      line-height: 1.75;
      color: #1E293B;
    }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
      color: #0F172A;
      margin-top: 32px;
      margin-bottom: 14px;
      font-weight: 700;
      line-height: 1.3;
      scroll-margin-top: 80px;
    }
    .markdown-body h1 {
      font-size: 28px;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 12px;
      margin-top: 0;
      letter-spacing: -0.02em;
    }
    .markdown-body h2 {
      font-size: 22px;
      border-bottom: 1px solid #F1F5F9;
      padding-bottom: 8px;
      letter-spacing: -0.01em;
    }
    .markdown-body h3 { font-size: 18px; }
    .markdown-body h4 { font-size: 15px; }
    .markdown-body p { margin-bottom: 18px; }
    .markdown-body ul, .markdown-body ol {
      margin-bottom: 18px;
      padding-left: 28px;
    }
    .markdown-body li { margin-bottom: 7px; }
    .markdown-body a {
      color: #7C3AED;
      text-decoration: underline;
      text-underline-offset: 3px;
      font-weight: 500;
    }
    .markdown-body a:hover { color: #6D28D9; }
    .markdown-body code {
      background: #F1F5F9;
      color: #7C3AED;
      border: 1px solid #E2E8F0;
      padding: 2px 6px;
      border-radius: 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13.5px;
    }
    .markdown-body pre {
      background: #0F172A;
      color: #F8FAFC;
      border-radius: 9px;
      padding: 18px;
      overflow-x: auto;
      margin-bottom: 20px;
      line-height: 1.5;
      font-size: 13.5px;
    }
    .markdown-body pre code {
      background: transparent;
      border: none;
      color: inherit;
      padding: 0;
      font-size: inherit;
    }

    /* Code Block with Copy Button */
    .code-block-wrap {
      position: relative;
      margin-bottom: 20px;
    }
    .code-block-wrap pre {
      margin-bottom: 0;
    }
    .code-copy-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #F8FAFC;
      font-size: 11.5px;
      font-weight: 500;
      padding: 4px 9px;
      border-radius: 5px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s, background 0.15s;
      backdrop-filter: blur(4px);
    }
    .code-block-wrap:hover .code-copy-btn {
      opacity: 1;
    }
    .code-copy-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Polished Standard Blockquotes */
    .markdown-body blockquote {
      border-left: 4px solid #7C3AED;
      background: #FAF5FF;
      padding: 14px 20px;
      border-radius: 0 8px 8px 0;
      color: #334155;
      margin: 18px 0;
      font-size: 15px;
      line-height: 1.65;
    }
    .markdown-body blockquote > :last-child {
      margin-bottom: 0;
    }
    .markdown-body blockquote blockquote {
      margin: 10px 0;
      border-left-color: #94A3B8;
      background: #F1F5F9;
      color: #475569;
    }
    .quote-author {
      display: block;
      margin-top: 8px;
      font-size: 13px;
      color: #64748B;
      font-style: italic;
      text-align: right;
    }

    /* Callout Boxes (GitHub Alerts & Specification Highlights) */
    .callout {
      margin: 22px 0;
      border-radius: 8px;
      border: 1px solid;
      border-left-width: 4px;
      overflow: hidden;
      background: #FFFFFF;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    .callout-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .callout-icon {
      font-size: 16px;
      line-height: 1;
    }
    .callout-content {
      padding: 8px 16px 14px 16px;
      font-size: 14.5px;
      line-height: 1.65;
      color: #1E293B;
    }
    .callout-content > :last-child {
      margin-bottom: 0;
    }

    /* Callout Theme Variants */
    .callout-note, .callout-info {
      border-color: #BFDBFE;
      border-left-color: #2563EB;
      background: #EFF6FF;
    }
    .callout-note .callout-header, .callout-info .callout-header { color: #1D4ED8; }
    .callout-note .callout-content, .callout-info .callout-content { color: #1E3A8A; }

    .callout-tip {
      border-color: #BBF7D0;
      border-left-color: #10B981;
      background: #F0FDF4;
    }
    .callout-tip .callout-header { color: #15803D; }
    .callout-tip .callout-content { color: #14532D; }

    .callout-important, .callout-purple {
      border-color: #DDD6FE;
      border-left-color: #7C3AED;
      background: #FAF5FF;
    }
    .callout-important .callout-header, .callout-purple .callout-header { color: #6D28D9; }
    .callout-important .callout-content, .callout-purple .callout-content { color: #4C1D95; }

    .callout-warning {
      border-color: #FDE68A;
      border-left-color: #F59E0B;
      background: #FFFBEB;
    }
    .callout-warning .callout-header { color: #B45309; }
    .callout-warning .callout-content { color: #78350F; }

    .callout-caution, .callout-danger {
      border-color: #FECACA;
      border-left-color: #EF4444;
      background: #FEF2F2;
    }
    .callout-caution .callout-header, .callout-danger .callout-header { color: #B91C1C; }
    .callout-caution .callout-content, .callout-danger .callout-content { color: #7F1D1D; }

    /* Mermaid Diagram Containers */
    .mermaid-diagram-card {
      margin: 26px 0;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      background: #FFFFFF;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
      overflow: hidden;
      transition: box-shadow 0.2s ease;
    }
    .mermaid-diagram-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .mermaid-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 16px;
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
      font-size: 12px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .mermaid-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: #475569;
    }
    .mermaid-badge {
      background: #EDE9FE;
      color: #7C3AED;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .mermaid-type {
      color: #64748B;
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11.5px;
    }
    .mermaid-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-diagram-tool {
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      color: #475569;
      font-size: 11.5px;
      font-weight: 500;
      padding: 4px 9px;
      border-radius: 5px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }
    .btn-diagram-tool:hover {
      background: #F1F5F9;
      color: #0F172A;
      border-color: #94A3B8;
    }
    .mermaid-canvas-wrap {
      padding: 24px;
      overflow-x: auto;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #FCFCFD;
      min-height: 120px;
    }
    .mermaid-canvas-wrap.expanded {
      max-height: none !important;
    }
    .mermaid-render-target {
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .mermaid-render-target svg {
      max-width: 100%;
      height: auto;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.02));
    }
    .mermaid-source-pre {
      margin: 0 !important;
      border-radius: 0 !important;
      border: none !important;
      background: #0F172A !important;
      padding: 16px !important;
      font-size: 12.5px !important;
    }
    .mermaid-error-notice {
      width: 100%;
      padding: 16px;
      background: #FEF2F2;
      border: 1px solid #FCA5A5;
      border-radius: 8px;
      color: #991B1B;
      font-size: 13px;
    }
    .mermaid-error-header {
      font-weight: 700;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .mermaid-raw-code {
      background: #450A0A !important;
      color: #FEE2E2 !important;
      padding: 10px !important;
      border-radius: 6px !important;
      margin-top: 8px !important;
      font-size: 12px !important;
      overflow-x: auto;
    }

    /* Tables */
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 22px;
      font-size: 14.5px;
      display: table;
      overflow-x: auto;
    }
    .markdown-body th, .markdown-body td {
      border: 1px solid #E2E8F0;
      padding: 10px 16px;
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
      margin: 32px 0;
    }

    /* Mobile drawer for Docs Sidebar */
    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(2px);
      z-index: 60;
    }
    @media (max-width: 1100px) {
      .docs-toc { display: none !important; }
      .docs-main { padding: 24px 20px 48px 20px; }
    }
    @media (max-width: 860px) {
      .btn-sidebar-toggle { display: inline-flex; }
      .docs-sidebar {
        position: fixed;
        left: -320px;
        top: 0;
        bottom: 0;
        z-index: 70;
        width: 300px;
        transition: left 0.25s ease;
        box-shadow: 4px 0 16px rgba(0,0,0,0.1);
      }
      .docs-sidebar.open {
        left: 0;
      }
      .sidebar-backdrop.active {
        display: block;
      }
      .markdown-body { padding: 24px 18px; }
      header.repo-header { padding: 10px 14px; }
    }
  `;
}

export function renderMarkdownViewer({ relPath, fileName, content, repoName, stat, siblingDocs = [] }) {
  const breadcrumbsHtml = renderBreadcrumbs(repoName, relPath, false);
  const sizeStr = formatBytes(stat.size);
  const hasSidebar = siblingDocs && siblingDocs.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)} - ${escapeHtml(repoName)} Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
  <style>${getCommonStyles()}</style>
</head>
<body>
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebarDrawer(false)"></div>

  <header class="repo-header">
    <div class="header-left">
      <a href="/" class="back-btn" title="Return to Taskboard">← Taskboard</a>
      ${hasSidebar ? `
        <button type="button" class="btn-action btn-sidebar-toggle" onclick="toggleSidebarDrawer()" title="Toggle specification sidebar">
          <span>📚</span><span>Docs (${siblingDocs.length})</span>
        </button>
      ` : ''}
      <div class="crumb-container">${breadcrumbsHtml}</div>
    </div>
    <div class="header-right">
      <button class="btn-action" id="copyPathBtn" onclick="copyPath('${escapeHtml(relPath)}')">📋 Copy Path</button>
      <a href="/repo/${escapeHtml(relPath)}?raw=true" class="btn-action" target="_blank">📄 Raw</a>
    </div>
  </header>

  ${hasSidebar ? `
  <div class="docs-layout">
    <!-- Left Sidebar: Sibling Documentation -->
    <aside class="docs-sidebar" id="docsSidebar">
      <div class="sidebar-title">
        <span>📚 Documentation</span>
        <span class="sidebar-count">${siblingDocs.length} specs</span>
      </div>
      <input type="text" id="docSearchInput" class="sidebar-search" placeholder="🔍 Filter documents..." oninput="filterDocsList(this.value)">
      <ul class="sidebar-list" id="sidebarList">
        ${siblingDocs.map((doc, idx) => {
          const numMatch = doc.fileName.match(/^(\d+)/);
          const numBadge = numMatch ? numMatch[1] : (idx + 1);
          return `
            <li class="sidebar-item" data-name="${escapeHtml(doc.title.toLowerCase())} ${escapeHtml(doc.fileName.toLowerCase())}">
              <a href="${escapeHtml(doc.url)}" class="sidebar-link ${doc.isActive ? 'active' : ''}" title="${escapeHtml(doc.title)}">
                <span class="sidebar-num">${escapeHtml(numBadge)}</span>
                <span class="sidebar-doc-title">${escapeHtml(doc.title)}</span>
              </a>
            </li>
          `;
        }).join('')}
      </ul>
      <div style="margin-top: auto; padding-top: 16px; border-top: 1px solid #E2E8F0; display: flex; flex-direction: column; gap: 6px;">
        <a href="/repo" class="sidebar-link" style="color: #64748B;">
          <span>📁</span><span>All Repository Files</span>
        </a>
        <a href="/" class="sidebar-link" style="color: #64748B;">
          <span>📋</span><span>Taskboard</span>
        </a>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="docs-main">
      <div class="docs-content-wrap">
        <div class="viewer-card">
          <div class="viewer-meta-bar">
            <div class="meta-tags">
              <span class="meta-tag">Specification</span>
              <span class="meta-tag" style="background: #F1F5F9; color: #475569;">${sizeStr}</span>
              <span id="readTimeTag" style="color: #64748B;"></span>
            </div>
            <div>Last modified: ${formatDate(stat.mtime)}</div>
          </div>
          <div id="markdownContent" class="markdown-body">
            <div style="color: #94A3B8; text-align: center; padding: 40px 20px;">
              Rendering specification...
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Outline / Table of Contents -->
      <aside class="docs-toc" id="docsToc" style="display: none;">
        <div class="toc-title"><span>📑</span><span>On this page</span></div>
        <ul class="toc-list" id="tocList"></ul>
      </aside>
    </main>
  </div>
  ` : `
  <div class="container">
    <div class="viewer-card">
      <div class="viewer-meta-bar">
        <div class="meta-tags">
          <span class="meta-tag">Markdown</span>
          <span>${sizeStr}</span>
          <span id="readTimeTag" style="color: #64748B;"></span>
        </div>
        <div>Last modified: ${formatDate(stat.mtime)}</div>
      </div>
      <div id="markdownContent" class="markdown-body">
        <div style="color: #94A3B8; text-align: center; padding: 30px 20px;">Rendering document...</div>
      </div>
    </div>
  </div>
  `}

  <script id="rawSource" type="application/json">${JSON.stringify(content).replace(/<\/script/gi, '<\\/script')}</script>
  <script>
    function copyPath(text) {
      navigator.clipboard.writeText(text);
      const btn = document.getElementById('copyPathBtn');
      const original = btn.innerText;
      btn.innerText = '✅ Copied!';
      setTimeout(() => { btn.innerText = original; }, 2000);
    }

    function toggleSidebarDrawer(forced) {
      const sidebar = document.getElementById('docsSidebar');
      const backdrop = document.getElementById('sidebarBackdrop');
      if (!sidebar) return;
      const isOpen = forced !== undefined ? forced : !sidebar.classList.contains('open');
      sidebar.classList.toggle('open', isOpen);
      if (backdrop) backdrop.classList.toggle('active', isOpen);
    }

    function filterDocsList(query) {
      const q = (query || '').toLowerCase().trim();
      const items = document.querySelectorAll('#sidebarList .sidebar-item');
      items.forEach(it => {
        const text = it.getAttribute('data-name') || '';
        it.style.display = text.includes(q) ? '' : 'none';
      });
    }

    function toggleDiagramSource(id) {
      const pre = document.getElementById('source_' + id);
      const canvas = document.getElementById('canvas_' + id);
      const txt = document.getElementById('srcText_' + id);
      if (!pre || !canvas) return;
      if (pre.style.display === 'none') {
        pre.style.display = 'block';
        canvas.style.display = 'none';
        if (txt) txt.innerText = '📊 View Diagram';
      } else {
        pre.style.display = 'none';
        canvas.style.display = 'flex';
        if (txt) txt.innerText = '👁️ View Source';
      }
    }

    function copyDiagramCode(id, btn) {
      const pre = document.getElementById('source_' + id);
      if (pre) {
        navigator.clipboard.writeText(pre.innerText);
        const original = btn.innerText;
        btn.innerText = '✅ Copied!';
        setTimeout(() => { btn.innerText = original; }, 2000);
      }
    }

    function toggleDiagramZoom(id, btn) {
      const canvas = document.getElementById('canvas_' + id);
      if (!canvas) return;
      if (canvas.classList.contains('expanded')) {
        canvas.classList.remove('expanded');
        btn.innerText = '🔍 Expand';
      } else {
        canvas.classList.add('expanded');
        btn.innerText = '🔍 Shrink';
      }
    }

    function enhanceBlockquotes(container) {
      const bqs = container.querySelectorAll('blockquote');
      bqs.forEach(bq => {
        const fullText = bq.innerText.trim();

        // 1. GitHub Alert Syntax: [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
        const alertMatch = fullText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
        if (alertMatch) {
          const type = alertMatch[1].toUpperCase();
          const typeKey = type.toLowerCase();
          let icon = 'ℹ️';
          let title = 'Note';
          if (type === 'TIP') { icon = '💡'; title = 'Tip'; }
          else if (type === 'IMPORTANT') { icon = '🟣'; title = 'Important'; }
          else if (type === 'WARNING') { icon = '⚠️'; title = 'Warning'; }
          else if (type === 'CAUTION') { icon = '🛑'; title = 'Caution'; }

          let innerHtml = bq.innerHTML;
          innerHtml = innerHtml.replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]<br\s*\/?>?/i, '');
          innerHtml = innerHtml.replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i, '');

          const card = document.createElement('div');
          card.className = 'callout callout-' + typeKey;
          card.innerHTML = '<div class="callout-header"><span class="callout-icon">' + icon + '</span><span class="callout-title">' + title + '</span></div><div class="callout-content">' + innerHtml + '</div>';
          bq.parentNode.replaceChild(card, bq);
          return;
        }

        // 2. Emoji Callouts (e.g. "> 📘 **Title**:", "> 💡 ...", "> ⚠️ ...")
        const emojiMatch = fullText.match(/^(📘|💡|⚠️|🚨|🛑|📌|ℹ️|🟣|⚡|🛠️|🔍|🎯)\s*/);
        if (emojiMatch) {
          const emoji = emojiMatch[1];
          let calloutClass = 'callout-info';
          let defaultTitle = 'Notice';
          if (emoji === '💡' || emoji === '⚡' || emoji === '🎯') { calloutClass = 'callout-tip'; defaultTitle = 'Tip'; }
          else if (emoji === '⚠️' || emoji === '📌') { calloutClass = 'callout-warning'; defaultTitle = 'Warning'; }
          else if (emoji === '🚨' || emoji === '🛑') { calloutClass = 'callout-caution'; defaultTitle = 'Important Warning'; }
          else if (emoji === '🟣' || emoji === '🛠️') { calloutClass = 'callout-purple'; defaultTitle = 'Architecture Note'; }
          else if (emoji === '📘' || emoji === 'ℹ️' || emoji === '🔍') { calloutClass = 'callout-info'; defaultTitle = 'Specification Note'; }

          const card = document.createElement('div');
          card.className = 'callout ' + calloutClass;
          card.innerHTML = '<div class="callout-header"><span class="callout-icon">' + emoji + '</span><span class="callout-title">' + defaultTitle + '</span></div><div class="callout-content">' + bq.innerHTML + '</div>';
          bq.parentNode.replaceChild(card, bq);
          return;
        }

        // 3. Attribution formatting for standard quotes
        const paras = bq.querySelectorAll('p');
        if (paras.length > 0) {
          const lastP = paras[paras.length - 1];
          const lastText = lastP.innerText.trim();
          if (/^[—–\-]\s+/.test(lastText)) {
            const footer = document.createElement('footer');
            footer.className = 'quote-author';
            footer.innerHTML = lastP.innerHTML;
            lastP.parentNode.replaceChild(footer, lastP);
          }
        }
      });
    }

    async function renderMermaidDiagrams(container) {
      const codeNodes = container.querySelectorAll('pre code.language-mermaid, pre code.lang-mermaid');
      if (!codeNodes.length) return;

      if (typeof mermaid === 'undefined') return;

      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: true, showSequenceNumbers: true },
          themeVariables: {
            primaryColor: '#EDE9FE',
            primaryBorderColor: '#7C3AED',
            primaryTextColor: '#1E1B4B',
            lineColor: '#64748B',
            secondaryColor: '#F1F5F9',
            tertiaryColor: '#FFFFFF',
            actorBkg: '#EDE9FE',
            actorBorder: '#7C3AED',
            actorTextColor: '#4C1D95',
            signalColor: '#64748B',
            signalTextColor: '#0F172A',
            noteBkgColor: '#FEF3C7',
            noteBorderColor: '#F59E0B',
            noteTextColor: '#92400E'
          }
        });
      } catch (e) {
        console.error('Failed to initialize mermaid:', e);
      }

      function decodeHtmlEntities(str) {
        const txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
      }

      let idx = 0;
      for (const codeEl of Array.from(codeNodes)) {
        const pre = codeEl.closest('pre');
        if (!pre) continue;
        let code = decodeHtmlEntities(codeEl.textContent.trim());
        if (!code) continue;

        const diagramId = 'm_' + Math.random().toString(36).slice(2, 9) + '_' + (idx++);
        const firstLine = code.split('\\n')[0].trim();
        const diagramType = firstLine.split(/\\s+/)[0] || 'diagram';

        const card = document.createElement('div');
        card.className = 'mermaid-diagram-card';
        card.id = 'card_' + diagramId;
        card.innerHTML = [
          '<div class="mermaid-toolbar">',
          '  <div class="mermaid-title">',
          '    <span class="mermaid-badge">📊 Diagram</span>',
          '    <span class="mermaid-type">' + diagramType + '</span>',
          '  </div>',
          '  <div class="mermaid-actions">',
          '    <button type="button" class="btn-diagram-tool" onclick="toggleDiagramSource(\\'' + diagramId + '\\')">',
          '      <span id="srcText_' + diagramId + '">👁️ View Source</span>',
          '    </button>',
          '    <button type="button" class="btn-diagram-tool" onclick="copyDiagramCode(\\'' + diagramId + '\\', this)">',
          '      📋 Copy',
          '    </button>',
          '    <button type="button" class="btn-diagram-tool" onclick="toggleDiagramZoom(\\'' + diagramId + '\\', this)">',
          '      🔍 Expand',
          '    </button>',
          '  </div>',
          '</div>',
          '<div class="mermaid-canvas-wrap" id="canvas_' + diagramId + '">',
          '  <div class="mermaid-render-target" id="target_' + diagramId + '">',
          '    <div style="font-size: 12px; color: #94A3B8;">Rendering diagram...</div>',
          '  </div>',
          '</div>',
          '<pre class="mermaid-source-pre" id="source_' + diagramId + '" style="display: none;"><code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>'
        ].join('');

        pre.parentNode.replaceChild(card, pre);

        try {
          const { svg } = await mermaid.render('svg_' + diagramId, code);
          const target = document.getElementById('target_' + diagramId);
          if (target) target.innerHTML = svg;
        } catch (err) {
          console.warn('Mermaid render error for diagram', diagramId, err);
          document.querySelectorAll('[id*="' + diagramId + '"]').forEach(el => {
            if (el !== card && !card.contains(el)) el.remove();
          });
          const target = document.getElementById('target_' + diagramId);
          if (target) {
            target.innerHTML = [
              '<div class="mermaid-error-notice">',
              '  <div class="mermaid-error-header">⚠️ Diagram Syntax Notice: ' + (err.message || 'Syntax error') + '</div>',
              '  <div style="font-size: 11.5px; margin-bottom: 6px; color: #7F1D1D;">The diagram could not be rendered as SVG. You can view the raw specification below:</div>',
              '  <pre class="mermaid-raw-code"><code>' + code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>',
              '</div>'
            ].join('');
          }
        }
      }
    }

    function highlightCodeBlocks(container) {
      const codeBlocks = container.querySelectorAll('pre code:not(.language-mermaid):not(.lang-mermaid)');
      codeBlocks.forEach(block => {
        if (typeof hljs !== 'undefined') {
          try { hljs.highlightElement(block); } catch (e) {}
        }
        const pre = block.closest('pre');
        if (pre && !pre.closest('.code-block-wrap') && !pre.closest('.mermaid-diagram-card')) {
          const wrap = document.createElement('div');
          wrap.className = 'code-block-wrap';
          pre.parentNode.insertBefore(wrap, pre);
          wrap.appendChild(pre);

          const copyBtn = document.createElement('button');
          copyBtn.className = 'code-copy-btn';
          copyBtn.type = 'button';
          copyBtn.innerText = '📋 Copy';
          copyBtn.onclick = function() {
            navigator.clipboard.writeText(block.innerText);
            copyBtn.innerText = '✅ Copied!';
            setTimeout(() => { copyBtn.innerText = '📋 Copy'; }, 2000);
          };
          wrap.appendChild(copyBtn);
        }
      });
    }

    function renderKaTeX(container) {
      if (typeof renderMathInElement === 'function') {
        try {
          renderMathInElement(container, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\\\(', right: '\\\\)', display: false },
              { left: '\\\\[', right: '\\\\]', display: true }
            ],
            throwOnError: false,
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
          });
        } catch (e) {
          console.warn('KaTeX render warning:', e);
        }
      }
    }

    function generateTOC(container) {
      const headings = container.querySelectorAll('h1, h2, h3');
      const tocAside = document.getElementById('docsToc');
      const tocList = document.getElementById('tocList');
      if (!headings.length || headings.length < 2 || !tocAside || !tocList) {
        if (tocAside) tocAside.style.display = 'none';
        return;
      }

      tocList.innerHTML = '';
      headings.forEach((h, i) => {
        if (!h.id) {
          const slug = h.innerText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ('section-' + i);
          h.id = slug;
        }
        h.style.scrollMarginTop = '80px';
        const level = parseInt(h.tagName.substring(1), 10);
        const li = document.createElement('li');
        li.className = 'toc-item depth-' + level;
        li.innerHTML = '<a href="#' + h.id + '" class="toc-link" data-target="' + h.id + '">' + h.innerText.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</a>';
        tocList.appendChild(li);
      });
      tocAside.style.display = 'block';

      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            document.querySelectorAll('.toc-link').forEach(link => {
              link.classList.toggle('active', link.getAttribute('data-target') === id);
            });
          }
        });
      }, { rootMargin: '0px 0px -70% 0px' });

      headings.forEach(h => observer.observe(h));
    }

    (async function() {
      let raw = '';
      try {
        raw = JSON.parse(document.getElementById('rawSource').textContent);
      } catch (e) {
        raw = document.getElementById('rawSource').textContent;
      }
      const target = document.getElementById('markdownContent');

      // Estimate reading time & word count
      const words = raw.trim().split(/\\s+/).filter(Boolean).length;
      const readTime = Math.max(1, Math.ceil(words / 200));
      const readTag = document.getElementById('readTimeTag');
      if (readTag) readTag.innerText = '~' + readTime + ' min read (' + words + ' words)';

      // Parse markdown
      if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        try {
          target.innerHTML = marked.parse(raw, { breaks: true, gfm: true });
        } catch (e) {
          target.innerText = raw;
        }
      } else {
        target.innerText = raw;
      }

      // Enhance components
      enhanceBlockquotes(target);
      highlightCodeBlocks(target);
      renderKaTeX(target);
      generateTOC(target);
      await renderMermaidDiagrams(target);
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

  let cleanRel = '';
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    const raw = pathname.replace(/^\/docs\/?/, '');
    cleanRel = raw ? path.join('docs', decodeURIComponent(raw)) : 'docs';
  } else {
    const rawRel = pathname.replace(/^\/(repo|files|view)\/?/, '');
    cleanRel = decodeURIComponent(rawRel).replace(/^\/+/, '');
  }
  const targetPath = cleanRel ? path.resolve(repoRoot, cleanRel) : repoRoot;

  if (!targetPath.startsWith(repoRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderErrorPage(403, 'Access denied: Path traversal outside repository root.', repoName));
  }

  // Handle /docs or /docs/ root navigation: redirect to default doc if available
  if ((pathname === '/docs' || pathname === '/docs/') && (!cleanRel || cleanRel === 'docs')) {
    const docsDir = path.join(repoRoot, 'docs');
    if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) {
      const dirEntries = fs.readdirSync(docsDir, { withFileTypes: true });
      const mdFiles = dirEntries
        .filter(e => !e.isDirectory() && (e.name.endsWith('.md') || e.name.endsWith('.markdown')))
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (mdFiles.length > 0) {
        const defaultDoc = mdFiles.find(f => /^01[-_.]/i.test(f)) ||
                           mdFiles.find(f => /^readme/i.test(f)) ||
                           mdFiles.find(f => /^index/i.test(f)) ||
                           mdFiles[0];
        res.writeHead(302, { 'Location': `/docs/${encodeURIComponent(defaultDoc)}` });
        return res.end();
      }
    } else if (fs.existsSync(path.join(repoRoot, 'README.md'))) {
      res.writeHead(302, { 'Location': `/repo/README.md` });
      return res.end();
    }
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
    // If user requested /docs/something that wasn't found in docs/, check repo root
    if (cleanRel.startsWith('docs' + path.sep) || cleanRel.startsWith('docs/')) {
      const altFile = cleanRel.replace(/^docs[\/\\]/, '');
      const altPath = path.resolve(repoRoot, altFile);
      if (fs.existsSync(altPath)) {
        res.writeHead(302, { 'Location': `/repo/${encodeURIComponent(altFile)}` });
        return res.end();
      }
    }
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
    const siblingDocs = getSiblingDocs(targetPath, repoRoot);
    const html = renderMarkdownViewer({
      relPath: cleanRel,
      fileName: baseName,
      content: fileContent,
      repoName,
      stat,
      siblingDocs
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
