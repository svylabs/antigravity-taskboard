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
  getProjectInfo 
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
    description: 'Fetch the next actionable task in the "To Do" column (ordered by priority), including its acceptance criteria, verification command, and discussion history.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'taskboard_get_active',
    description: 'Check if there is currently an active task running in_progress or verification (strictly one task at a time).',
    inputSchema: {
      type: 'object',
      properties: {}
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
          enum: ['backlog', 'todo', 'in_progress', 'verification', 'done', 'failed'],
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
    description: 'List all tasks across all columns with their current status, priority, and comment counts.',
    inputSchema: {
      type: 'object',
      properties: {}
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
      return { found: true, task, comments };
    }
    case 'taskboard_get_active': {
      const active = getActiveTask();
      if (!active) return { active: false };
      const comments = getComments(active.id);
      return { active: true, task: active, comments };
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
      return { project: getProjectInfo().projectName, tasks: getAllTasks() };
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
