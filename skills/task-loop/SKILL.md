---
name: task-loop
description: Autonomous task loop orchestrator with token-efficient change detection (processed_by_agent flags), pre-execution verification gate, and strict sequential single-task execution.
---

# Antigravity Task Loop Supervisor (Plugin Edition)

This skill equips Antigravity to act as an autonomous engineering supervisor. It monitors the project-scoped SQLite taskboard (`.agents/taskboard/tasks.sqlite`), uses **ultra-lightweight delta polling (`poll`)** to minimize Antigravity credit/token consumption, enforces a **pre-execution verification gate**, and ensures **strict single-task sequential execution**.

---

## ⚡ Token-Saving Architecture (`processed_by_agent`)

To prevent burning credits during recurring schedule wakeups:
1. **Delta Polling**: When waking up, run:
   ```bash
   node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs poll
   ```
   * If nothing has changed: Returns `{"has_work": false}` (**~4 tokens total**).
   * Antigravity immediately goes back to sleep without dumping tables or doing heavy LLM reasoning.
2. **Read-Receipt Flags**: Every comment and task tracks `processed_by_agent`:
   * Comments written by the agent are auto-flagged as `processed_by_agent = 1`.
   * User comments start at `processed_by_agent = 0`.
   * Once Antigravity reads a user comment, it acknowledges it:
     ```bash
     node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs ack-comment <COMMENT_ID>
     ```

---

## 🚨 Non-Negotiable Core Rules

1. **Pre-Execution Verification Gate**:
   Never begin implementing a task until its verification criteria are confirmed. Accepted formats:
   * **Automated Command** (`verification_cmd`, e.g. `npm test` or `npm run build`).
   * **Textual Criteria** (`acceptance_criteria`, e.g. bullet points of expected behavior, edge cases, and code rules to check against).
   * **Explicit Exemption**: If the card states *"no verification required"* or *"none"*.
   * If criteria are blank and no exemption is given, post a `question` comment and do not start.
2. **Complete One Task Before Moving to Another**:
   Never pick up a new task while another is in progress. The active task must complete its entire cycle (implementation $\to$ verification $\to$ marked `done` $\to$ walkthrough comment posted) before the next task can be claimed.
3. **Branch Isolation**:
   Always dispatch subagents in isolated git branches (`Workspace: "branch"`).

---

## Step-by-Step Instructions

### Step 1: Lightweight Delta Poll
Run the token-saving poll command:
```bash
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs poll
```

* **If `{"has_work": false}`**:
  Nothing new has happened. Set recurring cron via `schedule(CronExpression="*/2 * * * *", Prompt="Check taskboard for new tasks")` and **stop calling tools immediately** to preserve tokens.

* **If `action == "unread_user_comments"`**:
  A user replied to a task question or left feedback!
  1. Read the user's comments.
  2. Acknowledge the comment:
     ```bash
     node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs ack-comment <COMMENT_ID>
     ```
  3. Resume the task with the user's new instructions.

* **If `action == "todo_task_available"`**:
  A new task is ready. Proceed to **Step 2 (Verification Gate)**.

* **If `action == "monitor_active"`**:
  A task is already in progress. Focus on finishing its verification and marking it `done`.

---

### Step 2: Verification Gate Confirmation
Inspect the task's criteria:
* **Explicit Exemption**: Card states *"no verification required"* or *"none"* $\to$ claim task, post plan comment citing exemption, and spawn subagent.
* **Automated Command**: `verification_cmd` is specified $\to$ claim task, post plan citing command, and spawn subagent.
* **Textual Criteria**: `acceptance_criteria` specified $\to$ claim task, post plan summarizing checklist, and spawn subagent.
* **Missing / Ambiguous**:
  - **DO NOT modify code or spawn subagents.**
  - Post a `question` comment:
    ```bash
    node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <ID> "Pre-execution Gate: No verification criteria provided. Please confirm automated command, textual checklist, or specify 'no verification required'." "Supervisor" "question"
    ```
  - Leave card in `todo` with the `❓ Question` badge and suspend.

---

### Step 3: Verify & Complete Before Next Task
When the subagent finishes:
1. Update card status to `verification`.
2. Evaluate verification:
   * **If automated command**: run it with `run_command` (must exit 0).
   * **If textual criteria**: evaluate diffs against each item in the checklist.
   * **If no verification required**: confirm changes are complete.
3. If verified:
   * Mark card `done`:
     ```bash
     node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update <ID> done "Verification criteria satisfied."
     ```
   * Post walkthrough comment:
     ```bash
     node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <ID> "Walkthrough: Verified changes against criteria. Modified files: <FILES>." "Subagent" "walkthrough"
     ```
4. If failed:
   * Mark card `failed` with failure logs.
5. **Only now that this task is complete**, proceed back to Step 1 for the next task.
