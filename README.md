# Antigravity Taskboard Plugin

An autonomous engineering supervisor and Trello-style Kanban board plugin for **Google Antigravity**.

Provides continuous task loop orchestration with **project-scoped SQLite persistence**—allowing you to track, schedule, and run subagents completely inside Antigravity without external daemons or SDKs.

---

## 📸 Screenshots & UI Examples

### 1. Autonomous Kanban Taskboard
A live, responsive drag-and-drop board tracking subagent tasks across the entire engineering lifecycle: **Backlog**, **To Do**, **Needs Revision**, **In Progress**, **Pending Review**, **Done**, and **Failed**. Cards feature real-time status badges (`⚡ Agent Working`, `❓ Waiting for You`), target subagent roles, priority tags, subtask progress meters, verification criteria indicators, and parallel execution scope size pills (`SMALL`, `MEDIUM`, `LARGE`).

![Antigravity Taskboard Kanban View](assets/screenshots/kanban-board.png)

### 2. Structured Task Specification Modal
Define tasks with pre-execution acceptance criteria checklists, automated verification test scripts, ordered subtasks for sequential execution, image/screenshot attachments (via clipboard paste or drag & drop), and parallel execution scope boundaries.

![Create Task Modal](assets/screenshots/create-task-modal.png)

---

## ⚡ Core Features

* **Pre-Execution Verification Gate**: Ensures subagents never write untested code or make assumptions without explicit criteria, automated test commands, or an explicit exemption.
* **Scope-Aware Parallel Execution**: Automatically detects file conflicts and scope size. Disjoint small/medium tasks run in parallel, while large tasks and database migrations execute strictly sequentially.
* **Pending Review File Locks**: Files modified by tasks currently waiting in **`👀 Pending Review`** remain locked until user sign-off.
* **Needs Revision Feedback Loop**: Completed tasks can be reopened to **`📝 Needs Revision`** with 1-click comment feedback, prioritized ahead of new backlog tasks.
* **5-Day Done Filter & Dedicated Done Archive (`/done`)**: Main Kanban board limits the Done column to tasks completed within the last 5 days (`✅ Done (≤5d)`); a dedicated archive page at `/done` provides categorized views by Scope/Label, Subagent Role, Priority, or Date Completed with instant search and 1-click reopen.
* **Multi-Format SQLite BLOB Attachments**: Attach any file format (Images, JSON, iOS Plist, XML, YAML, configs, logs, etc.) up to 10MB via clipboard paste (<kbd>Ctrl+V</kbd> / <kbd>⌘+V</kbd>), file browsing, or drag & drop. Automatically stored in SQLite and accessible to agents.
* **Native Repository File Viewer (`/repo/*`)**: Browse project directories, preview Markdown docs with breadcrumbs, and inspect syntax-highlighted code files directly from task comments.
* **Audio Alerts & 5-Minute Reminder Loop**: Web Audio chime when a task enters **`👀 Pending Review`**, **`📋 Plan Created`**, **`❓ Questions`**, or **`⚠️ Permission Requested`**. Sounds an initial 5-second chime, followed by 2-second reminders every 5 minutes until acted on (automatically silences on card move, review approval, or reply).
* **Token-Efficient Delta Polling (`poll`)**: Recurring cron wakeups inspect SQLite read-receipt flags (`processed_by_agent`) and return in ~4 tokens when idle.
* **8-Hour Auto-Termination**: Automatically terminates the autonomous supervisor loop after 8 continuous hours of inactivity to conserve tokens.

---

## 🗄️ Multi-Project Architecture: Is SQLite Shared or Different?

**Each project gets its own separate SQLite database.**

* **Project-Scoped by Default**: When the plugin runs, it resolves the active project directory (`process.cwd()`) and connects to:
  ```text
  <PROJECT_ROOT>/.agents/taskboard/tasks.sqlite
  ```
* **Clean Isolation**:
  - `Project A` (e.g. `doraapp`) has its own backlog, bugs, and subagent logs.
  - `Project B` (e.g. `mobile-app`) has its own independent tasks and board.
  - No cross-contamination between repositories.
* **Custom Override**: If you ever want a single shared database across all repositories, set `TASKBOARD_DB_PATH=/path/to/shared.sqlite`.

---

## 📦 Directory Structure

```text
antigravity-taskboard/
├── plugin.json                 # Antigravity Plugin Manifest
├── README.md                   # Documentation & UI Examples
├── assets/                     # Screenshots & Media
│   └── screenshots/
│       ├── kanban-board.png
│       └── create-task-modal.png
├── skills/                     # Bundled Skills
│   └── task-loop/
│       └── SKILL.md            # Autonomous supervisor loop skill
├── rules/
│   └── AGENTS.md               # Safety bounds, parallel execution & verification rules
└── taskboard/                  # Shared Engine & Web UI
    ├── board.html              # Drag-and-drop Kanban Board
    ├── server.mjs              # Micro-server (Port 4040)
    ├── repo_viewer.mjs         # Repository file & code viewer
    └── tasks.mjs               # Project-scoped SQLite CLI & API
```

