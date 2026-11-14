---
name: shotgun-frame
description: 'Write the frame of a step of the build of the active Shotgun task in stage 5. A frame has the lines of the step with no decision, and a hole for each decision of the user, with 4 hints. Use this skill when the user asks for a frame, for example "Give me a frame for step 4". Also use it for a different frame, for example "Give me a different frame for step 4".'
---

# A frame of Shotgun

The build is stage 5 of a Shotgun task. A step of risk level 3 gets a frame. A step of level 4 gets a frame only after the user selects "I want a frame" in the panel of Shotgun.

In a frame, you write the lines of the step that have no decision. Each decision of the user is a hole. The user fills each hole, and owns the decisions of the step. The hints of each hole come with the frame, so the user can get help with no request to you.

## The tools

- `mcp__plugin_dataflow_dataflow__shotgun_get_session` gives the active task, its stage and the current step.
- `mcp__plugin_dataflow_dataflow__shotgun_get_step` gives a step: its text, places, checks, level, writer, state and scope, and the state of its holes.
- `mcp__plugin_dataflow_dataflow__shotgun_start_step` opens the current step. Give `"kind": "frame"`. Then the guard lets you change the files of its scope.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_frame` closes the step and gives the holes with their hints to Shotgun.
- The read tools of DataFlow give the facts of the C and C++ code:
  - `mcp__plugin_dataflow_dataflow__get_place` gives the function, the statements, the threads and the locks of a line.
  - `mcp__plugin_dataflow_dataflow__get_callers` gives the callers of a function.
  - `mcp__plugin_dataflow_dataflow__get_threads` gives the threads of a file.

Load all these tools with 1 call of `ToolSearch`, with `select:` and the full names.

## Procedure

1. Call `shotgun_get_session`. Make sure that the stage is 5.
2. Call `shotgun_get_step` with the step of the request, for example `"step": "4"`.
3. If the writer of the step is the user, stop. For a frame at level 4, the user selects "I want a frame" in the panel first. Tell the user.
4. If the step is not the current step, stop. The steps go in sequence. Tell the user the current step.
5. Call `shotgun_start_step` with the step and `"kind": "frame"`.
6. Read the code of the places with the tool Read and with the read tools of DataFlow.
7. Find the decisions of the step. A decision is a choice that the user must own. Examples are a condition, a limit, an order of the statements, or what happens in an error case. The text and the checks of the step tell you more.
8. Write the frame with the file tools Edit and Write. Change only the files of the scope. Do not change a file with Bash.
9. Call `shotgun_submit_frame` with the hints of each hole. The sections below give the rules.
10. If Shotgun gives problems, correct all of them. Then call the tool again.
11. Tell the user that the panel of Shotgun shows the holes. Do not give the answers in the chat.

## The frame

- Write only the lines that have no decision, for example a branch, a call that the plan names, or a log line.
- In the place of each decision, write a marker in a comment: `/*@hole N: question */`. N is the number of the hole, from 1. The question is short, and it names the decision, for example `/*@hole 1: When is the plan too late? */`.
- A marker can be in an expression, for example `if (/*@hole 1: When is the plan too late? */) {`. A marker can also be alone on its line for 1 statement or more.
- Do not write the answer of a hole into the file, also not in a comment.
- Give a frame 1 to 5 holes. Too many holes make the frame a test, and too few holes make it your code.

## The hints

Each hole has 4 hints. Each hint gives more help than the hint before it.

- `nudge`: a question that shows the way, with no code. For example: "Compare the counter of step 2 with the limit of step 1."
- `pointer`: where the facts for the decision are, with 1 to 4 places of the project: the file and the lines of each fact.
- `example`: a similar code in the project. Give its file, its lines, and its code, copied exactly from these lines. Also give why it is a good example.
- `answer`: the code in the place of the marker, exactly as it goes there. For a marker in an expression, give only the expression.

Give each hole its `n` and its `question`, the same text as in its marker. Each marker needs a hole, and each hole needs its marker.

Give a short `note` for the user: what the frame has, and which decisions are holes.

## The guard

The guard of Shotgun lets you change only the files of the scope of the open step. If the guard stops a change, do not try a different way, for example a shell command. Tell the user.

## A different frame

When the user asks for a different frame, for example "Give me a different frame for step 4":

1. Call `shotgun_get_step` with the step. It gives the holes and the code that the user wrote.
2. Call `shotgun_start_step` with the step and `"kind": "frame"`. The step opens again, and it keeps its base.
3. Write the new frame. Then call `shotgun_submit_frame` with all holes of the new frame.
