# Shotgun

Shotgun is a VS Code extension for pair programming with Claude Code. You keep the decisions and the ownership of the code. Claude does the work that you give it.

A task goes through 5 stages:

| Stage | Writer | Work |
| --- | --- | --- |
| 1 Brief | You | You write the brief: the goal, the facts, the specs, the limits and the condition of done. Each part is optional. |
| 2 Survey | Claude | Claude reads the code. It gives the facts, the tasks and the hooks: the places where new code goes into the code that is there. |
| 3 Order | You | You put the tasks in sequence. You can rewrite a task, add a task, or keep a task for later. |
| 4 Plan | Claude | Claude makes the steps of the plan. Shotgun gives each step a risk level from the facts of DataFlow. |
| 5 Build | You and Claude | The risk level of a step selects its writer. You write the steps with the most risk. |

A button of Shotgun records a decision of the user. It never starts Claude: you type each request in Claude Code.

## Status

Shotgun is in development. The phases 1 to 9 of 10 are complete:

- Phase 1: the tasks, the stages, the panel, the page, the guard and the connection to Claude Code.
- Phase 2: the brief, the questions of Claude about the brief, and the gate of stage 1.
- Phase 3: the survey of Claude with the facts of DataFlow, the hooks in the text editor, and the gate of stage 2.
- Phase 4: your order of the tasks, the survey of the changed tasks, and the gate of stage 3.
- Phase 5: the plan of Claude, the risk level of each step from the facts of DataFlow, and the gate of stage 4.
- Phase 6: the build: the steps in sequence, the errands of Claude with receipts, the steps of the user, and the writer of each line.
- Phase 7: the frames of Claude with a hole for each decision of the user, the hints of each hole, and Tab between the holes.
- Phase 8: the callouts with the new facts of DataFlow on your lines, and the answers of Claude to your questions about a line.
- Phase 9: the loose ends of the steps, the ledger of the task, and the check of your commit message by Claude.

After phase 9, Shotgun got a sidebar in the activity bar, and each part of the brief became optional.

`implementation-plan.md` gives the phases, and `CHANGELOG.md` gives the content of each phase.

## Prerequisites

- VS Code 1.143 or a later version.
- DataFlow 0.6.1 or a later version. The tools of Shotgun are in the MCP server of DataFlow.
- The connection of DataFlow to Claude Code, from the command **DataFlow: Connect to Claude Code**.
- Claude Code 2.1.323 or a later version.
- A C or C++ project with a compile database, as DataFlow needs.

## Use

1. Run **Shotgun: Connect to Claude Code**.
2. Run **Shotgun: New Task**, or select **New Task…** in the sidebar of Shotgun. Give the title of the task. Shotgun opens `brief.md` with its 5 parts.
3. Start a new session of Claude Code in the project. Claude gets the context of the task with each prompt.
4. Write the brief in `brief.md`, or give the brief to Claude in the chat and tell Claude to give it to Shotgun. Each part of the brief is optional.
5. Optionally, tell Claude "Ask me questions about my brief." You can answer a question in the brief, and close it in the panel.
6. Select **The brief is ready** in the panel. The gate does not wait for a part of the brief or for an answer.
7. Tell Claude "Survey my brief." Claude reads the code, and gives the tasks, the hooks, the facts and its questions to Shotgun.
8. Read the survey on the page of Shotgun. Answer the questions of Claude on the page, or with **Shotgun: Answer Question**.
9. If the survey must change, tell Claude what to change. When the survey is correct, select **Order the tasks**.
10. On the order page, put the tasks in sequence. You can change the text of a task, add a task, and keep a task for later.
11. Tell Claude "Survey my changed tasks." Claude gives the hooks and the needs of each task with a new text, and of each new task.
12. When the order is correct, select **Accept the order**.
13. Tell Claude "Make the plan." Claude makes the steps in your sequence, and Shotgun gives each step a risk level.
14. Check the levels on the plan page. To change a level, select **Lower**, **Raise** or **Shotgun: Set Risk Level**. Write your reason in the note of the step.
15. When the plan is correct, select **Accept the plan**.
16. In stage 5, the panel shows the current step. The steps go in sequence.
17. For a step of Claude, tell Claude "Do step N." Claude changes the files of the step, and gives a receipt.
18. Walk the receipt in the panel. Put a mark on each change: **OK**, **Issue** or **Question**. Write a note for Claude if necessary.
19. For an issue or a question, tell Claude "Fix the issues of step N." Then walk the new receipt.
20. Select **Accept the receipt**.
21. For a step of level 3, tell Claude "Give me a frame for step N." Fill each hole of the frame. Then select **The step is done**.
22. For a step of yours, write its code. Then select **The step is done**. At level 4, you can select **I want a frame** first.
23. While you write a step, read the callouts of DataFlow on your lines. Tell Claude "Explain the callout on line N." for the words of Claude. Ask Claude about a line, for example "Does the lambda on line 95 copy charge?".
24. At the gate of each step, Shotgun gets the loose ends of the step from DataFlow. Hand a mechanical loose end to Claude, and tell Claude "Do the loose ends.".
25. After the last step, select **The task is done**.
26. Write the commit message in Source Control. Tell Claude "Check my commit message.". Then commit in Source Control.
27. Follow the panel of Shotgun in the secondary side bar. It shows the next work and the requests for Claude Code.

