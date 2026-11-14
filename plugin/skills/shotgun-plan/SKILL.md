---
name: shotgun-plan
description: 'Make the plan of the active Shotgun task in stage 4: the steps in the sequence of the order of the user. Use this skill when the user asks for the plan, for example "Make the plan". Also use it when the user asks for a change of the plan, for example "Split step 2 into 2 steps".'
---

# The plan of Shotgun

The plan is stage 4 of a Shotgun task. You make the steps of the plan in the sequence of the order of the user. Shotgun gives each step a risk level from the facts of DataFlow. In stage 5, the level of a step selects its writer. The writer is you, the user, or a frame of you with holes for the user.

You change no file in this stage. The guard of Shotgun stops each change. If the guard stops a change, do not try a different way, for example a shell command.

## The tools

- `mcp__plugin_dataflow_dataflow__shotgun_get_session` gives the active task, its stage and the file of the survey.
- `mcp__plugin_dataflow_dataflow__shotgun_get_order` gives the tasks of the order with their hooks, and the tasks with no survey.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_task_survey` gives the survey of 1 task with no survey.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_plan` gives the plan to Shotgun.
- `mcp__plugin_dataflow_dataflow__shotgun_get_plan` gives the plan with the level of each step.
- The read tools of DataFlow give the facts of the C and C++ code:
  - `mcp__plugin_dataflow_dataflow__list_functions` gives the functions of a file with their lines.
  - `mcp__plugin_dataflow_dataflow__get_place` gives the function, the statements, the threads and the locks of a line.
  - `mcp__plugin_dataflow_dataflow__get_heat` gives the heat of the functions: the risk of a change.
  - `mcp__plugin_dataflow_dataflow__get_callers` gives the callers of a function.

Load all these tools with 1 call of `ToolSearch`, with `select:` and the full names.

## Procedure

1. Call `shotgun_get_session`. Make sure that the stage is 4.
2. If the stage is 3, stop. Tell the user to select "Accept the order" on the order page of Shotgun.
3. Call `shotgun_get_order`. If `changed` has tasks, survey each of them first with `shotgun_submit_task_survey`. The skill `shotgun-survey` gives the rules.
4. Read the survey with the tool Read. The field `survey.file` of `shotgun_get_session` gives its path.
5. Read the code of the hooks with the read tools of DataFlow and with the tool Read.
6. Write the steps in the sequence of the tasks of the order. Each task of the plan needs 1 step or more. The sections below give the rules.
7. Call `shotgun_submit_plan` with all steps.
8. If Shotgun gives problems, correct all of them. Then call the tool again.
9. Tell the user the number of steps. The plan page of Shotgun shows them with their risk levels.
10. Tell the user that the user can change each level, and that the next gate is "Accept the plan". Only the user selects a gate.

## The steps

A step is a small change that the user can check in 1 time.

- `id`: for example `S1`. Each id must be different.
- `title`: a short title of the step.
- `task`: the id of the task of the order.
- `hooks`: the ids of the hooks of the survey that the step changes.
- `places`: the places that the step changes, 1 to 8. A place is lines of a file that is there, or a new file:
  - Lines: give `file`, `lines` as `[first, last]` from 1, and `code`. The `code` is a short text from these lines, copied exactly.
  - A new file: give `file` and `"new": true`, with no lines and no code.
- `text`: what the step does, in 1 to 3 sentences.
- `checks`: 1 to 5 checks for the user after the step, for example "The project builds." or "The new test passes.".
- `note`: a short note for the user, for example a risk that the facts of DataFlow show.

Give each step only the places that it changes. The level of a step is the highest level of its places. Thus a change of a hot function must be in its own step, apart from the cool changes.

Do not choose a level. Shotgun makes each level from the facts of DataFlow, and only the user changes a level.

## A change of the plan

When the user asks for a change of the plan, for example "Split step 2 into 2 steps":

1. Call `shotgun_get_plan`.
2. Make the change. Keep the id of each step that stays. A level of the user stays with the id of its step.
3. Call `shotgun_submit_plan` with all steps. The new plan replaces the old plan.
