---
name: shotgun-plan
description: 'Make the plan of the active Shotgun task in stage 4: the steps in the sequence of the order of the user. Use this skill when the user asks for the plan, for example "Make the plan". Also use it when the user asks for a change of the plan, for example "Split step 2 into 2 steps".'
---

# The plan of Shotgun

The plan is stage 4 of a Shotgun task. You make the steps of the plan in the sequence of the order of the user, and you name the open decisions of each step. Shotgun gives each step a risk level from the facts of DataFlow and from its open decisions. In stage 5, the level of a step selects its writer. The writer is you, the user, or a frame of you with a hole for each open decision.

A step with no open decision gets at most level 2, so you write it, and the user walks the receipt. A step with an open decision keeps the level of the heat. Thus the open decisions select the work of the user. Name them with care.

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
4. Read the survey with the tool Read. The field `survey.file` of `shotgun_get_session` gives its path. Also read the brief, and the answers of the user to the questions of the survey: `survey.questions` of `shotgun_get_session` gives them.
5. Read the code of the hooks with the read tools of DataFlow and with the tool Read.
6. Write the steps in the sequence of the tasks of the order. Each task of the plan needs 1 step or more. The sections below give the rules.
7. Find the open decisions of each step. The section "Open decisions" gives the rules.
8. Call `shotgun_submit_plan` with all steps.
9. If Shotgun gives problems, correct all of them. Then call the tool again.
10. Tell the user the number of steps and the open decisions. The plan page of Shotgun shows them with the risk levels.
11. Tell the user: the user can answer a decision in words on the plan page, add a decision, or change a level. The next gate is "Accept the plan". Only the user selects a gate.

## The steps

A step is a small change that the user can check in 1 time.

- `id`: for example `S1`. Each id must be different.
- `title`: a short title of the step.
- `task`: the id of the task of the order.
- `hooks`: the ids of the hooks of the survey that the step changes.
- `places`: the places that the step changes, 1 to 8. A place is lines of a file that is there, or a new file:
  - Lines: give `file`, `lines` as `[first, last]` from 1, and `code`. The `code` is a short text from these lines, copied exactly.
  - New lines next to lines that do not change: also give `"insert": true`. For example, a new data member goes after the last member of a type. Then the place is the line of that member, with `"insert": true`. With no `insert`, Shotgun takes the member of the lines as changed, and gives the step the heat of the functions that use that member.
  - A new file: give `file` and `"new": true`, with no lines and no code.
- `text`: the goal and the result of the step, in 1 to 3 sentences. Give no answer to an open decision of the step.
- `checks`: 1 to 5 checks for the user after the step, for example "The project builds." or "The new test passes.".
- `note`: a short note for the user, for example a risk that the facts of DataFlow show.
- `decisions`: the open decisions of the step, 0 to 3. Give an empty list for a step with no open decision.

Give each step only the places that it changes. The level of a step is the highest level of its places. Thus a change of a hot function must be in its own step, apart from the cool changes.

Do not choose a level. Shotgun makes each level from the facts of DataFlow and from the open decisions, and only the user changes a level.

## Open decisions

An open decision is a choice that changes what the code does. The brief, the answers of the user and the order do not settle it. The user owns these choices. Give each decision as a short question, for example "What happens to the solve that still runs at the limit?". You can give the options that you see, but not your choice.

These are open decisions:

- what happens in an error case, at a limit, or when data is missing
- which state comes next, or which branch handles a case
- the sequence of 2 actions, when the sequence changes the result
- what happens to data that a different thread uses
- a rule of the product, for example retry or stop, or a trade-off of speed and safety

These are no open decisions:

- a type, a name, a list of parameters, a return type or an include
- the place of a declaration, for example a new data member next to the other members
- a value or a rule that the brief or the answers of the user give
- a choice with only 1 correct answer in the code, for example the only member that holds the state
- code that follows from a decision of the user

Put each open decision into the step that writes its code. Do not answer an open decision in the text, the checks or the note of the step. A decision that the brief or the answers of the user settle is no open decision: the text of the step can give its answer.

A step with no open decision is your work at level 2 or lower, also in a hot function. Only a step at level 5 stays a step of the user. Do not name a decision only to give a step to the user, and do not leave out a decision to keep a step.

## A change of the plan

When the user asks for a change of the plan, for example "Split step 2 into 2 steps":

1. Call `shotgun_get_plan`.
2. Make the change. Keep the id of each step that stays. A level of the user stays with the id of its step.
3. Call `shotgun_submit_plan` with all steps. The new plan replaces the old plan.
