---
name: shotgun
description: 'Work with the Shotgun extension of VS Code: its active task, the 5 stages, the guard, the brief and the questions about the brief. Use this skill when the user mentions Shotgun, or gives a brief for a task in the chat. Also use it when the user asks for questions about the brief, for example "Ask me questions about my brief", or about the active task.'
---

# Shotgun

Shotgun is a VS Code extension for pair programming. The user makes the decisions and keeps the ownership of the code. You do the work that the user gives you, and you give your results to Shotgun with its tools.

The full names of the tools start with `mcp__plugin_dataflow_dataflow__shotgun_`. Load a tool with `ToolSearch` and `select:` before its first call, for example `select:mcp__plugin_dataflow_dataflow__shotgun_get_session`.

## The contract

- Call `shotgun_get_session` first for each request about Shotgun. It gives the active task, its stage, the brief, the rule of the guard and the next work.
- Give your results only with the tools of Shotgun. Do not change the files in the folder `.shotgun`.
- The guard of Shotgun stops each change of a file in the stages 1 to 4. In stage 5, it lets you change only the files of the scope of your open step. If the guard stops a change, do not try a different way, for example a shell command. Tell the user the reason of the guard.
- A gate is a decision of the user. Only the user selects a gate, with a button of Shotgun. Tell the user which gate comes next.
- The user can return the task to an earlier stage at any time. Then the task is in that stage again, and the work of the later stages stays. Do a stage again only when the user asks, for example "Survey my brief.".
- The tools of Shotgun check your data. If a tool gives problems, correct all of them, and call the tool again.

## The stages

| Stage | Writer | Work |
| --- | --- | --- |
| 1 Brief | The user | The user writes the brief. You can ask questions about it. |
| 2 Survey | You | You read the code, and give the facts, the tasks and the hooks. |
| 3 Order | The user | The user puts the tasks in sequence. |
| 4 Plan | You | You make the steps of the plan. Shotgun gives each step a risk level. |
| 5 Build | The user and you | The risk level of a step selects its writer. |

## Stage 1: the brief

The brief is the text of the user, in the file `brief.md` of the task. It has 5 parts: Goal, Facts, Specs, Not in scope, and Done when. Each part is optional, and a brief can have only its title. Write no word in the brief.

### A brief in the chat

When the user gives a brief in the chat:

1. Copy the words of the user exactly. Do not correct, shorten or add a word, and do not move a fact to a different part.
2. You can put the headings of the parts above the lines of the user: `## Goal`, `## Facts`, `## Specs`, `## Not in scope` and `## Done when`.
3. You can put the list mark `- ` at the start of a line. Do not put a title line into the text.
4. If the user did not give a part, leave it out. Shotgun adds its heading to `brief.md`, and the part stays empty. Do not ask the user for the empty parts.
5. Call `shotgun_submit_brief` with a short title and the text.
6. If the user wants a new task for the brief, give `"isNewTask": true`.

Shotgun selects the task, so do not ask the user about the task before the call:

- Shotgun makes a new task if no task is active, if the active task is after stage 1, or if you give `"isNewTask": true`.
- Shotgun puts the brief into the active task in stage 1 only if its brief has no text.
- Shotgun never changes a brief with text. In that case, it refuses the brief, and you ask the user.

Shotgun checks each line against the recent prompts of the user. If Shotgun refuses a line, use the exact words of the user, or ask the user.

### Questions about the brief

When the user asks for questions about the brief, for example "Ask me questions about my brief":

1. Call `shotgun_get_session`. Read the brief with the tool Read. The field `brief.file` gives its path.
2. If the brief names code, read that code with the read tools of DataFlow.
3. Find the facts that the brief does not have, or that are not clear. Examples are a limit, a number, an error case, a thread, or the condition of done.
4. Call `shotgun_submit_questions` with 1 to 10 short questions. Give the part of each question. If a question is about a line, give a short quote of the brief, copied exactly.
5. Do not answer your questions, and do not write in the brief. Tell the user that the panel of Shotgun shows the questions.

The user can answer in the brief, and close each question in the panel. An answer is optional.

### The gate

The user selects "The brief is ready" in the panel of Shotgun when the brief is ready. The gate does not wait for a part of the brief or for an answer. Then the task goes to stage 2. The next request of the user is "Survey my brief.".

## Stage 2: the survey

When the user asks for the survey, for example "Survey my brief", use the skill `shotgun-survey`. It gives the rules for the tasks, the hooks, the facts and the questions.

## Stage 3: the order

The user puts the tasks in sequence on the order page of Shotgun. The user can also change the text of a task, add a task, and keep a task for later. Do not change the order: it is the decision of the user.

When the user asks for the survey of the changed tasks, for example "Survey my changed tasks", use the skill `shotgun-survey`. When the order is correct, the user selects "Accept the order".

## Stage 4: the plan

When the user asks for the plan, for example "Make the plan", use the skill `shotgun-plan`. The plan names the open decisions of each step. Shotgun gives each step a risk level from the facts of DataFlow and from its open decisions. A step with no open decision gets at most level 2. Do not choose a level: only the user changes a level. The user can answer a decision in words on the plan page. When the plan is correct, the user selects "Accept the plan".

## Stage 5: the build

The steps of the plan go in sequence. The risk level of a step selects its writer:

| Level | Writer |
| --- | --- |
| 1 and 2 | You. The step is an errand with a receipt for the user. You decide its open decisions, and the receipt shows your choices. |
| 3 | You write a frame, and the user fills a hole for each open decision of the step. |
| 4 | The user. If the user selects "I want a frame" in the panel of Shotgun, you write a frame. |
| 5 | The user. You change no file in the step, but you can answer questions in the chat. |

Use the skill `shotgun-errand` when the user asks for a step, for example "Do step 5". Also use it for a fix, for example "Fix the issues of step 5". Use the skill `shotgun-frame` when the user asks for a frame, for example "Give me a frame for step 4". Do not change a file before `shotgun_start_step` opens the step.

While the user writes a step, Shotgun shows the new facts of DataFlow on the lines of the user as callouts. Use the skill `shotgun-explain` when the user asks about a callout, for example "Explain the callout on line 129". Also use it for a question about a line, for example "Does the lambda on line 95 copy charge?".

At the gate of each step, Shotgun finds its loose ends. The user can hand a loose end to you as the next step. Use the skill `shotgun-errand` when the user asks for them, for example "Do the loose ends".

The user writes the commit message in the input box of Source Control. Use the skill `shotgun-commit` when the user asks for a check of the message, for example "Check my commit message". You change no message, and you make no commit: the user commits.
