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

4. **Context Preservation (Comments)**:
   * Post a **plan** comment before coding begins.
   * Post a **question** comment if requirements are ambiguous.
   * Post a **walkthrough** comment summarizing changes and verification checks upon completion.

---

## 🛠️ Tool Execution Methods

You can interact with the taskboard either via **MCP Tools** (if configured) or via the **CLI**:

### Using MCP Tools:
* `taskboard_poll()`: Ultra-lightweight check (<10 tokens) for active work, unread user comments, or new To-Do tasks.
* `taskboard_get_next()`: Fetch the next To-Do task with description, criteria, and comment history.
* `taskboard_add_comment(task_id, content, comment_type, author)`: Post a comment (`plan`, `question`, `walkthrough`, `comment`).
* `taskboard_update_status(task_id, status, logs)`: Update status (`in_progress`, `verification`, `done`, `failed`).

### Using CLI:
```bash
# Check if there is work to do (<10 tokens)
node taskboard/tasks.mjs poll

# Get next task
node taskboard/tasks.mjs next

# Post comment
node taskboard/tasks.mjs comment <ID> "Content..." "Claude" "plan"

# Update status
node taskboard/tasks.mjs update <ID> done "Verification passed"
```
