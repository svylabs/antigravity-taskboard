#!/usr/bin/env node
import readline from 'readline';
import { 
  getAllTasks, 
  getTaskById, 
  getNextTodoTask, 
  getActiveTask, 
  addTask, 
  updateTask, 
  getComments, 
  addComment, 
  checkPoll, 
  markTaskProcessed, 
  markCommentProcessed,
  getProjectInfo,
  getSubtasks,
  getNextSubtask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  readBacklogTree,
  addBacklogNode,
  convertBacklogNodeToTask,
  syncTaskStatusesWithTree,
  db
} from './tasks.mjs';

const TOOLS = [
  {
    name: 'taskboard_poll',
    description: 'Ultra-lightweight check (saves tokens/credits). Returns whether there is active work, unread user comments, or pending todo tasks.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'taskboard_get_next',
    description: 'Fetch the next actionable task in the "To Do" column (ordered by priority), including its subtasks, acceptance criteria, verification command, and discussion history.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'taskboard_get_active',
    description: 'Check if there is currently an active task running in_progress or verification (strictly one task at a time), including its subtasks and next subtask.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'taskboard_get_subtasks',
    description: 'Get all ordered subtasks for a task, showing their current status (todo, in_progress, done, failed).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the task' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'taskboard_add_subtask',
    description: 'Add an ordered subtask to a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the parent task' },
        title: { type: 'string', description: 'Title / goal of the subtask' },
        verification_cmd: { type: 'string', description: 'Optional automated test or verification command for this subtask' },
        acceptance_criteria: { type: 'string', description: 'Optional acceptance criteria for this subtask' },
        order_index: { type: 'number', description: 'Optional ordering index' }
      },
      required: ['task_id', 'title']
    }
  },
  {
    name: 'taskboard_update_subtask',
    description: 'Update the status of a subtask (e.g. in_progress, done, failed).',
    inputSchema: {
      type: 'object',
      properties: {
        subtask_id: { type: 'string', description: 'ID of the subtask' },
        status: { 
          type: 'string', 
          enum: ['todo', 'in_progress', 'done', 'failed'],
          description: 'New status for the subtask' 
        }
      },
      required: ['subtask_id', 'status']
    }
  },
  {
    name: 'taskboard_update_status',
    description: 'Update the lifecycle status of a task (e.g. in_progress, verification, done, failed) and optionally record logs.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the task' },
        status: { 
          type: 'string', 
          enum: ['todo', 'planned', 'in_progress', 'verification', 'done', 'failed'],
          description: 'New status for the task'
        },
        logs: { type: 'string', description: 'Optional execution logs or test output' }
      },
      required: ['task_id', 'status']
    }
  },
  {
    name: 'taskboard_add_comment',
    description: 'Post a structured comment to a task card. Use "plan" for technical approach, "question" for ambiguities, "walkthrough" for completion summaries, or "comment" for notes.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'ID of the task' },
        content: { type: 'string', description: 'Comment text or markdown' },
        comment_type: { 
          type: 'string', 
          enum: ['plan', 'question', 'walkthrough', 'comment'],
          description: 'Type of comment'
        },
        author: { type: 'string', description: 'Author name (e.g. Claude)' }
      },
      required: ['task_id', 'content']
    }
  },
  {
    name: 'taskboard_list',
    description: 'List all tasks across all columns with their current status, priority, subtask counts, and comment counts.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'taskboard_get_backlog',
    description: 'Get the hierarchical project description backlog tree from backlog.json (root is project, with nested requirements and modules).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'taskboard_add_backlog_item',
    description: 'Add a project description requirement node to the backlog tree in backlog.json.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'Parent node ID (default "root" for project root)' },
        title: { type: 'string', description: 'Title of the requirement' },
        description: { type: 'string', description: 'Optional description of the requirement' }
      },
      required: ['title']
    }
  },
  {
    name: 'taskboard_convert_backlog_item',
    description: 'Convert a backlog requirement node into an actionable task in SQLite with a proper description, placing it into To Do.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Backlog node ID to convert' },
        description: { type: 'string', description: 'Detailed description for the actionable task' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Task priority' },
        subagent_role: { type: 'string', description: 'Assigned subagent role' },
        verification_cmd: { type: 'string', description: 'Optional verification command' },
        acceptance_criteria: { type: 'string', description: 'Optional acceptance criteria' }
      },
      required: ['node_id', 'description']
    }
  }
];