## The sidebar

The icon of Shotgun in the activity bar opens the sidebar of Shotgun, as DataFlow has its sidebar:

- **New Task…** and the tasks of the project with their stages. A click on a task makes it the active task, and shows the panel.
- **Show Page**, **Open Brief** and **Show the Ledger** for the active task.
- **Pause** or **Continue** for the guard.
- **Show Panel** for the panel of Shotgun in the secondary side bar.
- **Open Project Folder…** and **Recent Projects**: the last 10 folders with a task of Shotgun, from all windows. A click opens the folder in this window.
- **Claude Code**, with the state of the connection: a click connects Shotgun to Claude Code. And **Show Log**.

| Command | Function |
| --- | --- |
| Shotgun: New Task | Makes a task in stage 1 with `brief.md`. The new task becomes the active task. |
| Shotgun: Open Task | Selects a different task of the folder. |
| Shotgun: Show Panel | Shows the panel of Shotgun in the secondary side bar. |
| Shotgun: Open Project Folder... | Opens the folder of a project in this window. |
| Shotgun: Open Recent Project... | Opens a recent project with a task of Shotgun in this window. |
| Shotgun: Show Log | Shows the log of Shotgun. |
| Shotgun: Open Brief | Opens the brief of the active task. |
| Shotgun: Close Question | Closes a question of Claude about the brief. |
| Shotgun: Answer Question | Gives your answer to a question of the survey. An empty answer removes the answer. |
| Shotgun: Check the Hooks Again | Gets the facts of DataFlow for the hooks of the survey again, at their lines now. |
| Shotgun: Set Risk Level | Sets your level for a step of the plan, or sets the level of the rules again. In stage 5, only for a step that Claude did not start. |
| Shotgun: Check the Levels Again | Gets the facts of DataFlow and the levels of the rules for the steps of the plan again. |
| Shotgun: Mark a Change | Puts your mark on a change of the receipt of the current step, with a note for Claude. |
| Shotgun: I Want a Frame | Gives the current step of level 4 to Claude as a frame. Then tell Claude "Give me a frame for step N." |
| Shotgun: Go to the Next Hole | Selects the next open hole of the frame. In a frame, Tab does the same. |
| Shotgun: Go to the Hole Before | Selects the open hole before the cursor. In a frame, Shift+Tab does the same. |
| Shotgun: Show the Next Hint | Shows the next hint of the hole at the cursor. The last hint puts the answer of Claude into the hole. |
| Shotgun: Set the Voice of the Callouts | Sets the voice: quiet, normal or talkative. |
| Shotgun: Not a Problem | Closes a callout with your reason. The ledger keeps the reason. |
| Shotgun: Resolve a Question on a Line | Resolves a question that Claude answered at a line. |
| Shotgun: Hand a Loose End to Claude | Makes a loose end the next step of the plan for Claude, with risk level 2. |
| Shotgun: Close a Loose End | Closes a loose end with your reason. The ledger keeps the reason. |
| Shotgun: Show the Ledger | Shows the ledger page of the task. |
| Shotgun: Copy the Ledger for a Pull Request | Puts your decisions and the lines of each writer into the clipboard as Markdown. |
| Shotgun: Pass the Gate | Records the gate of the stage, for example "The brief is ready". |
| Shotgun: Pause | Stops the guard for work outside of the task. The ledger records the pause. |
| Shotgun: Continue | Starts the guard again. |
| Shotgun: Show Page | Opens the page of Shotgun in the editor area. |
| Shotgun: Connect to Claude Code | Adds the plugin of Shotgun to Claude Code. |
| Shotgun: Disconnect from Claude Code | Removes the plugin of Shotgun from Claude Code. |