---

## 🚀 Quick Start in Any Project

### 1. Launch the Trello Board UI
```bash
node .agents/plugins/antigravity-taskboard/taskboard/server.mjs
```
Open **`http://localhost:4040`** in your browser. The board header will dynamically display your project's name.

### 2. Start the Continuous Loop
In your Antigravity conversation, simply type:
> *"Run the task loop"* or `/goal Run task loop`

Antigravity will:
1. Fetch the next task from the project's SQLite `todo` or `needs_revision` column.
2. Check for parallel candidates if small/medium and disjoint from active tasks.
3. Spawn a subagent in an isolated git branch (`Workspace: "branch"`).
4. Run automated verification commands or evaluate acceptance criteria.
5. Move the card to `👀 Pending Review` with a structured walkthrough for user sign-off.
6. Continue looping until all pending tasks are resolved.

---

## Installation

```bash
git clone https://github.com/svylabs/antigravity-taskboard.git .agents/plugins/antigravity-taskboard
```

---

## 🤖 CLI Command Reference for Antigravity Agents

> ⛔ **Mandatory Rule for Agents & Subagents**: Treat `tasks.mjs` strictly as a **black-box executable CLI utility**. **NEVER call `view_file`, `cat`, or read `tasks.mjs` directly.** Reading `tasks.mjs` triggers out-of-workspace/branch security permission dialogs and interrupts the user. All supported CLI commands, syntax, and examples are documented below.

### 1. Polling & Loop Orchestration (Ultra-Lightweight)
```bash
# Check for unread comments, todo tasks, or 8-hour inactivity (~4 tokens when idle)
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs poll

# List currently active running tasks
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs active

# Fetch the next candidate task (checks 'planned' first, then 'todo')
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs next

# Analyze parallel scope conflicts for a task against active & review tasks
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs check-conflict <TASK_ID>

# Reset the 8-hour inactivity timer
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs reset-idle
```

### 2. Task Lifecycle & Status Updates
```bash
# Print ASCII Kanban board with badges and counts
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs list

# Dump full board state in JSON
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs json

# Get complete JSON details of a specific task (including subtasks & attachments)
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs get <TASK_ID>

# Create a new task in To Do
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs add "<TITLE>" "[DESCRIPTION]" "[PRIORITY]" "[VERIFICATION_CMD]"

# Update task status (in_progress | verification | planned | done | failed)
# Note: Transitioning to 'verification' or 'planned' automatically sounds the alert chime
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update <TASK_ID> in_progress
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update <TASK_ID> verification "Implementation complete; ready for review"
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update <TASK_ID> done "Verification passed"
```

### 3. Ordered Sequential Subtasks
```bash
# List all subtasks for a task ordered by order_index
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs subtasks <TASK_ID>

# Fetch the next incomplete subtask
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs next-subtask <TASK_ID>

# Add a subtask
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs add-subtask <TASK_ID> "<TITLE>" [ORDER_INDEX] "[VERIFICATION_CMD]"

# Update subtask status (in_progress | done | failed)
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update-subtask <SUBTASK_ID> in_progress
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update-subtask <SUBTASK_ID> done
```

### 4. Structured Comments & Acknowledgements
```bash
# Post structured comment (plan | walkthrough | question | permission | comment)
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <TASK_ID> "### Implementation Plan..." "Supervisor" "plan"
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <TASK_ID> "### Walkthrough..." "Subagent" "walkthrough"
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <TASK_ID> "Clarification needed..." "Subagent" "question"

# Retrieve all comments for a task
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comments <TASK_ID>

# Acknowledge an unread user comment (marks processed_by_agent = 1)
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs ack-comment <COMMENT_ID>
```

### 5. Permission Request Alerts & Audio Chimes
```bash
# Post a permission request alert to the active card and sound the notification chime
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs notify-permission [TASK_ID] "<REASON_OR_TOOL_DETAILS>"

# Play system notification chime (macOS Ping sound / terminal bell)
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs beep
```

### 6. Attachments & Multi-Format Files
```bash
# List attachments on a task
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs attachments <TASK_ID>

# Attach a local file (Images, JSON, Plist, XML, YAML, configs, logs) to a task
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs add-attachment <TASK_ID> <FILE_PATH>

# Export/download an attachment to local disk
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs get-attachment <ATTACHMENT_ID> <OUTPUT_PATH>

# Delete an attachment
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs delete-attachment <ATTACHMENT_ID>
```

