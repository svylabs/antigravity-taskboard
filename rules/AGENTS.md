# Taskboard & Subagent Autonomous Execution Rules

When executing tasks under the `antigravity-taskboard` plugin, all subagents and supervisor agents must strictly adhere to the following rules:

1. **Pre-Execution Verification Gate (Mandatory)**:
   Never begin implementing a task without first confirming the verification criteria and automated verification command (`verification_cmd`).
   * If a task lacks an automated verification command or has ambiguous acceptance criteria:
     - **DO NOT modify any code or spawn subagents.**
     - Post a `question` comment on the card asking for or proposing an automated test command (e.g. `npm test <file>` or `test -f <output>`).
     - Leave the card in `todo` or `backlog` with the `❓ Question` badge visible until criteria are confirmed.

2. **Strict Sequential Execution (One Task at a Time)**:
   Complete one task completely before moving to another.
   * Never run tasks in parallel.
   * An active task must finish its entire lifecycle—implementation, automated verification pass (exit code `0`), status updated to `done`, and walkthrough comment posted—before the supervisor may claim the next task.

3. **Workspace Branch Isolation**:
   Always execute code tasks in isolated branches (`Workspace: "branch"`). Never write untested changes directly to the primary working tree.

4. **Automated Verification Before Completion**:
   Never mark a task `done` in the SQLite taskboard without first running the task's `verification_cmd` with an exit code of `0`.

5. **Context Preservation (Plans & Walkthroughs)**:
   Always record structured comments on task cards:
   * **Implementation Plan** (`plan`) before starting coding.
   * **Questions** (`question`) if encountering ambiguities.
   * **Walkthrough** (`walkthrough`) upon successful verification.

6. **Project Scoping**:
   All database operations must target the local project's `.agents/taskboard/tasks.sqlite`. Never touch or overwrite other repositories' taskboards.