## The guard

Before each file change of Claude Code, the plugin of Shotgun asks the guard. In the stages 1 to 4, the guard denies each change of a file of the project, and Claude gets the reason. In stage 5, the guard lets Claude change only the files of the scope of its open step. The guard helps you, but it is not a security boundary:

- If VS Code does not run, Claude Code continues the change.
- The guard does not see a change through a shell command. The receipt of a step shows each change of its scope since the base of the step. It also shows the files outside of the scope that changed while the step was open.

## A brief from the chat

Claude gives your brief to Shotgun with your words. Claude can add only the headings of the 5 parts and list marks. Shotgun refuses each line that is not in one of your recent prompts. Thus the brief stays your text.

For this check, the plugin of Shotgun gives each prompt to Shotgun. Shotgun keeps your last 20 prompts only in memory, and only for its window. No file gets them.

## The survey

In stage 2, Claude reads your brief and the code. Claude gives the survey to Shotgun:

- The tasks, in no sequence. A task can need a different task first.
- The hooks: the places in the code that the tasks change. Each hook has a short text of its code. Thus the hook stays with its code when the lines move.
- The facts that the brief does not give. Each fact names the read tool of DataFlow that shows it.
- The questions for you.

Shotgun checks each part of the survey, and gives all problems back to Claude in 1 list. Claude then corrects the survey. Claude changes no file in this stage. Shotgun also refuses a fact with a tool that Claude did not call in this stage.

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

In stage 5, the level selects the writer of the step. At the levels 1 and 2, Claude writes. At level 3, Claude writes a frame with a hole for each decision, and you fill the holes. At the levels 4 and 5, you write, and at level 4 you can ask for a frame. Only you change a level: in stage 4, and in stage 5 for a step that Claude did not start. The ledger records each level and each note of yours.

In the stages 4 and 5, the text editor shows each place of a step with the color of its level, and a CodeLens line. A click on the CodeLens line shows the step on the page.

## The build

In stage 5, the steps of the plan go in sequence. The current step is the first step that is not done.

A step of Claude is an errand:

1. You tell Claude "Do step N." Claude opens the step with the tool `shotgun_start_step`.
2. Shotgun saves the files of the scope of the step: the files of its places. DataFlow keeps their text as the base of the step. Then the guard lets Claude change these files.
3. Claude changes the files, and gives the receipt with the tool `shotgun_submit_errand`. Shotgun gets the diff since the base from DataFlow. Each change in the diff needs a change of Claude with its lines, a title and a check for you. The scope closes again.

The panel shows the receipt. Each change shows the title and the check of Claude, its lines, the added and the removed lines, the heat of DataFlow, and its diff. A note of Claude has the badge **Model**, for example for a change that you did not ask for. The receipt also shows the edits that the guard denied, and the loose ends of Claude. It also shows the files outside of the scope that changed while the step was open.

Put a mark on each change: **OK**, **Issue** or **Question**, and write a note for Claude if necessary. An issue stops the gate. Tell Claude "Fix the issues of step N." Claude reads your marks and your notes with the tool `shotgun_get_step`, and opens the step again. The step keeps its base, so the new receipt has all changes since the first start. A change with no new code keeps your mark OK.

The gate **Accept the receipt** deletes the base of the step. If a change has no mark, a modal message asks you first. The ledger keeps such a change as not walked.

