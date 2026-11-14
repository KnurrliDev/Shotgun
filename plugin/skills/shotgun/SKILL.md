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
- The guard of Shotgun stops each change of a file in the stages 1 to 4. If the guard stops a change, do not try a different way, for example a shell command. Tell the user the reason of the guard.
- A gate is a decision of the user. Only the user selects a gate, with a button of Shotgun. Tell the user which gate comes next.
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

The brief is the text of the user, in the file `brief.md` of the task. It has 5 parts: Goal, Facts, Specs, Not in scope, and Done when. Write no word in the brief.

### A brief in the chat

When the user gives a brief in the chat:

1. Copy the words of the user exactly. Do not correct, shorten or add a word, and do not move a fact to a different part.
2. You can put the headings of the parts above the lines of the user: `## Goal`, `## Facts`, `## Specs`, `## Not in scope` and `## Done when`.
3. You can put the list mark `- ` at the start of a line. Do not put a title line into the text.
4. If the user did not give a part, leave it out. Shotgun adds its heading to `brief.md`, and the user writes it.
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

The user answers in the brief, and closes each question in the panel.

### The gate

When each part of the brief has text, the user selects "The brief is ready" in the panel of Shotgun. Then the task goes to stage 2. The next request of the user is "Survey my brief.".

## Stage 2: the survey

When the user asks for the survey, for example "Survey my brief", use the skill `shotgun-survey`. It gives the rules for the tasks, the hooks, the facts and the questions.
