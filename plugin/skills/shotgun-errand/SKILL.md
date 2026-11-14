---
name: shotgun-errand
description: 'Do a step of the build of the active Shotgun task in stage 5. Open the step, change only the files of its scope, and give the receipt with a note for each change. Use this skill when the user asks for a step, for example "Do step 5". Also use it when the user asks for a fix after the receipt, for example "Fix the issues of step 5".'
---

# An errand of Shotgun

The build is stage 5 of a Shotgun task. The steps of the plan go in sequence, and the risk level of each step selects its writer. You write a step of risk level 1 or 2: an errand. The user writes a step of risk level 3, 4 or 5.

For an errand, you open the step, change the files of its scope, and give a receipt. The user walks the receipt and puts a mark on each change: OK, issue or question. The user then accepts the receipt.

## The tools

- `mcp__plugin_dataflow_dataflow__shotgun_get_session` gives the active task, its stage and the current step.
- `mcp__plugin_dataflow_dataflow__shotgun_get_step` gives a step: its text, places, checks, level, writer, state and scope, and its receipt with the marks and the notes of the user.
- `mcp__plugin_dataflow_dataflow__shotgun_start_step` opens the current step. Then the guard lets you change the files of its scope.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_errand` closes the step and gives the receipt to Shotgun.
- The read tools of DataFlow give the facts of the C and C++ code:
  - `mcp__plugin_dataflow_dataflow__get_place` gives the function, the statements, the threads and the locks of a line.
  - `mcp__plugin_dataflow_dataflow__get_callers` gives the callers of a function.
  - `mcp__plugin_dataflow_dataflow__get_member_sites` gives the functions that use a data member of a type.

Load all these tools with 1 call of `ToolSearch`, with `select:` and the full names.

## Procedure

1. Call `shotgun_get_session`. Make sure that the stage is 5.
2. Call `shotgun_get_step` with the step of the request, for example `"step": "5"`. A step has an id, for example `S5`, and a number in the plan. The user names the number.
3. If the writer of the step is the user, stop. Tell the user that the user writes this step. You can answer questions in the chat.
4. If the step is not the current step, stop. The steps go in sequence. Tell the user the current step.
5. Call `shotgun_start_step` with the step. Shotgun saves the files of the scope and keeps their text as the base of the step.
6. Read the code of the places with the tool Read and with the read tools of DataFlow.
7. Make the change of the step with the file tools Edit and Write. Change only the files of the scope. Do not change a file with Bash.
8. Find the lines of each change in the text now, with the tool Read.
9. Call `shotgun_submit_errand` with a change for each change since the base of the step. The section below gives the rules.
10. If Shotgun gives problems, correct all of them. Then call the tool again.
11. Tell the user that the panel of Shotgun shows the receipt. The user puts a mark on each change, and then selects "Accept the receipt". Only the user selects a gate.

## The receipt

Shotgun gets the diff since the base of the step from DataFlow. Each part of the diff needs a change of yours, and each change of yours needs a part of the diff.

- `file`: a file of the scope.
- `lines`: `[first, last]` of the change in the text now, from 1. For a removed line, give the line after it.
- `title`: what the change does, for example "Read the new limit".
- `check`: what the user checks in the change, as a question, for example "Is 8 the correct value when the file has no key?".
- `note`: optional. Give a note for a change that the user did not ask for, a risk, or an answer to a question of the user.

Give the places outside of the scope that the step can also need in `looseEnds`. An example is a function that does not name a new data member. Do not change them. The user decides about them.

## The guard

The guard of Shotgun lets you change only the files of the scope of the open step. If the guard stops a change, do not try a different way, for example a shell command. Give that place as a loose end, and tell the user.

## The issues of the user

When the user asks for a fix, for example "Fix the issues of step 5":

1. Call `shotgun_get_step` with the step. `receipt.issues` and `receipt.questions` give the changes with the mark of the user and the note of the user.
2. Call `shotgun_start_step` with the step. The step opens again, and it keeps its base.
3. Fix each issue in the files of the scope. Give your answer to each question in the note of its change.
4. Call `shotgun_submit_errand` with a change for each change since the base of the step, also for the changes that you did not change now. A change with no new code keeps the mark OK of the user.
