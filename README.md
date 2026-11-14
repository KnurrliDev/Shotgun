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

Shotgun is in development. The phases 1 to 5 of 10 are complete:

- Phase 1: the tasks, the stages, the panel, the page, the guard and the connection to Claude Code.
- Phase 2: the brief, the questions of Claude about the brief, and the gate of stage 1.
- Phase 3: the survey of Claude with the facts of DataFlow, the hooks in the text editor, and the gate of stage 2.
- Phase 4: your order of the tasks, the survey of the changed tasks, and the gate of stage 3.
- Phase 5: the plan of Claude, the risk level of each step from the facts of DataFlow, and the gate of stage 4.

`implementation-plan.md` gives the phases, and `CHANGELOG.md` gives the content of each phase.

## Prerequisites

- VS Code 1.143 or a later version.
- DataFlow 0.6.0 or a later version. The tools of Shotgun are in the MCP server of DataFlow.
- The connection of DataFlow to Claude Code, from the command **DataFlow: Connect to Claude Code**.
- Claude Code 2.1.323 or a later version.
- A C or C++ project with a compile database, as DataFlow needs.

## Use

1. Run **Shotgun: Connect to Claude Code**.
2. Run **Shotgun: New Task**, and give the title of the task. Shotgun opens `brief.md` with its 5 parts.
3. Start a new session of Claude Code in the project. Claude gets the context of the task with each prompt.
4. Write the brief in `brief.md`. Or give the brief to Claude in the chat, and tell Claude to give it to Shotgun.
5. Optionally, tell Claude "Ask me questions about my brief." Answer each question in the brief, and then close it in the panel.
6. When each part has text, select **The brief is ready** in the panel.
7. Tell Claude "Survey my brief." Claude reads the code, and gives the tasks, the hooks, the facts and its questions to Shotgun.
8. Read the survey on the page of Shotgun. Answer the questions of Claude on the page, or with **Shotgun: Answer Question**.
9. If the survey must change, tell Claude what to change. When the survey is correct, select **Order the tasks**.
10. On the order page, put the tasks in sequence. You can change the text of a task, add a task, and keep a task for later.
11. Tell Claude "Survey my changed tasks." Claude gives the hooks and the needs of each task with a new text, and of each new task.
12. When the order is correct, select **Accept the order**.
13. Tell Claude "Make the plan." Claude makes the steps in your sequence, and Shotgun gives each step a risk level.
14. Check the levels on the plan page. To change a level, select **Lower**, **Raise** or **Shotgun: Set Risk Level**. Write your reason in the note of the step.
15. When the plan is correct, select **Accept the plan**.
16. Follow the panel of Shotgun in the secondary side bar. It shows the next work and the requests for Claude Code.

| Command | Function |
| --- | --- |
| Shotgun: New Task | Makes a task in stage 1 with `brief.md`. The new task becomes the active task. |
| Shotgun: Open Task | Selects a different task of the folder. |
| Shotgun: Open Brief | Opens the brief of the active task. |
| Shotgun: Close Question | Closes a question of Claude about the brief. |
| Shotgun: Answer Question | Gives your answer to a question of the survey. An empty answer removes the answer. |
| Shotgun: Check the Hooks Again | Gets the facts of DataFlow for the hooks of the survey again, at their lines now. |
| Shotgun: Set Risk Level | Sets your level for a step of the plan, or sets the level of the rules again. |
| Shotgun: Check the Levels Again | Gets the facts of DataFlow and the levels of the rules for the steps of the plan again. |
| Shotgun: Pass the Gate | Records the gate of the stage, for example "The brief is ready". |
| Shotgun: Pause | Stops the guard for work outside of the task. The ledger records the pause. |
| Shotgun: Continue | Starts the guard again. |
| Shotgun: Show Page | Opens the page of Shotgun in the editor area. |
| Shotgun: Connect to Claude Code | Adds the plugin of Shotgun to Claude Code. |
| Shotgun: Disconnect from Claude Code | Removes the plugin of Shotgun from Claude Code. |

## The guard

Before each file change of Claude Code, the plugin of Shotgun asks the guard. In the stages 1 to 4, the guard denies each change of a file of the project, and Claude gets the reason. The guard helps you, but it is not a security boundary:

- If VS Code does not run, Claude Code continues the change.
- The guard does not see a change through a shell command.

## A brief from the chat

Claude gives your brief to Shotgun with your words. Claude can add only the headings of the 5 parts and list marks. Shotgun refuses each line that is not in one of your recent prompts. Thus the brief stays your text.

For this check, the plugin of Shotgun gives each prompt to Shotgun. Shotgun keeps your last 20 prompts only in memory, and only for its window. No file gets them.

## The survey

In stage 2, Claude reads your brief and the code. Claude gives the survey to Shotgun:

- The tasks, in no sequence. A task can need a different task first.
- The hooks: the places in the code that the tasks change. Each hook has a short text of its code. Thus the hook stays with its code when the lines move.
- The facts that the brief does not give. Each fact names the read tool of DataFlow that shows it.
- The questions for you.

Shotgun checks each part of the survey, and gives all problems back to Claude in 1 list. Claude then corrects the survey. Claude changes no file in this stage.

The page of Shotgun shows the words of Claude with the badge **Model**. It shows the facts of DataFlow with the badge **Engine**. For each hook in a C or C++ file, Shotgun gets these facts from DataFlow: the function, the threads, the locks and the heat. The heat is a score from 0 to 100 for the risk of a change.

Until the scan of the call graph is complete, the heat can change. The page then marks the heat with "*". At the end of the scan, Shotgun gets the facts again.

