# Taskboard & Subagent Autonomous Execution Rules

When executing tasks under the `antigravity-taskboard` plugin, all subagents and supervisor agents must strictly adhere to the following rules:

1. **Pre-Execution Verification Gate (Mandatory)**:
   Never begin implementing a task without first confirming the verification criteria. Verification criteria can be provided in any of the following 3 ways:
   * **Automated Command** (e.g. `npm test`, `npm run build`, `test -f <file>`).
   * **Textual Verification Criteria** (e.g. specific acceptance criteria describing expected behavior, UI state, API contracts, or code rules that the agent can evaluate and check against).
   * **Explicit Exemption**: If the task explicitly states *"no verification required"* (or *"none"* / *"N/A"*), the task is allowed to proceed immediately.
   * **Missing/Ambiguous Criteria**: If a task has no verification criteria, no automated command, and does not state *"no verification required"*:
     - **DO NOT modify any code or spawn subagents.**
     - Post a `question` comment on the card asking for verification criteria or proposing a verification plan.
     - The task automatically moves to `verification` (`👀 Pending Review`) until criteria are confirmed by the user.

2. **Scope-Aware Execution & Parallel Conflict Gate**:
   * **Large Scope Tasks**: Any task with `scope_size: 'large'` (or touching fullstack architectures, migrations, or root configurations) must run strictly **one at a time** in complete isolation. No other task may run while a large task is active.
   * **Parallel Execution for Small / Medium Tasks**: Tasks with `scope_size: 'small'` or `'medium'` may run in parallel (up to concurrency cap of 2) ONLY when automated scope analysis confirms **zero conflicts**:
     - **Disjoint Files/Paths**: Candidate task target files/directories must not overlap with any active running tasks.
     - **Pending Review File Locks**: Files modified by tasks currently waiting in `👀 Pending Review` are locked; any candidate task touching those paths is deferred until the pending review task is approved or revised.
     - **Database Operations Gate**: Database migrations and schema changes are always strictly sequential.
   * When conflicts exist or when scope is large, the task must wait until active tasks and pending review locks clear before starting.
   * While a task is in `verification` (`👀 Pending Review`), it holds locks on its modified paths until user sign-off.

3. **Verification, Walkthrough & Follow-up Suggestions Before User Review**:
   * If an automated command exists: execute it and ensure an exit code of `0`.
   * If textual criteria or manual verification exist: the agent must evaluate the code diff against every item in the verification criteria and document the validation in the walkthrough comment.
   * **Mandatory 3 Follow-up Suggestions in Taskboard Comment**: When implementation is finished, the agent must formulate **3 concrete, high-value follow-up tasks** based on the implemented code changes (e.g. next logical feature increment, edge case/integration tests, performance hardening, or documentation).
   * **Displayed Directly as a Comment in Taskboard (Not within Antigravity itself)**:
     - **DO NOT** prompt or ask the user in Antigravity chat (never call `ask_question` or block execution in the chat for follow-ups).
     - The 3 follow-up suggestions must be posted directly as a structured comment on the taskboard card (within the walkthrough comment).
     - The taskboard web UI dynamically renders interactive action buttons directly inside the comment card:
       * `➕ Create Task` on each suggested task to queue it into To Do on the board with one click.
       * `✏️ Customize` to prefill the task creation modal.
       * `➕ Create Another Task` to queue multiple follow-ups or add a custom task.
       * `↩️ Go Back` to collapse or return to the card view.
   * For all tasks upon completing implementation and validation, transition the card to `verification` (`👀 Pending Review`) with this detailed walkthrough for user sign-off. The user approves (`done`) or requests revision (`needs_revision`).

4. **Workspace Branch Isolation**:
   Always execute code tasks in isolated branches (`Workspace: "branch"`). Never write untested changes directly to the primary working tree.

5. **Context Preservation (Plans, Walkthroughs & Follow-up Suggestions)**:
   Always record structured comments on task cards:
   * **Implementation Plan** (`plan`) before starting coding: Must use Markdown header (`### Implementation Plan`), numbered lists on discrete lines (`1. **Step**: description with \`file/path\``), and explicit verification notes. Never write single-line run-on plans.
   * **Questions** (`question`) if encountering ambiguities.
   * **Walkthrough** (`walkthrough`) upon successful verification: Must use Markdown bullets (`- File changes: ...`, `- Verification: ...`), followed by `### Suggested Follow-up Tasks` with 3 numbered suggestions and `<!-- FOLLOWUP_TASKS_JSON [...] -->`.

