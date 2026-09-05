# Taskboard & Subagent Autonomous Execution Rules

When executing tasks under the `antigravity-taskboard` plugin, all subagents must adhere to the following rules:

1. **Workspace Branch Isolation**:
   Always execute code tasks in isolated branches (`Workspace: "branch"`). Never write untested changes directly to the primary branch.

2. **Automated Verification Before Completion**:
   Never mark a task `done` in the SQLite taskboard without first running the task's `verification_cmd` with an exit code of `0`.

3. **Context Preservation**:
   Record concise, informative summaries in `execution_logs` so human developers inspecting the Kanban board can understand what was modified and why.

4. **Project Scoping**:
   All database operations must target the local project's `.agents/taskboard/tasks.sqlite`. Never touch or overwrite other repositories' taskboards.
