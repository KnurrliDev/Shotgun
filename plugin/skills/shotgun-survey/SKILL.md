---
name: shotgun-survey
description: 'Make the survey of the active Shotgun task in stage 2, and the survey of the changed tasks in stage 3. Use this skill when the user asks for the survey, for example "Survey my brief", or for a change of the survey. Also use it when the user asks for the survey of changed tasks, for example "Survey my changed tasks".'
---

# The survey of Shotgun

The survey is stage 2 of a Shotgun task. You read the brief and the code. Then you give the survey to Shotgun. In stage 3, the user puts the tasks of the survey in sequence. The user can also change the text of a task, and add a task. Then you survey these tasks.

You change no file in the stages 2 and 3. The guard of Shotgun stops each change. If the guard stops a change, do not try a different way, for example a shell command.

## The tools

- `mcp__plugin_dataflow_dataflow__shotgun_get_session` gives the active task, its stage, the brief and the survey.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_survey` gives the survey to Shotgun in stage 2.
- `mcp__plugin_dataflow_dataflow__shotgun_get_order` gives the order of the user in stage 3, and the tasks with no survey.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_task_survey` gives the survey of 1 task of the order to Shotgun in stage 3.
- The read tools of DataFlow give the facts of the C and C++ code:
  - `mcp__plugin_dataflow_dataflow__list_functions` gives the functions of a file with their lines.
  - `mcp__plugin_dataflow_dataflow__get_place` gives the function, the statements, the threads and the locks of a line.
  - `mcp__plugin_dataflow_dataflow__get_callers` gives the callers of a function.
  - `mcp__plugin_dataflow_dataflow__get_threads` gives the threads of a file and the data that 2 or more threads use.
  - `mcp__plugin_dataflow_dataflow__get_logic` gives the decisions of a function, for example the conditions of a loop.
  - `mcp__plugin_dataflow_dataflow__get_outline` gives the members of a type.
  - `mcp__plugin_dataflow_dataflow__get_heat` gives the heat of the functions: the risk of a change.

Load all these tools with 1 call of `ToolSearch`, with `select:` and the full names.

## Procedure

1. Call `shotgun_get_session`. Make sure that the stage is 2.
2. If the stage is 1, stop. Tell the user to select "The brief is ready" in the panel of Shotgun.
3. Read the brief with the tool Read. The field `brief.file` gives its path. Each part of the brief is optional. If the brief has little text, use the title of the task, and put the decisions that the brief does not give into your questions.
4. Find the files of the code that the brief names. If the brief names no file, find them with the tools Glob and Grep.
5. Call `list_functions` for these files. Then call `get_place`, `get_callers`, `get_threads` and `get_logic` for the functions and the lines that the brief names.
6. Read the lines of the code with the tool Read.
7. Write the tasks, the hooks, the facts and the questions. The sections below give the rules.
8. Call `shotgun_submit_survey` with the full survey.
9. If Shotgun gives problems, correct all of them. Then call the tool again.
10. Tell the user the number of tasks, hooks and questions. The survey page of Shotgun shows them.
11. Tell the user that the next gate is "Order the tasks". Only the user selects a gate.

## The tasks

A task is a part of the work of the brief. Give the tasks in no sequence, because the user puts them in sequence in stage 3.

- `id`: for example `T1`. Each id of the survey must be different.
- `title`: a short title of the task.
- `text`: you can give the work of the task in 1 to 3 sentences.
- `hooks`: the ids of the hooks of the task. Give an empty list only for a task with only new files.
- `needs`: the ids of the tasks that this task needs first. The needs must not make a circle.
- `size`: your estimate of the work of the task: `small`, `medium` or `large`.

## The hooks

A hook is a place in the code that is there now. A task puts new code at this place, or it changes the code there.

- `id`: for example `H1`.
- `title`: a short title, for example "The loop of solve()".
- `kind`: the new code at the place, in a few words. An example is "new check in solve()".
- `file`: the path of the file, relative to the first folder of the project.
- `lines`: `[first, last]`, from 1. Give the lines of the code as it is now, a maximum of 300 lines.
- `code`: a short text from these lines, copied exactly. Use the text of 1 line, for example a call or a condition.

Shotgun uses `code` to find the hook again when the code moves. Each hook must have a task.

For each hook in a C or C++ file, Shotgun gets the facts of DataFlow. These are the function, the threads and the locks of the line of `code`, and the heat of the lines. Do not write these facts in the survey.

## The facts

A fact is a fact of the code that the brief does not give. Give only the facts that the user must know before the order of the tasks. Give a maximum of 20 facts.

- `text`: the fact, in 1 or 2 sentences.
- `file` and `lines`: the place of the fact.
- `tool`: the read tool of DataFlow that you called, and that gave the fact. An example is `get_threads`. Give the short name, with no `mcp__` part.

Give a fact only from the result of a read tool of DataFlow that you called in this survey. If only the tool Read shows a fact, it is not a fact of the survey. Then write it in the text of a task, or ask a question about it.

The survey page shows each fact with the badge "Model" and with its tool. The user can open the place of the fact, and check it with the same tool.

## The questions

Ask a question only about a decision of the user that the brief and the code do not give. Give a maximum of 10 questions.

- `id`: for example `Q1`.
- `text`: the question, a maximum of 500 characters.

Do not answer your questions. The user answers them on the survey page.

## A change of the survey

When the user asks for a change of the survey:

1. Call `shotgun_get_session`. The field `survey.file` gives the path of the survey. The field `survey.questions` gives the answers of the user.
2. Read the survey with the tool Read.
3. Make the change. Keep the id of each item that stays.
4. Call `shotgun_submit_survey` with the full survey. The new survey replaces the old survey.

The answers of the user stay with the ids of their questions.

## Stage 3: the changed tasks

In stage 3, the user can change the text of a task, and add a task. Such a task has no survey for its text. When the user asks for the survey of these tasks, for example "Survey my changed tasks":

1. Call `shotgun_get_order`. The field `changed` gives the tasks of the plan with no survey.
2. If `changed` is empty, tell the user that each task of the plan has a survey. Then stop.
3. Read the code for the text of each task in `changed`, with the read tools of DataFlow and with the tool Read.
4. Call `shotgun_submit_task_survey` 1 time for each task in `changed`. The fields are below.
5. If Shotgun gives problems, correct all of them. Then call the tool again.
6. Tell the user the hooks and the needs of each task. The order page of Shotgun shows them.

The fields of `shotgun_submit_task_survey`:

- `task` and `text`: the id and the text of the task, copied exactly from `shotgun_get_order`.
- `hooks`: the ids of the hooks of the survey that the task changes.
- `newHooks`: the new hooks of the task, with ids that the survey does not have. A new hook has the fields of a hook of the survey.
- `needs`: the ids of the tasks of the order that this task needs first. The needs must not make a circle.
- `size`: your estimate of the work of the task.
- `note`: a short note for the user, for example "The same hook, H6. The range from 1 to 100 is a new decision."

Do not change the text or the place of a task. The order is the decision of the user. If a text is not clear, write this in the note, and tell the user.