6. **Project Scoping**:
   All database operations must target the local project's `.agents/taskboard/tasks.sqlite`. Never touch or overwrite other repositories' taskboards.

7. **Sequential Subtask Execution**:
   If a task contains subtasks:
   * Implement subtasks strictly in order of `order_index` (one after the other).
   * Update the subtask status to `in_progress` before beginning work on it.
   * Verify the subtask implementation against any subtask criteria/commands before marking it `done`.
   * Never skip subtasks or attempt to implement multiple subtasks concurrently.
   * Only transition the parent task to `verification` and `done` after all child subtasks have reached `done`.

8. **Planned State, Just-in-Time Planning & Revision Feedback Loop (`planned`)**:
   * **Just-in-Time Single-Task Planning**: Tasks in `todo` are **never** mass-planned all at once. The orchestrator evaluates and selects candidate tasks strictly one at a time (`LIMIT 1`). Planning is performed *just-in-time* immediately before execution to prevent stale plans caused by code drift.
   * **Plan Formulation**: When a candidate task in `todo` is claimed for planning, the agent formulates a structured implementation plan and posts it as a `plan` comment. Creating the plan automatically advances the task from `todo` to **`Planned` (`planned`)**.
   * **Execution Priority from Planned**: Tasks in `planned` have confirmed technical approaches and verification criteria, and are immediately prioritized for execution into `in_progress` ahead of any remaining `todo` tasks.
   * **Strict Scope Gate Compliance (Honoring Rule 2)**: All planning and execution must strictly honor the Scope-Aware Execution & Parallel Conflict Gate:
     - If an active task is `scope_size: 'large'`, no subsequent task can be planned or executed until the large task finishes.
     - If a candidate task touches files locked by an active task or a task in `👀 Pending Review`, planning and execution are deferred.
     - Only disjoint small/medium tasks may run in parallel up to the concurrency cap of 2.
   * **Revision Feedback**: When a completed or reviewed task receives user change requests or feedback, it returns to the `planned` column with comments flagged for the agent. The agent acknowledges comments (`ack-comment`), updates the implementation plan, and executes the revisions.
   * **Immediate Execution after Planning in Autonomous Mode**:
     - When Autonomous Mode is enabled (`autonomous_mode == true`), a task **MUST NOT WAIT** after moving to `planned`. The supervisor immediately advances the task to `in_progress` (`node taskboard/tasks.mjs update <TASK_ID> in_progress`) and launches the subagent in `Workspace: "branch"` in the very same turn.
     - When Autonomous Mode is disabled (`autonomous_mode == false`), the task pauses in `planned` awaiting user review and click on `▶️ Proceed` (or reply comments).

9. **Idle Loop Auto-Termination (8-Hour Inactivity Timeout)**:
   When the taskboard has had no active tasks, no pending todo/revision tasks, and no unread user comments for a continuous 8 hours (28,800 seconds):
   * The autonomous loop supervisor must terminate execution and cancel any recurring cron/timer schedules.
   * Configurable via `TASKBOARD_IDLE_TIMEOUT` (default: `28800`, or `0` for infinite keep-alive).
   * Notify the user that the loop has stopped due to 8 hours of inactivity to conserve tokens.

10. **Standing 1-Minute Recurring Supervisor Cron (`* * * * *`)**:
    * Whenever the taskboard is in active use, the supervisor must maintain a standing 1-minute recurring schedule (`schedule(CronExpression="* * * * *", Prompt="Poll taskboard for new tasks or comments", IsDaemon=false)`).
    * **Never Cancel on Pending Review**: When a task completes and moves to `👀 Pending Review`, the recurring cron remains active. Every 60s, it executes `tasks.mjs poll` so that user comments, card moves, approvals, and revision requests are automatically detected and acted upon without requiring chat prompts.
    * **Single Cancellation Condition**: The cron is only cancelled when `stop_loop: true` is returned after 8 continuous hours of inactivity (or if explicitly stopped by user).

