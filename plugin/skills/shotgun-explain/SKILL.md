---
name: shotgun-explain
description: 'Explain a callout of the active Shotgun task in stage 5, or in the step of an issue in stage 6. Also answer a question of the user about a line. A callout is a new fact of DataFlow on a line that the user wrote, for example a race. Use this skill when the user asks about a callout, for example "Explain the callout on line 129". Also use it for a question about a line, for example "Does the lambda on line 95 copy charge?".'
---

# Callouts and questions on a line

In stage 5, the user writes the steps of high risk. In stage 6, the user writes the steps of the issues of the review. Shotgun gets the facts of DataFlow for the lines that the user writes. A new fact on a line of the user is a callout, for example a race, a warning of the logic, or a hidden copy. The callouts show the facts of the engine. Your words come only when the user asks.

You change no code for a callout or for a question. The user owns the code of the step.

## The tools

- `mcp__plugin_dataflow_dataflow__shotgun_get_session` gives the active task, its stage and the current step.
- `mcp__plugin_dataflow_dataflow__shotgun_get_callouts` gives the callouts of the current step: the id, the place, the kind, the title and the facts of the engine of each callout.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_explanation` gives your explanation of a callout to Shotgun.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_line_answer` gives your answer to a question about a line to Shotgun.
- The read tools of DataFlow give the facts of the C and C++ code:
  - `mcp__plugin_dataflow_dataflow__get_place` gives the function, the statements, the threads and the locks of a line.
  - `mcp__plugin_dataflow_dataflow__get_threads` gives the threads of a file and the data that they share.
  - `mcp__plugin_dataflow_dataflow__get_flow` gives the reads and the writes of a variable or a data member.
  - `mcp__plugin_dataflow_dataflow__get_hidden` gives the hidden operations of a function, for example copies.
  - `mcp__plugin_dataflow_dataflow__get_logic` gives the decisions and the warnings of a function.

Load all these tools with 1 call of `ToolSearch`, with `select:` and the full names.

## Explain a callout

When the user asks about a callout, for example "Explain the callout on line 129":

1. Call `shotgun_get_callouts`. Find the callout of the request by its line or its id.
2. Read the code at the place with the tool Read and with the read tools of DataFlow.
3. Find the effect of the facts on the code of the user. For example, a race can give a wrong value or a second solver on the same data.
4. Call `shotgun_submit_explanation` with the id of the callout and 1 to 3 sentences. Do not repeat the facts: Shotgun shows them above your words.
5. Tell the user that the panel and the hover of the callout show your words. Do not give a fix in code. If the user asks for a fix, describe it in words.

## Answer a question about a line

When the user asks about a line, for example "Does the lambda on line 95 copy charge?":

1. Call `shotgun_get_session`. Find the file of the line: the file that the user names, else the file of the current step.
2. Read the line with the tool Read and with the read tools of DataFlow.
3. Call `shotgun_submit_line_answer` with the file, the line, the question and your answer. Copy the question exactly from the prompt of the user. Shotgun refuses a question that is not in the words of the user. Give an answer of 1 to 4 sentences.
4. Tell the user that the text editor and the panel of Shotgun show your answer at the line. Shotgun adds the facts of DataFlow at the line, so the facts of the engine and your words stay apart.
