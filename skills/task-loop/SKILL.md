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
2. **Scope-Aware Parallel Execution Gate**:
   * **Large Scope Tasks**: Any task with `scope_size: 'large'` (or touching fullstack architectures, migrations, or root configurations) must run strictly **one at a time** in complete isolation. No other task may run while a large task is active.
   * **Parallel Execution for Small / Medium Tasks**: Tasks with `scope_size: 'small'` or `'medium'` may run in parallel (up to concurrency cap of 2) ONLY when automated scope analysis confirms **zero conflicts**:
     - **Disjoint Files/Paths**: Candidate task target files/directories must not overlap with any active running tasks.
     - **Pending Review File Locks**: Files modified by tasks currently waiting in `👀 Pending Review` are locked; any candidate task touching those paths is deferred until the pending review task is approved or revised.
     - **Database Operations Gate**: Database migrations and schema changes are always strictly sequential.
   * When conflicts exist or when scope is large, the task must wait until active tasks and pending review locks clear before starting.
   * While a task is in `verification` (`👀 Pending Review`), it holds locks on its modified paths until user sign-off.
3. **Branch Isolation**:
   Always dispatch subagents in isolated git branches (`Workspace: "branch"`).
4. **Black-Box CLI Utility Gate (Never Call `view_file` on `tasks.mjs`)**:
   Always execute `tasks.mjs` via terminal commands (`node taskboard/tasks.mjs ...` or `node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs ...`). **NEVER call `view_file`, `cat`, or read `tasks.mjs` directly**, as doing so triggers cross-workspace / branch sandbox security permission dialogs and interrupts productivity.
5. **Permission Alerting & Sound Chimes**:
   Whenever an agent or subagent is waiting for user permission or approval (e.g. `state: "waiting_for_input"`, sandbox bypass, or destructive action), immediately run:
   ```bash
   node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs notify-permission <TASK_ID> "<REASON>"
   ```
   This posts an alert comment on the card and plays the system chime. The web board beeps for 5 seconds and repeats every 5 minutes until acted on.

---

## Step-by-Step Instructions

### Step 1: Lightweight Delta Poll
Run the token-saving poll command:
```bash
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs poll
```

* **If `{"has_work": false, "stop_loop": true}`**:
  The taskboard has been idle with no active tasks, todo items, revision tasks, or unread comments for a continuous 8 hours (28,800 seconds).
  1. **Stop the loop completely**: Cancel any running cron schedule (`manage_task(Action="kill", TaskId=...)`).
  2. Do NOT schedule any new timer or cron.
  3. Output a completion message to the user informing them that the loop stopped after 8 hours of inactivity to conserve resources, and can be resumed anytime.
  4. **Stop calling tools immediately.**

* **If `{"has_work": false, "stop_loop": false}`**:
  Nothing new has happened yet, but the 8-hour inactivity timeout has not elapsed. Maintain the standing recurring cron via `schedule(CronExpression="* * * * *", Prompt="Check taskboard for new tasks or comments and execute supervisor loop")` and **stop calling tools immediately** to preserve tokens.

* **If `action == "unread_user_comments"`**:
  A user replied to a task question or left feedback!
  1. Read the user's comments.
  2. Acknowledge the comment:
     ```bash
     node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs ack-comment <COMMENT_ID>
     ```
  3. Resume the task with the user's new instructions.

* **If `action == "waiting_for_user_input"`**:
  A task is waiting for user review or input in **`👀 Pending Review`**!
  The supervisor waits for the user to review, manually test, or comment. If 8 hours elapse without user response, the loop terminates.

* **If `action == "planned_task_available"`**:
  A task is in **`📋 Planned`** with its technical approach and verification criteria established!
  1. Check for any unread user comments on the card (`ack-comment <COMMENT_ID>`).
  2. Transition task status to `in_progress`:
     ```bash
     node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update <ID> in_progress
     ```
  3. Dispatch subagent in an isolated workspace branch (`Workspace: "branch"`) to implement the plan.

* **If `action == "todo_task_available"`**:
  A new task is in **`📋 To Do`**. Proceed to **Step 2 (Verification Gate & Plan Creation)** to formulate the technical plan. Posting the plan comment automatically moves the task to **`Planned`**.

