# Claude Autonomous Taskboard Instructions

When working with this repository or when the taskboard plugin is installed, follow these mandatory rules:

## 🚨 Core Rules

1. **Pre-Execution Verification Gate (Mandatory)**:
   Never begin implementing a task until its verification criteria are confirmed. Accepted formats:
   * **Automated Command**: e.g. `npm test`, `npm run build`, `test -f <file>`.
   * **Textual Criteria**: Specific acceptance criteria describing expected behavior or code rules.
   * **Explicit Exemption**: If the card explicitly states *"no verification required"* or *"none"*.
   * If criteria are blank and no exemption is specified: **DO NOT modify any code**. Post a `question` comment on the card asking for criteria, and leave the card until confirmed.

2. **Strict Sequential Execution (One Task at a Time)**:
   Complete one task completely before moving to another. Never work on multiple tasks in parallel.
   * A task must complete its entire lifecycle: implementation $\to$ verification check $\to$ status updated to `done` $\to$ walkthrough comment posted $\to$ only then proceed to the next task.

3. **Workspace Branch Isolation**:
   Always execute code tasks in an isolated git branch (`git checkout -b task-<id>`). Never write untested changes directly to `main`.

4. **Context Preservation (Comments & Follow-up Suggestions)**:
   * Post a **plan** comment before coding begins.
   * Post a **question** comment if requirements are ambiguous.
   * Display the 3 suggested follow-up tasks directly as a comment on the taskboard card (never in agent chat), formatted with embedded JSON (`<!-- FOLLOWUP_TASKS_JSON [...] -->`) so the taskboard UI displays interactive buttons to create a task, create another task, or go back.

5. **Sequential Subtask Execution**:
   If a task contains subtasks:
   * Implement them strictly in order of `order_index` (one after the other).
   * Update the subtask status to `in_progress` before coding.
   * Verify the subtask against its criteria/command before marking it `done`.
   * Never skip subtasks or attempt concurrent execution.
   * Move the parent task to `done` only after all subtasks are `done`.

6. **Black-Box CLI Utility (Never Call `view_file` on `tasks.mjs`)**:
   Always execute `tasks.mjs` via CLI or MCP tools. **NEVER call `view_file` or read `tasks.mjs`**, as doing so triggers out-of-workspace permission prompts and interrupts autonomous workflow.

---

## 🛠️ Tool Execution Methods

You can interact with the taskboard either via **MCP Tools** (if configured) or via the **CLI**:

### Using MCP Tools:
* `taskboard_poll()`: Ultra-lightweight check (<10 tokens) for active work, unread user comments, or new To-Do tasks.
* `taskboard_get_backlog()`: Retrieve the project description backlog tree from `backlog.json`.
* `taskboard_add_backlog_item(title, parentId, description)`: Add a requirement to the backlog tree in `backlog.json`.
* `taskboard_convert_backlog_item(node_id, description, priority, subagent_role)`: Convert a backlog node to an active task in `todo`.
* `taskboard_get_next()`: Fetch the next To-Do task with description, subtasks, criteria, and comment history.
* `taskboard_get_subtasks(task_id)`: Retrieve all ordered subtasks for a task.
* `taskboard_add_subtask(task_id, title, verification_cmd)`: Add an ordered subtask.
* `taskboard_update_subtask(subtask_id, status)`: Update subtask status (`in_progress`, `done`, `failed`).
* `taskboard_add_comment(task_id, content, comment_type, author)`: Post a comment (`plan`, `question`, `walkthrough`, `comment`).
* `taskboard_update_status(task_id, status, logs)`: Update status (`in_progress`, `verification`, `done`, `failed`).

### Using CLI:
```bash
# Check if there is work to do (<10 tokens)
node taskboard/tasks.mjs poll

# Backlog tree operations (stored in backlog.json, not SQLite)
node taskboard/tasks.mjs backlog
node taskboard/tasks.mjs backlog add "<TITLE>" [PARENT_ID] "[DESCRIPTION]"
node taskboard/tasks.mjs backlog convert <NODE_ID> "<PROPER_DESCRIPTION>" [PRIORITY] [ROLE]
node taskboard/tasks.mjs backlog delete <NODE_ID>

# Get next task (includes subtasks)
node taskboard/tasks.mjs next

# Manage subtasks
node taskboard/tasks.mjs subtasks <TASK_ID>
node taskboard/tasks.mjs next-subtask <TASK_ID>
node taskboard/tasks.mjs update-subtask <SUBTASK_ID> done

# Post comment
node taskboard/tasks.mjs comment <ID> "Content..." "Claude" "plan"

# Notify permission request (beeps and posts card comment)
node taskboard/tasks.mjs notify-permission <ID> "Requesting user approval"

# Play alert chime
node taskboard/tasks.mjs beep

# Attachments (Images, JSON, Plist, configs)
node taskboard/tasks.mjs attachments <TASK_ID>
node taskboard/tasks.mjs add-attachment <TASK_ID> <FILE_PATH>
node taskboard/tasks.mjs get-attachment <ATTACHMENT_ID> [OUTPUT_PATH]

# Update status
node taskboard/tasks.mjs update <ID> done "Verification passed"

# Follow-up tasks suggestions & creation
node taskboard/tasks.mjs followups <TASK_ID>
node taskboard/tasks.mjs create-followup <TASK_ID> 1
```