In the stages 2 and 3, the text editor shows a line at the left side of each hook. The id and the title of the hook come after its first line. Move the pointer onto a hook to see its facts.

## The order

In stage 3, you put the tasks of the survey in sequence on the order page. Each task shows its text, its hooks, the estimate of Claude for its size, and the tasks that it needs. You can:

- move a task up or down
- change the text of a task
- add a task
- keep a task for later, or put it back into the plan
- remove a task that you added

Each edit is a decision of yours, and the ledger records it. Claude changes no text and no place of a task.

The order check uses the needs from the survey of Claude. If a task comes before a task that it needs, the check gives a warning. Shotgun does not move a task.

A task with a new text and a new task have no survey. Tell Claude "Survey my changed tasks." Claude then gives the hooks and the needs of each of these tasks. If you change the text again, the task has no survey again. A task with no survey at the gate gets its survey at the start of the plan.

The gate **Accept the order** needs 1 task or more in the plan, and a text for each task of the plan. With warnings, the button tells their number, and a modal message asks you first.

## The plan and the risk levels

In stage 4, Claude makes the steps of the plan in your sequence. Each step has a task, hooks, places, a text and checks. A place is lines of a file that is there, or a new file.

Shotgun gives each step a risk level from the facts of DataFlow. The level of a step is the highest level of its places:

| Facts of DataFlow | Risk level |
| --- | --- |
| A new file | 1 |
| A cool function, a file that is not C or C++ ("no facts"), or lines with no function | 2 |
| A warm function | 3 |
| A hot function | 4 |
| A very hot function | 5 |

More rules make a level only higher:

- Callers that the call graph cannot see: level 3 or higher.
- A frame path with more than 8 calls, or a line in the main loop: level 4 or higher.
- A worker thread at the line: 1 level more. A lock at the line: 1 level more. The maximum is 5.
- A data member of a type: level 2, or level 3 if threads share a member or a member is on a frame path. A change of a data member gets the level of the hottest function that uses it.
- Before the end of the scan of the call graph, a function with an incomplete reach has no level. After a stopped scan or a failed scan, the level is 3 or higher.

In stage 5, the level selects the writer of the step. At the levels 1 and 2, Claude writes. At level 3, Claude writes a frame with holes for you. At the levels 4 and 5, you write. Only you change a level. The ledger records each level and each note of yours.

In the stages 4 and 5, the text editor shows each place of a step with the color of its level, and a CodeLens line. A click on the CodeLens line shows the step on the page.

## Files

| File | Content |
| --- | --- |
| `.shotgun/active.json` | The active task, and the pause of the guard. |
| `.shotgun/<task>/task.json` | The title of the task, its stage and its gates. |
| `.shotgun/<task>/brief.md` | The brief, with the 5 parts. |
| `.shotgun/<task>/questions.json` | The questions of Claude about the brief. |
| `.shotgun/<task>/survey.json` | The survey of Claude: the tasks, the hooks, the facts and the questions. |
| `.shotgun/<task>/engine.json` | The facts of DataFlow for each hook of the survey. |
| `.shotgun/<task>/answers.json` | Your answers to the questions of the survey. |
| `.shotgun/<task>/order.json` | Your order of the tasks: the sequence, your texts, your new tasks, the tasks for later, and the surveys of Claude for the changed tasks. |
| `.shotgun/<task>/plan.json` | The steps of the plan of Claude. |
| `.shotgun/<task>/risk.json` | The facts of DataFlow and the level of the rules for each step. |
| `.shotgun/<task>/levels.json` | Your levels and your notes for the steps. |
| `.shotgun/<task>/decisions.jsonl` | The ledger: 1 line for each decision of the user and for each deny of the guard. |
| `~/.shotgun/claude` | The plugin of Shotgun for Claude Code, in a local marketplace. |
| `.claude/settings.local.json` | The local settings of Claude Code in the project. The connection turns the plugin of Shotgun on there. |

You decide if git keeps the folder `.shotgun`.

## Development

1. Run `npm install`.
2. Run `npm run compile`.
3. In VS Code, select F5. The configuration "Run Extension" opens a second window with Shotgun.

The second window needs DataFlow 0.6.0 or a later version.

To open the second window with no debugger, run `open-editor.bat` in the folder of the repository. The script compiles Shotgun, and opens VS Code with Shotgun. If VS Code has the second window already, it loads the window again with the new code. To open a folder in the window, give the folder as an argument, for example `open-editor.bat C:\Projects\App`.

The window uses the DataFlow extension of VS Code. To use DataFlow from its repository, set the environment variable `DATAFLOW_REPO` to its folder. The script then compiles DataFlow too. If VS Code runs as administrator, run the script as administrator.

| Command | Tests |
| --- | --- |
| `npm test` | The unit tests in a test build of VS Code. The tests load DataFlow from `../DataFlow`, or from the folder of the environment variable `DATAFLOW_REPO`. If the environment variable `CLAUDE_EXE` gives the CLI of Claude Code, a test also checks the plugin with `claude plugin validate`. |
| `node scripts/test-claude.mjs <run folder>` | The test with Claude Code. 2 tasks go from the brief to stage 2. Task 1 has a brief in a file, and task 2 has a brief from the chat. The guard denies a change in stage 1. Then Claude makes the survey of task 1, and task 1 goes to stage 3. On the order page, the test changes the order. Claude surveys the changed tasks, and task 1 goes to stage 4. Then Claude makes the plan, the test changes a level, and task 1 goes to stage 5. Use a new run folder outside of the repository. |

NOTE: `scripts/test-claude.mjs` uses the Claude subscription of the user for 6 runs of Claude Code. It does not change the settings of the user.

## License

MIT. See `LICENSE`.
