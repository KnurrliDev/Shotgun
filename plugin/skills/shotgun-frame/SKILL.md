---
name: shotgun-frame
description: 'Write the frame of a step of the active Shotgun task in stage 5, or of a step of the fixes in stage 6. A frame has all lines of the step, and a hole for each open decision of the step, with 4 hints. Use this skill for a frame, for example "Give me a frame for step 4" or "Give me a frame for step F2". Also use it for a different frame, for example "Give me a different frame for step 4".'
---

# A frame of Shotgun

The build is stage 5 of a Shotgun task. The risk level of a step gives its first writer, and a step of risk level 3 gets a frame. At each level, the user can select "Frame" in Shotgun. Then the step also gets a frame. The level stays, and the ledger records the choice of the user.

In stage 6, the review, the steps of the fixes have the ids F1, F2 and so on. Their open decisions are the decisions of the fixes. The same rules apply to their frames.

The plan names the open decisions of each step. In a frame, each open decision is exactly 1 hole, and you write all other lines of the step. The user fills each hole, and owns the decisions of the step. The hints of each hole come with the frame, so the user can get help with no request to you.

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

1. Call `shotgun_get_session`. Make sure that the stage is 5, or 6 for a step of the fixes.
2. Call `shotgun_get_step` with the step of the request, for example `"step": "4"`.
3. If the writer of the step is the user or you, stop. Tell the user: at each level, the user can select "Frame" in the panel of Shotgun first.
4. If the step is not the current step, stop. The steps go in sequence. Tell the user the current step.
5. Call `shotgun_start_step` with the step and `"kind": "frame"`.
6. Read the code of the places with the tool Read and with the read tools of DataFlow.
7. Read the `decisions` of the step in `shotgun_get_step`. Each decision with the state `open` is 1 hole. A decision with an `answer` is a choice of the user: write its code as the user said, in the frame. If the step has no open decision, obey the section "A frame with no open decision".
8. Write the frame with the file tools Edit and Write. Change only the files of the scope. Do not change a file with Bash.
9. Call `shotgun_submit_frame` with the decision and the hints of each hole. The sections below give the rules.
10. If Shotgun gives problems, correct all of them. Then call the tool again.
11. Tell the user that the panel of Shotgun shows the holes. Do not give the answers in the chat.

## The frame

- Write all lines of the step that are not the code of an open decision. These lines are the declarations, the data members, the signatures, the calls that the plan names, and the log lines. Also write the code of each decision with an answer of the user.
- In the place of the code of each open decision, write a marker in a comment: `/*@hole N: question */`. N is the number of the hole, from 1. The question names the decision, for example `/*@hole 1: What happens to the solve that still runs at the limit? */`.
- A hole holds the whole code of its decision: for example the condition with its branch, the change of the state, and the error path. Put the marker alone on its line in the place of these statements. A marker in an expression is only for a decision that is exactly 1 expression.
- A hole is never only a type, a name, a literal or a list of parameters. A hole is also never code that the text of the step gives. Such code has no decision, so it is a line of the frame. Shotgun refuses such a hole.
- Give each open decision exactly 1 hole, and give no other holes.
- Do not write the answer of a hole into the file, also not in a comment.

## The hints

Each hole has 4 hints. Each hint gives more help than the hint before it.

- `nudge`: a question that shows the way, with no code. For example: "Compare the counter of step 2 with the limit of step 1."
- `pointer`: where the facts for the decision are, with 1 to 4 places of the project: the file and the lines of each fact.
- `example`: a similar code in the project. Give its file, its lines, and its code, copied exactly from these lines. Also give why it is a good example.
- `answer`: 1 possible answer: the code in the place of the marker, exactly as it goes there. For a marker in an expression, give only the expression. The user can write a different answer.

Give each hole its `n`, its `decision` and its `question`. The decision is the id of its open decision, for example `D1`. The question is the same text as in its marker. Each marker needs a hole, and each hole needs its marker.

## A frame with no open decision

The user can select "Frame" for a step with no open decision. Then give 1 to 3 holes in the logic of the step, where the user learns the most. An example is a condition with its branch, a loop, or the change of a state.

- Give each hole a question that names the logic of the hole, for example `/*@hole 1: When does the loop stop? */`.
- Give each hole its `n`, its `question` and its 4 hints, with no `decision`.
- The other rules of the frame apply. A hole is never only a type, a name, a literal or a list of parameters.

Give a short `note` for the user: what the frame has, and which open decisions are holes.

## The guard

The guard of Shotgun lets you change only the files of the scope of the open step. If the guard stops a change, do not try a different way, for example a shell command. Tell the user.

## A different frame

When the user asks for a different frame, for example "Give me a different frame for step 4":

1. Call `shotgun_get_step` with the step. It gives the holes and the code that the user wrote.
2. Call `shotgun_start_step` with the step and `"kind": "frame"`. The step opens again, and it keeps its base.
3. Write the new frame. Then call `shotgun_submit_frame` with all holes of the new frame.
