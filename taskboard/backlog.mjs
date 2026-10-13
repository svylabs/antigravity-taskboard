import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Resolves the primary product requirements file path: <projectDir>/product.json
 * Automatically migrates existing backlog.json to product.json if found.
 */
export function getProductFilePath(projectDir) {
  const pDir = projectDir || process.cwd();
  const primary = path.join(pDir, 'product.json');
  if (fs.existsSync(primary)) return primary;

  // Auto-migrate legacy backlog.json if it exists
  const legacy = path.join(pDir, 'backlog.json');
  if (fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, primary);
      console.log(`📦 Renamed ${legacy} -> ${primary}`);
      return primary;
    } catch {
      return legacy;
    }
  }

  const fallback = path.join(pDir, '.agents', 'taskboard', 'product.json');
  if (fs.existsSync(fallback)) return fallback;

  const legacyFallback = path.join(pDir, '.agents', 'taskboard', 'backlog.json');
  if (fs.existsSync(legacyFallback)) {
    try {
      fs.renameSync(legacyFallback, fallback);
      return fallback;
    } catch {
      return legacyFallback;
    }
  }

  return primary;
}
export const getBacklogFilePath = getProductFilePath;

/**
 * Generate a clean, unique ID for a product node.
 */
export function generateNodeId() {
  return 'node_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * Recursively find a node and its parent by ID.
 */
export function findNodeAndParent(node, id, parent = null) {
  if (!node) return null;
  if (node.id === id) {
    return { node, parent };
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findNodeAndParent(child, id, node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Count total items in tree (excluding root project node by default).
 */
export function countNodes(node, includeRoot = false) {
  if (!node) return 0;
  let count = (node.id === 'root' && !includeRoot) ? 0 : 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countNodes(child, true);
    }
  }
  return count;
}

/**
 * Read the product description tree from disk.
 * If file does not exist, initializes with project root node and migrates legacy SQLite backlog tasks if any.
 */
export function readProductTree(projectDir, projectName, db = null) {
  const pDir = projectDir || process.cwd();
  const filePath = getProductFilePath(pDir);
  const pName = projectName || path.basename(pDir) || 'Project';

  let tree = null;

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.root && typeof parsed.root === 'object') {
          tree = parsed.root;
        } else if (parsed.id && parsed.title) {
          tree = parsed;
        }
      }
    } catch (err) {
      console.error(`⚠️ Failed to parse ${filePath}:`, err.message);
    }
  }

  // If no valid tree found, initialize default root
  if (!tree) {
    tree = {
      id: 'root',
      title: pName,
      description: 'Project requirements and description tree',
      createdAt: new Date().toISOString(),
      children: []
    };

    // Migrate any legacy SQLite backlog tasks if database provided
    if (db) {
      try {
        const legacyTasks = db.prepare("SELECT * FROM agent_tasks WHERE status = 'backlog' ORDER BY order_index ASC, created_at ASC").all();
        if (legacyTasks && legacyTasks.length > 0) {
          for (const lt of legacyTasks) {
            tree.children.push({
              id: generateNodeId(),
              title: lt.title,
              description: lt.description || '',
              createdAt: lt.created_at || new Date().toISOString(),
              children: []
            });
          }
          // Remove migrated tasks from SQLite
          db.prepare("DELETE FROM agent_tasks WHERE status = 'backlog'").run();
          console.log(`📦 Migrated ${legacyTasks.length} legacy SQLite backlog tasks into ${filePath}`);
        }
      } catch {}
    }

    writeProductTree(pDir, tree);
  }

  // Ensure root ID and title
  if (!tree.id) tree.id = 'root';
  if (!tree.children) tree.children = [];

  return tree;
}
export const readBacklogTree = readProductTree;

/**
 * Commit product.json to git with an appropriate message.
 * Strictly scopes git operations to 'product.json' ONLY so that no other files
 * (work-in-progress code from running agents, SQLite databases, logs, assets, etc.)
 * are ever staged or committed.
 */
