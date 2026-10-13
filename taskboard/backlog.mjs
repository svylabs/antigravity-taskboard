import fs from 'fs';
import path from 'path';

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
 * Write product description tree to disk formatted with 2-space indentation for clean git diffs.
 */
export function writeProductTree(projectDir, tree) {
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

  return filePath;
}
export const writeBacklogTree = writeProductTree;

/**
 * Add a new node to the tree under parentId (default 'root').
 */
export function addBacklogNode(projectDir, { parentId = 'root', title, description = '', projectName, db = null }) {
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

  const newNode = {
    id: generateNodeId(),
    title: title.trim(),
    description: description ? description.trim() : '',
    createdAt: new Date().toISOString(),
    children: []
  };

  parent.children.push(newNode);
  writeBacklogTree(projectDir, tree);

  return { success: true, node: newNode, tree };
}

/**
 * Update an existing node's title and/or description.
 */
export function updateBacklogNode(projectDir, id, { title, description, projectName, db = null }) {
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
  node.updatedAt = new Date().toISOString();

  writeBacklogTree(projectDir, tree);
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

  const parent = found.parent;
  parent.children = parent.children.filter(c => c.id !== id);
  writeBacklogTree(projectDir, tree);

  return { success: true, deletedId: id, tree };
}

/**
 * Move or reorder a node to a new parent or index.
 */
export function moveBacklogNode(projectDir, { id, targetParentId = 'root', index = null, projectName, db = null }) {
  if (id === 'root') {
    throw new Error('Cannot move project root node');
  }

  const tree = readBacklogTree(projectDir, projectName, db);
  const found = findNodeAndParent(tree, id);
  if (!found || !found.parent) {
    throw new Error(`Backlog node "${id}" not found`);
  }

  // Remove from old parent
  const oldParent = found.parent;
  const node = found.node;
  oldParent.children = oldParent.children.filter(c => c.id !== id);

  // Find target parent
  let targetParent = tree;
  if (targetParentId && targetParentId !== 'root') {
    const targetFound = findNodeAndParent(tree, targetParentId);
    if (!targetFound) {
      throw new Error(`Target parent "${targetParentId}" not found`);
    }
    targetParent = targetFound.node;
  }

  if (!Array.isArray(targetParent.children)) {
    targetParent.children = [];
  }

  if (typeof index === 'number' && index >= 0 && index <= targetParent.children.length) {
    targetParent.children.splice(index, 0, node);
  } else {
    targetParent.children.push(node);
  }

  writeBacklogTree(projectDir, tree);
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
  const taskTitle = (taskData.title || node.title || '').trim();
  const taskDescription = (taskData.description !== undefined ? taskData.description : (node.description || '')).trim();

  // Create the task in SQLite with status 'todo'
  const task = addTaskFn({
    title: taskTitle,
    description: taskDescription,
    priority: taskData.priority || 'medium',
    subagent_role: taskData.subagent_role || 'Fullstack Engineer',
    scope: taskData.scope || '',
    scope_size: taskData.scope_size || 'small',
    verification_cmd: taskData.verification_cmd || '',
    acceptance_criteria: taskData.acceptance_criteria || '',
    status: 'todo'
  });

  // Update node with converted task metadata
  node.taskId = task.id;
  node.taskStatus = 'todo';
  node.convertedAt = new Date().toISOString();
  if (taskDescription) {
    node.description = taskDescription;
  }
  if (taskTitle) {
    node.title = taskTitle;
  }

  writeBacklogTree(projectDir, tree);

  return { success: true, task, node, tree };
}

/**
 * Synchronize taskStatus of converted nodes with live tasks from SQLite.
 */
export function syncTaskStatusesWithTree(node, getTaskByIdFn) {
  if (!node || typeof getTaskByIdFn !== 'function') return;

  if (node.taskId) {
    try {
      const task = getTaskByIdFn(node.taskId);
      if (task) {
        node.taskStatus = task.status;
      } else {
        node.taskStatus = null;
      }
    } catch {
      node.taskStatus = null;
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      syncTaskStatusesWithTree(child, getTaskByIdFn);
    }
  }
}

/**
 * Generate a clean ASCII representation of the tree for CLI output.
 */
export function formatTreeAscii(node, prefix = '', isLast = true, isRoot = true) {
  if (!node) return '';

  let out = '';
  const taskTag = node.taskId 
    ? ` [📋 Task #${node.taskId.slice(-6)}${node.taskStatus ? ` • ${node.taskStatus.toUpperCase()}` : ''}]` 
    : '';

  if (isRoot) {
    out += `📁 ${node.title}${taskTag}\n`;
  } else {
    const branch = isLast ? '└── ' : '├── ';
    const icon = Array.isArray(node.children) && node.children.length > 0 ? '📦 ' : '• ';
    out += `${prefix}${branch}${icon}${node.title}${taskTag}\n`;
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
  writeProductTree(projectDir, tree);

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
    if (att && att.storedName) {
      const assetsDir = getProductAssetsDir(projectDir);
      const diskPath = path.join(assetsDir, att.storedName);
      if (fs.existsSync(diskPath)) {
        try { fs.unlinkSync(diskPath); } catch {}
      }
    }
    found.node.attachments = found.node.attachments.filter(a => a.id !== attId);
    writeProductTree(projectDir, tree);
  }

  return { success: true, tree };
}

