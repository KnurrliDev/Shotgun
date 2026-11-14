# Changelog

## 0.1.0

This version has no release yet. Each phase of `implementation-plan.md` adds its items.

### Phase 8: callouts

- The user writes a step of the user, or the holes of a frame. Meanwhile, Shotgun gets the facts of DataFlow for the lines of the user. These are the races of the threads, the warnings of the logic, and the hidden C++ of the functions.
- At the start of the step, Shotgun keeps a key for each fact, with the text of the line of the fact. A fact on a line of the user with a new key is a callout. A fact that only moved keeps its key.
- A callout has a kind. A problem is a race, or data after the end of its function. A warning is a check of the threads, or a warning of the logic. Info is the hidden C++.
- Callouts never come while the user types. They come at a pause: 2 seconds with no edit (decision 19). A pause shows a maximum of 3 callouts, the problems first.
- The voice filters the kinds: quiet, normal or talkative. The default is normal: problems and warnings. The panel and **Shotgun: Set the Voice of the Callouts** change it.
- The text editor shows each open callout with a tag after its line. The hover shows the facts of the engine, the words of Claude, and the links "Show in DataFlow" and "Not a problem".
- "Show in DataFlow" shows the line in the side view of DataFlow with the lens of the fact, only after a click of the user.
- "Not a problem" closes a callout with a reason of the user. The ledger keeps the reason.
- The new tools `shotgun_get_callouts` and `shotgun_submit_explanation`: on a request of the user, Claude explains a callout. The words of Claude show under the facts with the badge **Model**.
- The new tool `shotgun_submit_line_answer`: Claude puts its answer to a question of the user at the line. The question must be in the words of the user. Shotgun adds the facts of DataFlow at the line with the badge **Engine**, so the facts and the words of Claude stay apart.
- The status bar shows the number of the open problems on the lines of the user.
- From the start of a step of the user, or of the holes of a frame, Shotgun follows the lines of the files of the scope. Thus a line that the user types is a line of the user at once, also in a file with no lines of a writer.
- A step that changes while it opens does not open. Before, if the user clicked **I want a frame** while Shotgun opened the step, the step stayed a step of the user.
- New settings: `shotgun.voice` and `shotgun.pauseSeconds`. New stage file: `callouts.json`.
- The plugin of Shotgun has the new skill `shotgun-explain`.
- DataFlow gives the lines of a race only in a text: gap 46 of `dataflow-gaps-2.md`.
- The engine of DataFlow stops on a check of a `std::optional` with an error after it: gap 47 of `dataflow-gaps-2.md`.
- The repository of DataFlow has fixes for the gaps 30 to 33, 41 to 47. Shotgun uses their data in the place of texts. A race gives its lines from `accesses`, and only an access that can run at the same time as a different thread counts (gap 46). The rule of the main loop uses `isMainLoop` and `mainLoops` (gap 32).
- The base of a step also keeps each new file of the step. Thus the receipt shows the functions of a new file (gap 44). Each hole of a frame shows the names in scope at its line, with their types (gap 45).
- Decision 13: Shotgun refuses a fact of the survey with a tool of DataFlow that Claude did not call in the stage (gap 43).
- With DataFlow 0.6.0, Shotgun uses its procedures from before these fixes, and it does not check the calls of the tools.
- Tests: 120 unit tests. `scripts/test-claude.mjs` adds a race on a line of the user, its callout, an explanation, an answer on a line, and "Not a problem".

### Phase 7: frames and hints

