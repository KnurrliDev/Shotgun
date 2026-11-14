# Shotgun

Shotgun is a VS Code extension for pair programming with Claude Code. You keep the decisions and the ownership of the code. Claude does the work that you give it.

A task goes through 5 stages:

| Stage | Writer | Work |
| --- | --- | --- |
| 1 Brief | You | You write the brief: the goal, the facts, the specs, the limits and the condition of done. |
| 2 Survey | Claude | Claude reads the code. It gives the facts, the tasks and the hooks: the places where new code goes into the code that is there. |
| 3 Order | You | You put the tasks in sequence. You can rewrite a task, add a task, or keep a task for later. |
| 4 Plan | Claude | Claude makes the steps of the plan. Shotgun gives each step a risk level from the facts of DataFlow. |
| 5 Build | You and Claude | The risk level of a step selects its writer. You write the steps with the most risk. |

A button of Shotgun records a decision of the user. It never starts Claude: you type each request in Claude Code.

## Status

Shotgun is in development. Phase 1 of 10 is complete: the tasks, the stages, the panel, the page, the guard and the connection to Claude Code. `implementation-plan.md` gives the phases, and `CHANGELOG.md` gives the content of each phase.

## Prerequisites

- VS Code 1.143 or a later version.
- DataFlow 0.6.0 or a later version. The tools of Shotgun are in the MCP server of DataFlow.
- The connection of DataFlow to Claude Code, from the command **DataFlow: Connect to Claude Code**.
- Claude Code 2.1.323 or a later version.
- A C or C++ project with a compile database, as DataFlow needs.

## Use

1. Run **Shotgun: Connect to Claude Code**.
2. Run **Shotgun: New Task**, and give the title of the task.
3. Start a new session of Claude Code in the project. Claude gets the context of the task with each prompt.
4. Follow the panel of Shotgun in the secondary side bar. It shows the next work and the requests for Claude Code.

| Command | Function |
| --- | --- |
| Shotgun: New Task | Makes a task in stage 1. The new task becomes the active task. |
| Shotgun: Open Task | Selects a different task of the folder. |
| Shotgun: Pause | Stops the guard for work outside of the task. The ledger records the pause. |
| Shotgun: Continue | Starts the guard again. |
| Shotgun: Show Page | Opens the page of Shotgun in the editor area. |
| Shotgun: Connect to Claude Code | Adds the plugin of Shotgun to Claude Code. |
| Shotgun: Disconnect from Claude Code | Removes the plugin of Shotgun from Claude Code. |

## The guard

Before each file change of Claude Code, the plugin of Shotgun asks the guard. In the stages 1 to 4, the guard denies each change of a file of the project, and Claude gets the reason. The guard helps you, but it is not a security boundary:

- If VS Code does not run, Claude Code continues the change.
- The guard does not see a change through a shell command.

## Files

| File | Content |
| --- | --- |
| `.shotgun/active.json` | The active task, and the pause of the guard. |
| `.shotgun/<task>/task.json` | The title of the task, its stage and its gates. |
| `.shotgun/<task>/decisions.jsonl` | The ledger: 1 line for each decision of the user and for each deny of the guard. |
| `~/.shotgun/claude` | The plugin of Shotgun for Claude Code, in a local marketplace. |
| `.claude/settings.local.json` | The local settings of Claude Code in the project. The connection turns the plugin of Shotgun on there. |

You decide if git keeps the folder `.shotgun`.

## Development

1. Run `npm install`.
2. Run `npm run compile`.
3. In VS Code, select F5. The configuration "Run Extension" opens a second window with Shotgun.

The second window needs DataFlow 0.6.0 or a later version.

| Command | Tests |
| --- | --- |
| `npm test` | The unit tests in a test build of VS Code. The tests load DataFlow from `../DataFlow`, or from the folder of the environment variable `DATAFLOW_REPO`. If the environment variable `CLAUDE_EXE` gives the CLI of Claude Code, a test also checks the plugin with `claude plugin validate`. |
| `node scripts/test-claude.mjs <run folder>` | The test with Claude Code. Claude reads the session, and the guard denies a change in stage 1. Use a new run folder outside of the repository. |

NOTE: `scripts/test-claude.mjs` uses the Claude subscription of the user for 2 short runs of Claude Code. It does not change the settings of the user.

## License

MIT. See `LICENSE`.
