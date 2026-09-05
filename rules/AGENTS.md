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
     - Leave the card in `todo` with the `❓ Question` badge visible until criteria are confirmed.

2. **Strict Sequential Execution (One Task at a Time)**:
   Complete one task completely before moving to another.
   * Never run tasks in parallel.
   * An active task must finish its entire lifecycle—implementation, verification check (automated test or textual criteria review), status updated to `done`, and walkthrough comment posted—before the supervisor may claim the next task.

3. **Verification Before Completion**:
   * If an automated command exists: execute it and ensure an exit code of `0`.
   * If textual criteria exist: the agent must evaluate the code diff against every item in the verification criteria and document the validation in the walkthrough comment.
   * If *"no verification required"*: summarize changes made and proceed to `done`.

4. **Workspace Branch Isolation**:
   Always execute code tasks in isolated branches (`Workspace: "branch"`). Never write untested changes directly to the primary working tree.

5. **Context Preservation (Plans & Walkthroughs)**:
   Always record structured comments on task cards:
   * **Implementation Plan** (`plan`) before starting coding.
   * **Questions** (`question`) if encountering ambiguities.
   * **Walkthrough** (`walkthrough`) upon successful verification.

6. **Project Scoping**:
   All database operations must target the local project's `.agents/taskboard/tasks.sqlite`. Never touch or overwrite other repositories' taskboards.

7. **Sequential Subtask Execution**:
   If a task contains subtasks:
   * Implement subtasks strictly in order of `order_index` (one after the other).
   * Update the subtask status to `in_progress` before beginning work on it.
   * Verify the subtask implementation against any subtask criteria/commands before marking it `done`.
   * Never skip subtasks or attempt to implement multiple subtasks concurrently.
   * Only transition the parent task to `verification` and `done` after all child subtasks have reached `done`.

8. **Intermediary Revision State (`needs_revision`)**:
   When a completed task receives user feedback or changes are requested, it enters the `needs_revision` column.
   * Supervisors must prioritize `needs_revision` tasks ahead of standard `todo` tasks to quickly iterate on user requests.
   * Review user comments, acknowledge them (`ack-comment`), formulate an updated implementation plan addressing the feedback, and transition to `in_progress` to implement the requested revisions.