You write a step of the levels 3, 4 and 5. Shotgun keeps the text of the files of its places as the base of the step. Write the code of the step, and select **The step is done**. Shotgun records your lines since the base. Claude changes no file in your step, but it can answer your questions in the chat.

## Frames

A step of level 3 gets a frame. A step of level 4 gets a frame only after you select **I want a frame** in the panel.

1. You tell Claude "Give me a frame for step N." Claude opens the step with the tool `shotgun_start_step` and the kind `frame`.
2. Claude writes the lines of the step that have no decision. In the place of each decision, Claude writes a marker in a comment, for example `/*@hole 1: When is the plan too late? */`.
3. Claude gives the holes with the tool `shotgun_submit_frame`. Each hole has 4 hints: a nudge, a pointer to the facts, an example from the project, and the answer. Shotgun checks each marker and each place.

The panel shows the holes and the state of each hole. Select a hole to see its question and the facts of DataFlow at its line. The hint ladder shows the hints one at a time. The hints came with the frame, so a click sends no request to Claude. **4 Show me** puts the answer of Claude into the hole, after a modal message. Its lines are lines of Claude.

In the text editor, an open hole has a dashed box. Tab goes to the next open hole and selects its marker, and Shift+Tab goes to the hole before it. Type your code in the place of the marker. With no open hole, Tab and Shift+Tab indent as usual. The hover of a hole shows its question, the hints that you opened, and a link to the next hint.

When each hole has code, select **The step is done**. The frame lines have the tag "Claude · frame" in the gutter, and they get no receipt. For a different frame, tell Claude "Give me a different frame for step N."

## Callouts

While you write a step of yours, or the holes of a frame, Shotgun gets the facts of DataFlow for your lines:

- the races of the threads, and data that a thread uses after the end of its function: a **problem**
- the checks of the threads, and the warnings of the logic: a **warning**
- the hidden C++, for example a copy or a temporary: **info**

A new fact on one of your lines is a callout. At the start of the step, Shotgun keeps the facts of DataFlow. Thus a fact that was there before your change is not a callout.

Callouts never come while you type. They come at a pause: 2 seconds with no edit. A pause shows a maximum of 3 callouts, the problems first. The voice selects the kinds:

| Voice | Callouts |
| --- | --- |
| Quiet | Only the problems. |
| Normal | The problems and the warnings. This is the default. |
| Talkative | Each new fact, also the hidden C++. |

The text editor shows a tag after the line of each callout. The hover shows the facts of the engine with their places. "Show in DataFlow" opens the line in the side view of DataFlow. "Not a problem" closes the callout with your reason, and the ledger keeps the reason.

The callouts show the facts of DataFlow with the badge **Engine**. For the words of Claude, tell Claude "Explain the callout on line N." The panel shows them with the badge **Model**.

You can ask Claude about a line, for example "Does the lambda on line 95 copy charge?". Claude puts its answer at the line. Shotgun adds the facts of DataFlow at the line, so the facts and the words of Claude stay apart.

| Setting | Function |
| --- | --- |
| `shotgun.voice` | The voice of the callouts. Default: `normal`. |
| `shotgun.pauseSeconds` | The time with no edit that makes a pause. Default: 2. |

`lines.json` keeps the writer of each changed line. The text editor shows a mark in the gutter for each line of Claude. The mark is dashed until you walk its change, and then it has the color of your mark. A line of Claude that you change becomes your line. If you change a file of the scope while Claude writes the step, Shotgun shows a warning.

## Loose ends

A loose end is a place that the changes of a step can also need. At the gate of each step, Shotgun gets the loose ends from DataFlow, while the base of the step is still there:

- a function that uses most data members of a type, but not a new member of the step, for example a function that loads the settings: **mechanical**
- a switch statement that does not handle a new enumerator: **mechanical**
- a caller that gets the result of a changed function: **your decision**
- a loose end that Claude gave with its receipt: **mechanical**, with the badge **Model**

The tab **Loose ends** of the panel shows them. **Hand to Claude** makes a mechanical loose end the next step of the plan, with risk level 2 (decision 21). Then tell Claude "Do the loose ends.". **Close** keeps your reason in the ledger, for example for a caller that needs no change.

