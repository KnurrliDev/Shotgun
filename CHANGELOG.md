# Changelog

## 0.1.0

This version has no release yet. Each phase of `implementation-plan.md` adds its items.

### Phase 1: foundation

- Shotgun is a VS Code extension. It needs DataFlow 0.6.0 or a later version, and VS Code 1.143 or a later version.
- Tasks: the commands **Shotgun: New Task** and **Shotgun: Open Task**. Shotgun keeps the files of the tasks in the folder `.shotgun` of the first workspace folder.
- Stages: a task goes through 5 stages: brief, survey, order, plan and build. A gate of the user ends each stage, and the last gate ends the task.
- The ledger: `decisions.jsonl` of a task gets a line for each gate, each pause and each deny of the guard.
- The panel beside the text editor is in the secondary side bar. It shows the stage bar, the active task, the next work, the rule of the guard and the last decisions. It also shows the setup.
- The panel shows the request in words for Claude Code. A click puts the request into the clipboard.
- The page in the editor area shows the active task, all decisions, the setup and the tasks of the folder. **Shotgun: Show Page** opens it.
- The status bar shows the stage of the active task.
- Tools in the MCP server of DataFlow: `shotgun_get_session` gives the active task to Claude. `shotgun_guard` and `shotgun_session_context` are for the hooks.
- The guard: before each file change of Claude Code, a hook calls `shotgun_guard`. In the stages 1 to 4, the guard denies each change of a file of the project, and Claude gets the reason.
- In stage 5, the guard denies a change while Claude has no open step. The guard always denies a change in `.shotgun`.
- **Shotgun: Pause** stops the guard for work outside of the task, and **Shotgun: Continue** starts it again.
- The context: before each prompt, a hook calls `shotgun_session_context`. Claude gets the active task, its stage and the rule of the guard.
- **Shotgun: Connect to Claude Code** writes the plugin of Shotgun into `~/.shotgun/claude` and adds its marketplace to the user settings of Claude Code.
- The connection also turns the plugin on in `.claude/settings.local.json` of each workspace folder with a task. Shotgun adds this file to `info/exclude` of git.
- **Shotgun: Disconnect from Claude Code** removes these settings and the plugin folder.
- Tests: 37 unit tests, and `scripts/test-claude.mjs`, a test with Claude Code and the test build of VS Code.