function handleToolCall(name, args) {
  switch (name) {
    case 'taskboard_poll': {
      return checkPoll();
    }
    case 'taskboard_get_next': {
      const task = getNextTodoTask();
      if (!task) return { found: false, message: 'No pending tasks in todo' };
      const comments = getComments(task.id);
      const subtasks = getSubtasks(task.id);
      return { found: true, task, comments, subtasks };
    }
    case 'taskboard_get_active': {
      const active = getActiveTask();
      if (!active) return { active: false };
      const comments = getComments(active.id);
      const subtasks = getSubtasks(active.id);
      const nextSubtask = getNextSubtask(active.id);
      return { active: true, task: active, comments, subtasks, next_subtask: nextSubtask || null };
    }
    case 'taskboard_get_subtasks': {
      const subtasks = getSubtasks(args.task_id);
      return { task_id: args.task_id, subtasks };
    }
    case 'taskboard_add_subtask': {
      const subtask = addSubtask(args.task_id, {
        title: args.title,
        verification_cmd: args.verification_cmd || '',
        acceptance_criteria: args.acceptance_criteria || '',
        order_index: args.order_index
      });
      return { success: true, subtask };
    }
    case 'taskboard_update_subtask': {
      const updated = updateSubtask(args.subtask_id, { status: args.status });
      return { success: true, subtask: updated };
    }
    case 'taskboard_update_status': {
      const fields = { status: args.status };
      if (args.logs) fields.execution_logs = args.logs;
      const updated = updateTask(args.task_id, fields);
      return { success: true, task: updated };
    }
    case 'taskboard_add_comment': {
      const comment = addComment(args.task_id, {
        content: args.content,
        author: args.author || 'Claude',
        comment_type: args.comment_type || 'comment'
      });
      return { success: true, comment };
    }
    case 'taskboard_list': {
      return { project: getProjectInfo().projectName, tasks: getAllTasks().filter(t => t.status !== 'backlog') };
    }
    case 'taskboard_get_backlog': {
      const { projectDir, projectName } = getProjectInfo();
      const tree = readBacklogTree(projectDir, projectName, db);
      syncTaskStatusesWithTree(tree, getTaskById);
      return { project: projectName, tree };
    }
    case 'taskboard_add_backlog_item': {
      const { projectDir, projectName } = getProjectInfo();
      const result = addBacklogNode(projectDir, {
        parentId: args.parentId || 'root',
        title: args.title,
        description: args.description || '',
        projectName,
        db
      });
      return { success: true, node: result.node };
    }
    case 'taskboard_convert_backlog_item': {
      const { projectDir, projectName } = getProjectInfo();
      const result = convertBacklogNodeToTask(
        projectDir,
        args.node_id,
        {
          description: args.description,
          priority: args.priority || 'medium',
          subagent_role: args.subagent_role || 'Fullstack Engineer',
          verification_cmd: args.verification_cmd || '',
          acceptance_criteria: args.acceptance_criteria || ''
        },
        addTask,
        projectName,
        db
      );
      return { success: true, task: result.task, node: result.node };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Stdio JSON-RPC 2.0 Handler
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    
    // Handshake
    if (msg.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'antigravity-taskboard',
            version: '1.0.0'
          }
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    if (msg.method === 'notifications/initialized') {
      return;
    }

    // Tools List
    if (msg.method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: { tools: TOOLS }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    // Tool Call
    if (msg.method === 'tools/call') {
      const { name, arguments: args } = msg.params;
      try {
        const result = handleToolCall(name, args || {});
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      } catch (err) {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32603,
            message: err.message
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
      return;
    }

    // Default error for unhandled methods
    if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'Method not found' }
      }) + '\n');
    }
  } catch (err) {
    // Malformed JSON
  }
});