11. **Black-Box CLI Utility Gate (Never Call `view_file` on `tasks.mjs`)**:
    * All subagents and supervisor agents must treat `tasks.mjs` strictly as a black-box executable CLI utility.
    * **DO NOT use `view_file`, `cat`, or read `tasks.mjs`**. Reading `tasks.mjs` directly triggers out-of-workspace file permission prompts and breaks autonomous flow.
    * All supported commands and arguments are fully documented here:
      - **Poll Delta**: `node taskboard/tasks.mjs poll` (or `node .agents/plugins/antigravity-taskboard/taskboard/tasks.mjs poll`)
      - **Get Next Task**: `node taskboard/tasks.mjs next`
      - **Get Subtasks**: `node taskboard/tasks.mjs subtasks <TASK_ID>`
      - **Update Subtask**: `node taskboard/tasks.mjs update-subtask <SUBTASK_ID> in_progress|done|failed`
      - **Post Comment**: `node taskboard/tasks.mjs comment <TASK_ID> "<CONTENT>" "<AUTHOR>" "<plan|walkthrough|question|comment>"`
      - **Update Task Status**: `node taskboard/tasks.mjs update <TASK_ID> in_progress|verification|done|failed "<LOGS>"`
      - **Acknowledge User Comment**: `node taskboard/tasks.mjs ack-comment <COMMENT_ID>`
      - **Permission Alert & Beep**: `node taskboard/tasks.mjs notify-permission [TASK_ID] "<REASON>"`
      - **Play Alert Chime**: `node taskboard/tasks.mjs beep`
      - **List Tasks (ASCII Kanban)**: `node taskboard/tasks.mjs list`
      - **Get Task Details**: `node taskboard/tasks.mjs get <TASK_ID>`
      - **List Attachments**: `node taskboard/tasks.mjs attachments <TASK_ID>`
      - **Download Attachment**: `node taskboard/tasks.mjs get-attachment <ID> [OUTPUT_PATH]`
      - **Get Follow-up Suggestions**: `node taskboard/tasks.mjs followups <TASK_ID>`
      - **Create Follow-up Task**: `node taskboard/tasks.mjs create-followup <TASK_ID> <INDEX>`
      - **Toggle / Check Autonomous Mode**: `node taskboard/tasks.mjs autonomous [on|off|status]`

12. **Permission Request Alerts & Beeps**:
    * Whenever an agent or subagent needs user approval (e.g. sandbox bypass, destructive action, or subagent entering `waiting_for_input`), it must immediately run:
      `node taskboard/tasks.mjs notify-permission <TASK_ID> "<TOOL_OR_PERMISSION_DETAILS>"`
    * This posts a `comment_type: 'permission'` card comment and sounds the system chime. The web board activates the attention banner and chimes every 5 minutes until acted on.

13. **Autonomous Mode (`autonomous_mode`)**:
    * When Autonomous Mode is enabled (`autonomous_mode == true` or `node taskboard/tasks.mjs autonomous status` returns true, or toggled on in the taskboard UI):
      - **Tasks do NOT wait after planned**: Once the implementation plan is formulated and posted, the task enters `planned` and must not wait for user approval or clicking `▶️ Proceed`. The supervisor immediately advances the task to `in_progress` and dispatches the subagent to execute without pausing.
      - **Tasks do NOT wait until manually reviewed**: Once verification passes (automated command exits 0 or criteria evaluated) and the walkthrough with 3 follow-up suggestions is posted, the supervisor marks the card directly as `done`:
        `node taskboard/tasks.mjs update <TASK_ID> done "Verified and auto-approved in Autonomous Mode."`
      - Any tasks sitting in `verification` (`👀 Pending Review`) are auto-approved to `done` and will not block candidate tasks from running.
      - The autonomous loop supervisor immediately proceeds to the next candidate task in `planned` / `todo` without halting for human sign-off.
    * When Autonomous Mode is disabled (default):
      - Planned tasks hold in `planned` awaiting user plan review and approval ("Proceed").
      - Completed tasks hold in `verification` (`👀 Pending Review`) for manual user testing, feedback, and approval.

