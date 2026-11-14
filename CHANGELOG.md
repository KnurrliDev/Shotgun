# Changelog

## 0.1.0

This version has no release yet. Each phase of `implementation-plan.md` adds its items.

### Phase 5: plan

- The risk rules of the decisions 8 and 14 of the plan are pure functions. They give a level from 1 to 5 from the facts of DataFlow. Tables of facts and levels test them, also the example plan of the design canvas.
- The new tool `shotgun_submit_plan` gives the steps of Claude in stage 4. Each step has a task, hooks, places, a text and checks. A place is lines of a file with a short text of their code, or a new file.
- Shotgun checks all data of the plan, and gives all problems in 1 list. Each task of the plan needs 1 step or more and a survey for its text. The steps must follow the order of the user.
- For each place, Shotgun gets the facts of DataFlow. These are the heat, the threads, the locks, the frame path, the main loop and the data members of a type. The rules then give each step its level.
- Before the end of the scan of the call graph, a step can have no level. At the end of the scan, Shotgun gets the levels again. **Shotgun: Check the Levels Again** gets them on request.
- The new tool `shotgun_get_plan` gives the steps with their levels. In stage 4, Claude can survey a task with no survey with `shotgun_submit_task_survey`.
- The plan page shows the steps with their risk bars and writers. For the selected step, it shows the place and the code, the heat, the rules and the level.
- The user changes a level with **Lower**, **Raise**, **Rule value** or **Shotgun: Set Risk Level**, and writes a note for each step. The ledger records each level and each note. A level stays with the id of its step in a new plan.
- The text editor shows each place of a step with the color of its level, and a CodeLens line. A click on the CodeLens line shows the step on the page.
- The gate **Accept the plan** needs a level for each step.
- The plugin of Shotgun has the new skill `shotgun-plan`.
- New stage files: `plan.json`, `risk.json` and `levels.json`.
- Tests: 92 unit tests. `scripts/test-claude.mjs` adds the plan of task 1, a change of a level and the gate of stage 4.

### Phase 4: order

- The order page shows the tasks of the survey in sequence, with their text, their hooks, their size and the tasks that they need.
- On the page, the user moves a task, changes its text, adds a task, keeps a task for later, and removes a new task. The ledger records each edit.
- `order.json` keeps the order. With no edit, the order is the order of the survey.
- The order check gives a warning for a task that comes before a task that it needs, and for a task with no text. The needs are words of Claude (the badge **Model**), and Shotgun never moves a task.
- A task with a new text and a new task have no survey. The new tool `shotgun_get_order` gives the order and these tasks.
- The new tool `shotgun_submit_task_survey` gives the hooks, the needs, the size and a note of Claude for 1 task. Shotgun refuses a survey for a text that the user changed after the call of `shotgun_get_order`.
- The new hooks of a task survey go into `survey.json`, and they get the facts of DataFlow.
- The gate **Accept the order**, or **Accept with N warnings**. With warnings, a modal message asks the user first. The gate needs 1 task or more in the plan, and a text for each task of the plan.
- The panel shows the sequence, the order check, the tasks with no survey and the request "Survey my changed tasks."
- The survey of stage 2 can give the size of each task: small, medium or large.
- `shotgun_get_session` also gives a summary of the order.
- The skill `shotgun-survey` has the procedure for the changed tasks of stage 3.
- Tests: 78 unit tests. `scripts/test-claude.mjs` adds the order of task 1, the survey of the changed tasks and the gate of stage 3.

### Phase 3: survey

- The new tool `shotgun_submit_survey` gives the survey of Claude in stage 2: the tasks in no sequence, the hooks, the facts and the questions.
- Shotgun checks all data of the survey, and gives all problems in 1 list. Each file must be in the project, and each line must be in its file. The code of each hook must be in its lines.
- Each task must name hooks of the survey, and each hook must have a task. The needs of the tasks must not make a circle. Each fact must name a read tool of DataFlow.
- For each hook in a C or C++ file, Shotgun gets the facts of DataFlow. `getPlace` gives the facts of the line of the code of the hook. `getHeat` gives the heat of its lines. A hook in a type gets the shared members of the type.
- At the end of the scan of the call graph, Shotgun gets the facts again. **Shotgun: Check the Hooks Again** gets them on request.
- The page shows the survey: the tasks with their hooks and needs, the hooks with their heat, and the facts with their tools. It also shows the code of the selected hook, and the questions with a field for each answer.
- The badge **Model** marks the words of Claude, and the badge **Engine** marks the facts of DataFlow (decision 13 of the plan).
- The panel shows a summary of the survey and the questions.
- The text editor shows the hooks in the stages 2 and 3, with a hover. A hook moves with its code when the lines change.
- The user answers a question on the page, or with **Shotgun: Answer Question**. A new survey keeps each answer with the id of its question.
- The gate **Order the tasks**. With a question that has no answer, a modal message asks the user first.
- `shotgun_get_session` also gives the survey with the answers of the user.
- The plugin of Shotgun has the new skill `shotgun-survey`. Claude reads the code with the read tools of DataFlow, and gives a fact only from a tool that it called. Shotgun cannot check the tool calls of Claude: gap 43 of `dataflow-gaps-2.md`.
- The skill `shotgun` and the tool `shotgun_submit_brief` tell Claude that Shotgun selects the task for a brief from the chat. Thus Claude does not ask the user about the task first.
- The ledger records each survey of Claude and each answer of the user.
- New stage files: `survey.json`, `engine.json` and `answers.json`.
- Fix: on Windows, a different program can keep a stage file open for a short time, for example a virus scanner. Then the write of the file failed, and a temporary file stayed. Now the write tries again for a maximum of 1 second. If the write fails, no temporary file stays.
- Tests: 69 unit tests. `scripts/test-claude.mjs` adds the survey of task 1, the answers and the gate of stage 2.

### Phase 2: brief

- **Shotgun: New Task** makes `brief.md` from a template with 5 parts: Goal, Facts, Specs, Not in scope and Done when. It opens the brief in the text editor.
- The panel checks the parts of the brief while the user writes. It shows the number of the sentences or of the items of each part. A click on a part opens the brief at the line of the part.
- The new tool `shotgun_submit_brief` gives a brief from the chat to Shotgun. Claude can add only the headings of the parts and list marks.
- Shotgun refuses each line of such a brief that is not in a recent prompt of the user (decision 12 of the plan). The context hook gives each prompt to Shotgun, and Shotgun keeps the last 20 prompts only in memory.
- A brief from the chat goes into a new task, or into the active task in stage 1 if its brief has no text. Shotgun never changes a brief with text.
- The new tool `shotgun_submit_questions` gives the questions of Claude about the brief. The panel shows each question with its line in the brief.
- The user closes a question with its button in the panel, or with **Shotgun: Close Question**.
- The gate **The brief is ready** has a button in the panel and the command **Shotgun: Pass the Gate**. Each part of the brief must have text. With open questions, a modal message asks the user first.
- The gate starts the scan of the call graph of DataFlow.
- The plugin of Shotgun has the skill `shotgun`: the contract, the stages, the brief from the chat, and the questions about the brief.
- `shotgun_get_session` also gives the brief with its parts and the open questions. **Shotgun: Open Brief** opens the brief of the active task.
- The ledger records the brief of Claude, the questions of Claude, and each question that the user closes.
- Tests: 55 unit tests. `scripts/test-claude.mjs` takes 2 tasks from the brief to stage 2. Task 1 has a brief in a file, and task 2 has a brief from the chat.

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