export function commitProductChanges(projectDir, message = null) {
  const pDir = projectDir || process.cwd();
  try {
    const isGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: pDir, stdio: 'pipe' });
    if (isGit.status !== 0) {
      return null;
    }

    const targetFile = 'product.json';

    // Check if git status has any changes strictly for product.json
    const statusRes = spawnSync('git', ['status', '--porcelain', '--', targetFile], { cwd: pDir, stdio: 'pipe' });
    const statusOut = statusRes.stdout ? statusRes.stdout.toString().trim() : '';
    if (!statusOut) {
      return null;
    }

    // Stage ONLY product.json
    spawnSync('git', ['add', '--', targetFile], { cwd: pDir, stdio: 'pipe' });

    // Determine commit message
    const commitMsg = message || 'chore(product): update product specification in product.json';

    // Check if user.name is configured
    const userCheck = spawnSync('git', ['config', 'user.name'], { cwd: pDir, stdio: 'pipe' });
    const hasUser = userCheck.status === 0 && userCheck.stdout && userCheck.stdout.toString().trim();

    const commitArgs = [];
    if (!hasUser) {
      commitArgs.push('-c', 'user.name=Antigravity Taskboard', '-c', 'user.email=taskboard@local');
    }
    // Commit strictly product.json
    commitArgs.push('commit', '-m', commitMsg, '--', targetFile);

    const commitRes = spawnSync('git', commitArgs, { cwd: pDir, stdio: 'pipe' });
    if (commitRes.status === 0) {
      console.log(`📝 [git] Committed product changes in ${pDir}: "${commitMsg}"`);
      return commitMsg;
    } else {
      const errStr = (commitRes.stderr?.toString() || commitRes.stdout?.toString() || '').trim();
      console.warn(`[git commit product.json] Failed to commit: ${errStr}`);
    }
  } catch (err) {
    console.warn(`[git commit product.json] ${err.message}`);
  }
  return null;
}

/**
 * Write product description tree to disk formatted with 2-space indentation for clean git diffs.
 * Automatically stages and commits product.json strictly to git with an appropriate descriptive commit message.
 */