## The ledger and the commit message

The ledger page shows your decisions, and the lines of each file: your lines, the lines of Claude that you walked, and the lines of Claude that you did not walk. **Walk** opens the first line of Claude that you did not walk. **Copy for the pull request** puts your decisions and the lines of each writer into the clipboard as Markdown.

You write the commit message in the input box of Source Control. The tab **Ledger** of the panel shows the same text. Tell Claude "Check my commit message.". Claude compares the message with the diff, and gives its points with the badge **Model**: what agrees, what is missing, what is wrong, and its questions. If you change the message after the check, the panel tells you that the check is old.

Shotgun makes no commit, and Claude changes no message. You commit in Source Control.

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
| `.shotgun/<task>/build.json` | The state of each step of the build, its scope and its base. Also the receipt with the notes of Claude and your marks, and the holes of a frame with their hints. |
| `.shotgun/<task>/lines.json` | The writer of each changed line, with a hash of each line of the file. |
| `.shotgun/<task>/callouts.json` | The facts of DataFlow at the start of each step, the callouts with your reasons and the words of Claude, and the answers on lines. |
| `.shotgun/<task>/loose.json` | The loose ends of the steps, with their state, your reasons and the steps of Claude for them. |
| `.shotgun/<task>/message.json` | The last check of Claude of your commit message. |
| `.shotgun/<task>/decisions.jsonl` | The ledger: 1 line for each decision of the user and for each deny of the guard. |
| `~/.shotgun/claude` | The plugin of Shotgun for Claude Code, in a local marketplace. |
| `.claude/settings.local.json` | The local settings of Claude Code in the project. The connection turns the plugin of Shotgun on there. |

You decide if git keeps the folder `.shotgun`.

## Development

1. Run `npm install`.
2. Run `npm run compile`.
3. In VS Code, select F5. The configuration "Run Extension" opens a second window with Shotgun.

The second window needs DataFlow 0.6.1 or a later version.

To open the second window with no debugger, run `open-editor.bat` in the folder of the repository. The script compiles Shotgun, and opens VS Code with Shotgun. If VS Code has the second window already, it loads the window again with the new code. To open a folder in the window, give the folder as an argument, for example `open-editor.bat C:\Projects\App`.

The window uses the DataFlow extension of VS Code. To use DataFlow from its repository, set the environment variable `DATAFLOW_REPO` to its folder. The script then compiles DataFlow too. If VS Code runs as administrator, run the script as administrator.

| Command | Tests |
| --- | --- |
| `npm test` | The unit tests in a test build of VS Code. The tests load DataFlow from `../DataFlow`, or from the folder of the environment variable `DATAFLOW_REPO`. If the environment variable `CLAUDE_EXE` gives the CLI of Claude Code, a test also checks the plugin with `claude plugin validate`. |
| `node scripts/test-claude.mjs <run folder>` | The test with Claude Code. 2 tasks go from the brief to stage 2. The gate of the empty brief is on, and the sidebar shows the task. Task 1 has a brief in a file, and task 2 has a brief from the chat. The guard denies a change in stage 1. Then Claude makes the survey of task 1, and task 1 goes to stage 3. On the order page, the test changes the order. Claude surveys the changed tasks, and task 1 goes to stage 4. Then Claude makes the plan, the test changes the levels, and task 1 goes to stage 5. In the build, a run of Claude Code with no plugins stands in for the user and writes step 1. Claude does step 2 and gives a receipt. The test puts an issue on a change, Claude fixes it, and the test accepts the receipt. Then the test sets step 3 to level 4 and asks for a frame. Claude gives the frame, and the test fills the holes with Tab and the hints. In step 4, the test writes a line with a race. The race shows as a callout, and Claude explains it and answers a question about a line. Then the test ends step 4, hands a loose end to Claude, writes a commit message, and Claude checks the message. Use a new run folder outside of the repository. |

NOTE: `scripts/test-claude.mjs` uses the Claude subscription of the user for 12 runs of Claude Code. It does not change the settings of the user.

## License

MIT. See `LICENSE`.