* **If `action == "parallel_candidate_available"`**:
  A candidate task (`candidate_task`) has been evaluated by the scope engine and cleared for parallel execution alongside running tasks (`active_tasks`)!
  1. Scope analysis confirmed zero file overlaps, small/medium scope, and no pending review locks.
  2. If the candidate task is in `planned`, move to `in_progress` and dispatch subagent. If in `todo`, formulate plan first.

* **If `action == "monitor_active"`**:
  Active task(s) are in progress and any candidate task is either deferred due to scope conflict / large scope, or max concurrency (2) is reached. Monitor active task(s) to completion.
  - When inspecting active subagents via `manage_subagents(Action: "list")`:
    If a subagent's `state` is `"waiting_for_input"` (waiting on user permission, bypass sandbox, or confirmation):
    ```bash
    node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs notify-permission <TASK_ID> "<stateDetail>"
    ```
    This immediately posts a permission comment to the card and sounds the system alert chime.

---

### Step 2: Verification Gate Confirmation & Implementation Plan (Just-in-Time)
Formulate the technical plan for the single candidate task **just-in-time**. Never batch-plan or mass-plan multiple `todo` tasks upfront, as active tasks or preceding tasks will drift the codebase and invalidate upfront plans. Once a task is advanced to `planned`, it is prioritized for immediate execution into `in_progress`.

Inspect the task's criteria:
* **Explicit Exemption**: Card states *"no verification required"* or *"none"* $\to$ post structured Markdown plan comment citing exemption. Posting the plan automatically advances the card to **`Planned`**.
* **Automated Command**: `verification_cmd` is specified $\to$ post structured Markdown plan citing command. Posting the plan automatically advances the card to **`Planned`**.
* **Textual / Manual Criteria**: `acceptance_criteria` specified $\to$ post structured Markdown plan summarizing checklist. Posting the plan automatically advances the card to **`Planned`**.
* **Missing / Ambiguous**:
  - **DO NOT modify code or spawn subagents.**
  - Post a `question` comment:
    ```bash
    node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <ID> "Pre-execution Gate: No verification criteria provided. Please confirm automated command, textual checklist, or specify 'no verification required'." "Supervisor" "question"
    ```
  - This automatically transitions the card to `verification` (**`👀 Pending Review`**).
  - Suspend and wait for the user to provide criteria or clarification.

#### 📋 Mandatory Plan Comment Formatting
Plan comments (`comment_type: "plan"`) **must always be structured Markdown** with a header, discrete numbered steps on separate lines, backticked file paths/identifiers, and verification details. Never cram plans into a single run-on sentence.
```bash
node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <ID> "### Implementation Plan
1. **Scope / Setup**: Description of component changes in \`path/to/file.js\`.
2. **Logic & Data**: Core implementation details and API contracts.
3. **Integration**: Wire up entry points and register configuration.

**Verification**: [Automated: npm test | Acceptance checklist | Manual user verification | Explicit exemption: N/A]" "Supervisor" "plan"
```

---

### Step 3: Verify & Transition to Pending Review for User Approval
When the subagent finishes:
1. In `in_progress`, evaluate verification:
   * **If automated command**: run it with `run_command` (must exit 0).
   * **If textual / manual criteria**: evaluate diffs against each item in the checklist and document manual testing steps.
   * **If no verification required**: confirm changes are complete.
2. Post structured walkthrough comment with clickable repository file links and manual testing steps:
   ```bash
   node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs comment <ID> "### Walkthrough
Verified changes against criteria:
- Created [backend/src/db/migrator.js](/repo/backend/src/db/migrator.js): core migration runner.
- Updated [docs/database.md](/repo/docs/database.md): migration documentation.
- Verification: npm test passed with exit code 0." "Subagent" "walkthrough"
   ```
3. Transition card status to `verification` (**`👀 Pending Review`**):
   ```bash
   node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs update <ID> verification "Implementation complete; awaiting user manual verification and review."
   ```
4. If automated verification failed:
   * Mark card `failed` with failure logs.
5. While the card is in **`👀 Pending Review`**, keep the standing 1-minute recurring cron active (`schedule(CronExpression="* * * * *", Prompt="Check taskboard for new tasks or comments and execute supervisor loop", IsDaemon=false)`). The supervisor pauses code execution to allow user manual testing, but the background cron continues checking every 60s so user feedback, comments, approvals (`done`), or moves back to `todo`/`planned` are detected and picked up autonomously within 1 minute. Once the user approves or requests revision, proceed back to Step 1.