- A step of level 3 gets a frame of Claude. Claude writes the lines with no decision, and a marker `/*@hole N: question */` in the place of each decision of the user. Decision 15 ends.
- A step of level 4 gets a frame only after the button **I want a frame** (decision 16). The command **Shotgun: I Want a Frame** does the same. The ledger records the decision.
- `shotgun_start_step` opens a frame with the kind `frame`. The new tool `shotgun_submit_frame` gives the holes, each with its question and 4 hints. The hints are a nudge, a pointer with places, an example with a place and its code, and the answer. Shotgun checks each marker and each place, and gives all problems in 1 list.
- The panel shows the note of Claude, the holes with their state, and the ladder of the 4 hints of the selected hole. The hints came with the frame, so a click sends no request to Claude. The hole also shows the facts of DataFlow at its line: the function, the threads and the locks.
- **4 Show me**, after a modal message, puts the answer of Claude into the place of the marker. Its lines are lines of Claude.
- The text editor shows each open hole in a dashed box. Its hover shows its question, the hints and a link to the next hint. A filled hole gets a line at the left side, with the color of its writer.
- Tab and Shift+Tab go to the next open hole and to the hole before it, while the cursor is in the frame. With no open hole, the keys indent as usual. **Shotgun: Show the Next Hint** opens the next hint of the hole at the cursor.
- A hole is done when code is in the place of its marker. Shotgun finds the place with the text around the marker, also after the user fills a different hole. The gate **The step is done** needs each hole filled.
- The frame lines get the tag "Claude · frame" in the gutter, and no receipt (decision 18).
- In stage 5, the user can change the level of each step that Claude did not start (decision 17). This includes the current step of the user. The plan page and **Shotgun: Set Risk Level** show the steps with a level that can change.
- "Give me a different frame for step N." opens the step again. The step keeps its base.
- The plugin of Shotgun has the new skill `shotgun-frame`.
- DataFlow gives no names in scope at a line: gap 45 of `dataflow-gaps-2.md`.
- Tests: 110 unit tests. `scripts/test-claude.mjs` adds a level change in stage 5, a frame on request, Tab, the hints and the gate of the frame.

### Phase 6: build

- In stage 5, the steps of the plan go in sequence. The current step is the first step that is not done. The risk level of a step selects its writer: Claude at the levels 1 and 2, the user at the levels 3, 4 and 5. Until the frames of phase 7, the user writes a step of level 3 (decision 15 of the plan). The plan page, the CodeLens lines and the tools show this writer.
- The new tool `shotgun_start_step` opens the current step for an errand of Claude. Shotgun saves the files of the scope, and makes the base of the step with `markBase` of DataFlow. The scope is the files of the places of the step.
- The guard lets Claude change only the files of the scope of the open step. Its reason names the scope. With no open step of Claude, its reason names the current step and its writer.
- The new tool `shotgun_submit_errand` closes the step, and makes the receipt from `getDiff` since the base. Each hunk needs a change of Claude with its lines, a title and a check for the user. Claude can give a note for each change, and the loose ends of the step.
- The receipt also shows the edits that the guard denied, and the files outside of the scope that changed while the step was open.
- In the panel, the user walks the receipt and puts a mark on each change: OK, issue or question. The user can write a note for Claude. **Shotgun: Mark a Change** does the same with the keyboard. The ledger records each mark and each note.
- The new tool `shotgun_get_step` gives a step with the marks and the notes of the user. After "Fix the issues of step N", Claude opens the step again. The step keeps its base, and a change with no new code keeps the mark OK.
- The gate **Accept the receipt** deletes the base of the step. An issue stops the gate. With changes that have no mark, or with questions, a modal message asks the user first.
- Shotgun opens a step of the user with a base of its files. The gate **The step is done** records the lines of the user since the base. After the last step, the gate is **The task is done**.
- `lines.json` keeps the writer of each changed line, with a hash of each line of the file. After each change of a file, the lines of each writer move with a diff of the lines. A line of Claude that the user changes becomes a line of the user.
- The text editor shows a mark in the gutter for each line of Claude. The mark is dashed until the user walks its change, and then it has the color of the mark of the user. The first line gets a tag, for example "Claude · not walked". An edit of the user in the scope of an open step of Claude gets a warning.
- The CodeLens line of a step shows its writer and its state in stage 5. The plan page shows the state of each step.
- `shotgun_get_session`, `shotgun_get_plan` and the context hook give the current step and the next work.
- The plugin of Shotgun has the new skill `shotgun-errand`.
- New stage files: `build.json` and `lines.json`.
- A new file of a step has no base in DataFlow: gap 44 of `dataflow-gaps-2.md`. Shotgun reads the new file at the receipt.
- Tests: 103 unit tests. `scripts/test-claude.mjs` adds a step of the user and an errand of Claude with a receipt. Then it adds an issue, the fix of the issue and the gate of the receipt.

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
