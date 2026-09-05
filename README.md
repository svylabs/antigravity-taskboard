# Antigravity Taskboard Plugin

An autonomous engineering supervisor and Trello-style Kanban board plugin for **Google Antigravity**.

Provides continuous task loop orchestration with **project-scoped SQLite persistence**—allowing you to track, schedule, and run subagents completely inside Antigravity without external daemons or SDKs.

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
├── README.md                   # This documentation
├── skills/                     # Bundled Skills
│   └── task-loop/
│       └── SKILL.md            # Autonomous supervisor loop skill
├── rules/
│   └── AGENTS.md               # Safety bounds & verification rules
└── taskboard/                  # Shared Engine & Web UI
    ├── board.html              # Drag-and-drop Kanban Board
    ├── server.mjs              # Micro-server (Port 4040)
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
1. Fetch the next task from the project's SQLite `todo` column.
2. Spawn a subagent in an isolated git branch (`Workspace: "branch"`).
3. Wait reactively until the subagent finishes.
4. Run the task's automated verification command.
5. Move the card to `Done` (or `Failed`) on the Trello board.
6. Continue looping until all pending tasks are resolved.

---

## 🌐 Publishing Options

### Option A: Install Globally on Your Machine
Copy the plugin folder to your global Antigravity configuration so it is available in **every project**:
```bash
cp -r .agents/plugins/antigravity-taskboard ~/.gemini/config/plugins/
```

### Option B: Publish as a Public GitHub Repository
1. Initialize a git repository inside `.agents/plugins/antigravity-taskboard/`.
2. Push to GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: initial release of antigravity-taskboard plugin"
   git remote add origin https://github.com/<your-username>/antigravity-taskboard.git
   git push -u origin main
   ```
3. Other developers can now install it in their own repositories:
   ```bash
   git clone https://github.com/<your-username>/antigravity-taskboard.git .agents/plugins/antigravity-taskboard
   ```