export function writeProductTree(projectDir, tree, commitMessage = null) {
  const pDir = projectDir || process.cwd();
  const filePath = path.join(pDir, 'product.json');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify(tree, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');

  // Clean up any remaining legacy backlog.json if it exists
  const legacy = path.join(pDir, 'backlog.json');
  if (fs.existsSync(legacy) && legacy !== filePath) {
    try { fs.unlinkSync(legacy); } catch {}
  }

  // Automatically commit changes to git
  commitProductChanges(pDir, commitMessage);

  return filePath;
}
export const writeBacklogTree = writeProductTree;

/**
 * Add a new node to the tree under parentId (default 'root').
 */
export function addBacklogNode(projectDir, { parentId = 'root', title, description = '', type = null, projectName, db = null }) {
  if (!title || !title.trim()) {
    throw new Error('Title is required for backlog node');
  }

  const tree = readBacklogTree(projectDir, projectName, db);
  let parent = tree;

  if (parentId && parentId !== 'root') {
    const found = findNodeAndParent(tree, parentId);
    if (!found) {
      throw new Error(`Parent node "${parentId}" not found in backlog tree`);
    }
    parent = found.node;
  }

  if (!Array.isArray(parent.children)) {
    parent.children = [];
  }

  // Determine node type: 'component' | 'feature' | 'bug'
  let nodeType = type;
  if (!nodeType) {
    const lower = title.trim().toLowerCase();
    if (lower === 'bugs' || lower === 'bug' || lower.startsWith('[bug]') || lower.includes('bug') || lower.includes('improvement')) {
      nodeType = 'bug';
    } else if (lower === 'features' || lower === 'feature') {
      nodeType = 'feature';
    } else if (lower === 'components' || lower === 'component') {
      nodeType = 'component';
    } else {
      nodeType = 'feature';
    }
  }

  const newNode = {
    id: generateNodeId(),
    title: title.trim(),
    description: description ? description.trim() : '',
    type: nodeType,
    createdAt: new Date().toISOString(),
    children: []
  };

  parent.children.push(newNode);
  const parentTitle = (parentId && parentId !== 'root' && parent.title) ? ` under "${parent.title}"` : '';
  const typeLabel = nodeType === 'bug' ? 'bug / improvement' : (nodeType === 'component' ? 'component' : 'feature');
  const commitPrefix = nodeType === 'bug' ? 'fix(product)' : 'feat(product)';
  const commitMsg = `${commitPrefix}: add ${typeLabel} "${newNode.title}"${parentTitle}`;
  writeBacklogTree(projectDir, tree, commitMsg);

  return { success: true, node: newNode, tree };
}

/**
 * Update an existing node's title and/or description.
 */
export function updateBacklogNode(projectDir, id, { title, description, type, projectName, db = null }) {
  const tree = readBacklogTree(projectDir, projectName, db);
  const found = findNodeAndParent(tree, id);
  if (!found) {
    throw new Error(`Backlog node "${id}" not found`);
  }

  const node = found.node;
  if (title !== undefined && title.trim()) {
    node.title = title.trim();
  }
  if (description !== undefined) {
    node.description = description.trim();
  }
  if (type !== undefined) {
    node.type = type;
  }
  node.updatedAt = new Date().toISOString();

  const typeLabel = node.type === 'bug' ? 'bug / improvement' : (node.type === 'component' ? 'component' : 'feature');
  const commitMsg = `docs(product): update ${typeLabel} "${node.title}" specifications`;
  writeBacklogTree(projectDir, tree, commitMsg);
  return { success: true, node, tree };
}

/**
 * Delete a node from the tree. Cannot delete root.
 */
export function deleteBacklogNode(projectDir, id, projectName, db = null) {
  if (id === 'root') {
    throw new Error('Cannot delete project root node');
  }

  const tree = readBacklogTree(projectDir, projectName, db);
  const found = findNodeAndParent(tree, id);
  if (!found || !found.parent) {
    throw new Error(`Backlog node "${id}" not found or has no parent`);
  }

  const deletedTitle = found.node.title || id;
  const parent = found.parent;
  parent.children = parent.children.filter(c => c.id !== id);
  const commitMsg = `chore(product): remove feature "${deletedTitle}" from product specification`;
  writeBacklogTree(projectDir, tree, commitMsg);

  return { success: true, deletedId: id, tree };
}

/**
 * Move or reorder a node to a new parent or index.
 */
export function moveBacklogNode(projectDir, { id, targetParentId = 'root', index = null, beforeId = null, afterId = null, projectName, db = null }) {
  if (id === 'root') {
    throw new Error('Cannot move project root node');
  }

  if (id === targetParentId || id === beforeId || id === afterId) {
    const tree = readBacklogTree(projectDir, projectName, db);
    return { success: true, tree };
  }

  const tree = readBacklogTree(projectDir, projectName, db);
  const found = findNodeAndParent(tree, id);
  if (!found || !found.parent) {
    throw new Error(`Backlog node "${id}" not found`);
  }

  const node = found.node;

  function isDescendant(parent, targetId) {
    if (!parent || !Array.isArray(parent.children)) return false;
    for (const child of parent.children) {
      if (child.id === targetId || isDescendant(child, targetId)) return true;
    }
    return false;
  }

  let targetParent = null;
  let targetIndex = null;

  if (beforeId) {
    const beforeFound = findNodeAndParent(tree, beforeId);
    if (!beforeFound || !beforeFound.parent) {
      throw new Error(`Reference node "${beforeId}" not found`);
    }
    targetParent = beforeFound.parent;
    if (isDescendant(node, targetParent.id)) {
      throw new Error('Cannot move a node into one of its own descendants');
    }
    // Remove from old parent
    found.parent.children = found.parent.children.filter(c => c.id !== id);
    const idx = targetParent.children.findIndex(c => c.id === beforeId);
    targetIndex = (idx !== -1) ? idx : targetParent.children.length;
  } else if (afterId) {
    const afterFound = findNodeAndParent(tree, afterId);
    if (!afterFound || !afterFound.parent) {
      throw new Error(`Reference node "${afterId}" not found`);
    }
    targetParent = afterFound.parent;
    if (isDescendant(node, targetParent.id)) {
      throw new Error('Cannot move a node into one of its own descendants');
    }
    // Remove from old parent
    found.parent.children = found.parent.children.filter(c => c.id !== id);
    const idx = targetParent.children.findIndex(c => c.id === afterId);
    targetIndex = (idx !== -1) ? idx + 1 : targetParent.children.length;
  } else {
    if (targetParentId && targetParentId !== 'root') {
      const targetFound = findNodeAndParent(tree, targetParentId);
      if (!targetFound) {
        throw new Error(`Target parent "${targetParentId}" not found`);
      }
      targetParent = targetFound.node;
    } else {
      targetParent = tree;
    }

    if (isDescendant(node, targetParent.id)) {
      throw new Error('Cannot move a node into one of its own descendants');
    }

    // Remove from old parent
    found.parent.children = found.parent.children.filter(c => c.id !== id);
    targetIndex = (typeof index === 'number' && index >= 0 && index <= targetParent.children.length) ? index : targetParent.children.length;
  }

  if (!Array.isArray(targetParent.children)) {
    targetParent.children = [];
  }

  targetParent.children.splice(targetIndex, 0, node);

  let commitMsg = `chore(product): move feature "${node.title}"`;
  if (beforeId) {
    const refTitle = (tree && findNodeAndParent(tree, beforeId)?.node?.title) || beforeId;
    commitMsg = `chore(product): reorder feature "${node.title}" before "${refTitle}"`;
  } else if (afterId) {
    const refTitle = (tree && findNodeAndParent(tree, afterId)?.node?.title) || afterId;
    commitMsg = `chore(product): reorder feature "${node.title}" after "${refTitle}"`;
  } else if (!targetParentId || targetParentId === 'root') {
    commitMsg = `chore(product): move feature "${node.title}" to project root`;
  } else {
    commitMsg = `chore(product): move feature "${node.title}" under "${targetParent.title || targetParentId}"`;
  }

  writeBacklogTree(projectDir, tree, commitMsg);
  return { success: true, tree };
}

/**
 * Convert a backlog node into an executable task in SQLite.
 * Uses addTaskFn from tasks.mjs to insert the task into SQLite under status 'todo'.
 * Updates the node with taskId and taskStatus.
 */
export function convertBacklogNodeToTask(projectDir, id, taskData = {}, addTaskFn, projectName, db = null) {
  if (typeof addTaskFn !== 'function') {
    throw new Error('addTask function is required to convert backlog node to task');
  }

  const tree = readBacklogTree(projectDir, projectName, db);
  const found = findNodeAndParent(tree, id);
  if (!found) {
    throw new Error(`Backlog node "${id}" not found`);
  }

  const node = found.node;
  const isBug = (node.type === 'bug') || (taskData.type === 'bug') || (taskData.title && (taskData.title.toLowerCase().startsWith('[bug') || taskData.title.toLowerCase().startsWith('[improvement'))) || (node.title && (node.title.toLowerCase().startsWith('[bug') || node.title.toLowerCase().startsWith('[improvement')));
  let taskTitle = (taskData.title || node.title || '').trim();
  if (isBug && !taskTitle.toLowerCase().startsWith('[bug') && !taskTitle.toLowerCase().startsWith('[improvement')) {
    taskTitle = `[Bug / Improvement] ${taskTitle}`;
  }
  const taskDescription = (taskData.description !== undefined ? taskData.description : (node.description || '')).trim();

  // Create the task in SQLite with status 'todo'
  const task = addTaskFn({
    title: taskTitle,
    description: taskDescription,
    priority: taskData.priority || (isBug ? 'high' : 'medium'),
    subagent_role: taskData.subagent_role || (isBug ? 'QA / Test Engineer' : 'Fullstack Engineer'),
    scope: taskData.scope || (isBug ? 'bug' : ''),
    scope_size: taskData.scope_size || 'small',
    verification_cmd: taskData.verification_cmd || '',
    acceptance_criteria: taskData.acceptance_criteria || '',
    status: taskData.status || 'todo'
  });

  // Update node with converted task metadata
  node.taskId = task.id;
  node.taskStatus = taskData.status || 'todo';
  node.convertedAt = new Date().toISOString();
  if (taskDescription) {
    node.description = taskDescription;
  }
  if (taskTitle) {
    node.title = taskTitle;
  }

  const actionPrefix = isBug ? 'fix(product)' : 'feat(product)';
  const typeWord = isBug ? 'bug / improvement' : (node.type === 'component' ? 'component' : 'feature');
  const convertCommitMsg = `${actionPrefix}: assign Task #${task.id.slice(-5)} to ${typeWord} "${node.title}"`;
  writeBacklogTree(projectDir, tree, convertCommitMsg);

  return { success: true, task, node, tree };
}

/**
 * Synchronize taskStatus of converted nodes with live tasks from SQLite.
 * Returns true if any node's taskStatus changed so caller can persist updates.
 */
export function syncTaskStatusesWithTree(node, getTaskByIdFn) {
  if (!node || typeof getTaskByIdFn !== 'function') return false;
  let changed = false;

  if (node.taskId) {
    try {
      const task = getTaskByIdFn(node.taskId);
      const newStatus = task ? task.status : null;
      if (node.taskStatus !== newStatus) {
        node.taskStatus = newStatus;
        changed = true;
      }
    } catch {
      if (node.taskStatus !== null) {
        node.taskStatus = null;
        changed = true;
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const childChanged = syncTaskStatusesWithTree(child, getTaskByIdFn);
      if (childChanged) changed = true;
    }
  }
  return changed;
}

/**
 * Generate a clean ASCII representation of the tree for CLI output.
 * Renders strike marks (~~title~~) and completion checks for completed tasks.
 */
export function formatTreeAscii(node, prefix = '', isLast = true, isRoot = true) {
  if (!node) return '';

  let out = '';
  const isDone = node.taskId && (node.taskStatus || '').toLowerCase() === 'done';
  const taskTag = node.taskId 
    ? (isDone 
        ? ` [✅ Task #${node.taskId.slice(-6)} • COMPLETED]` 
        : ` [📋 Task #${node.taskId.slice(-6)}${node.taskStatus ? ` • ${node.taskStatus.toUpperCase()}` : ''}]`)
    : '';

  const displayTitle = isDone ? `~~${node.title}~~` : node.title;

  if (isRoot) {
    out += `📁 ${node.title}${taskTag}\n`;
  } else {
    const branch = isLast ? '└── ' : '├── ';
    const icon = isDone ? '✅ ' : (Array.isArray(node.children) && node.children.length > 0 ? '📦 ' : '• ');
    out += `${prefix}${branch}${icon}${displayTitle}${taskTag}\n`;
  }

  if (Array.isArray(node.children) && node.children.length > 0) {
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const lastChild = i === node.children.length - 1;
      out += formatTreeAscii(child, childPrefix, lastChild, false);
    }
  }

  return out;
}

// Product alias exports
export const addProductNode = addBacklogNode;
export const updateProductNode = updateBacklogNode;
export const deleteProductNode = deleteBacklogNode;
export const moveProductNode = moveBacklogNode;
export const convertProductNodeToTask = convertBacklogNodeToTask;

/**
 * Returns the product assets directory: <projectDir>/product_assets
 * Files stored here are checked into git alongside product.json (no SQLite).
 */
export function getProductAssetsDir(projectDir) {
  const pDir = projectDir || process.cwd();
  const dir = path.join(pDir, 'product_assets');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save an uploaded file or image directly to <projectDir>/product_assets/
 * and record its metadata in product.json under the given node.
 */
export function addProductAttachment(projectDir, nodeId, { fileName, buffer, mimeType, projectName, db = null }) {
  const assetsDir = getProductAssetsDir(projectDir);
  const attId = 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const cleanName = (fileName || 'artifact.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedName = `${attId}_${cleanName}`;
  const diskPath = path.join(assetsDir, storedName);

  fs.writeFileSync(diskPath, buffer);

  const tree = readProductTree(projectDir, projectName, db);
  const found = findNodeAndParent(tree, nodeId);
  if (!found) {
    try { fs.unlinkSync(diskPath); } catch {}
    throw new Error(`Product item "${nodeId}" not found`);
  }

  if (!Array.isArray(found.node.attachments)) {
    found.node.attachments = [];
  }

  const attachment = {
    id: attId,
    fileName: cleanName,
    storedName,
    url: `/api/product/assets/${storedName}`,
    mimeType: mimeType || 'application/octet-stream',
    size: buffer.length,
    uploadedAt: new Date().toISOString()
  };

  found.node.attachments.push(attachment);
  const commitMsg = `chore(product): add attachment "${cleanName}" to feature "${found.node.title}"`;
  writeProductTree(projectDir, tree, commitMsg);

  return { success: true, attachment, tree };
}

/**
 * Delete an attachment file from product_assets and remove it from product.json.
 */
export function deleteProductAttachment(projectDir, nodeId, attId, projectName, db = null) {
  const tree = readProductTree(projectDir, projectName, db);
  const found = findNodeAndParent(tree, nodeId);
  if (!found) {
    throw new Error(`Product item "${nodeId}" not found`);
  }

  if (Array.isArray(found.node.attachments)) {
    const att = found.node.attachments.find(a => a.id === attId);
    const attName = att ? (att.fileName || att.storedName) : attId;
    if (att && att.storedName) {
      const assetsDir = getProductAssetsDir(projectDir);
      const diskPath = path.join(assetsDir, att.storedName);
      if (fs.existsSync(diskPath)) {
        try { fs.unlinkSync(diskPath); } catch {}
      }
    }
    found.node.attachments = found.node.attachments.filter(a => a.id !== attId);
    const commitMsg = `chore(product): remove attachment "${attName}" from feature "${found.node.title}"`;
    writeProductTree(projectDir, tree, commitMsg);
  }

  return { success: true, tree };
}

