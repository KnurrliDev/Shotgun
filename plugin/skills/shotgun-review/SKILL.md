---
name: shotgun-review
description: 'Review the whole diff of the active Shotgun task in stage 6, with the effort and the focus of the user. Give the issues to Shotgun. Use this skill when the user asks for the review of a Shotgun task, for example "Review my Shotgun task". Also use it when a prompt names the skill shotgun-review.'
---

# The review of Shotgun

Stage 6 of a Shotgun task is the review. You review the whole diff of the task, and you give the issues to Shotgun. Then the user works through the issues. The user starts the review in a new session of Claude Code, so this session did not write the code of the task.

You change no file in the review, and you decide nothing. The guard of Shotgun stops each change of a file. If the guard stops a change, do not try a different way, for example a shell command. Your subagents also change no file, and they run no shell command that changes a file.

The design comes from research on code review with LLMs: many candidates, a check of each candidate, and few issues for the user. A false issue costs the user a step, so precision comes first.

## The tools

- `mcp__plugin_dataflow_dataflow__shotgun_get_session` gives the active task and its stage.
- `mcp__plugin_dataflow_dataflow__shotgun_get_review` gives the review data: the effort, the focus, the base commit, and the changed files with their hunks, heat and writers. It also gives the ripple, the brief, the steps of the plan, the closed callouts and the earlier issues.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_review` gives the issues to Shotgun.
- The read tools of DataFlow give the facts of the C and C++ code:
  - `mcp__plugin_dataflow_dataflow__get_diff` gives the text of the hunks. Give `"base"`: the base commit of `shotgun_get_review`, and `"paths"`.
  - `mcp__plugin_dataflow_dataflow__get_ripple` gives the code that the changes reach. Give the same `"base"`.
  - `mcp__plugin_dataflow_dataflow__get_place` gives the function, the statements, the threads and the locks of a line.
  - `mcp__plugin_dataflow_dataflow__get_threads` gives the threads of a file, and the data that 2 or more threads use, with the locks of each access.
  - `mcp__plugin_dataflow_dataflow__get_flow` gives the flow of a value.
  - `mcp__plugin_dataflow_dataflow__get_callers` and `mcp__plugin_dataflow_dataflow__get_calls` give the callers and the calls of a function.
  - `mcp__plugin_dataflow_dataflow__get_logic` gives the decisions and the paths of a function.
  - `mcp__plugin_dataflow_dataflow__get_hidden` gives the hidden C++ of a function, for example copies and destructors.
  - `mcp__plugin_dataflow_dataflow__get_heat` gives the heat of the functions: the risk of a change.
  - `mcp__plugin_dataflow_dataflow__get_outline` and `mcp__plugin_dataflow_dataflow__get_member_sites` give the members of a type and the places that use them.

Load the tools with 1 call of `ToolSearch`, with `select:` and the full names. Each subagent loads its own tools.

## Procedure

1. Call `shotgun_get_session`. Make sure that the stage is 6. If the stage is 5, stop, and tell the user to select "The build is done" in the panel of Shotgun.
2. Call `shotgun_get_review`. Its effort and its focus are the choice of the user. Use them, also if the prompt gives a different effort or focus.
3. Plan the finders from the effort. The table in the section "The effort" gives them.
4. Start the finders as subagents with the tool Agent, all in 1 message, so that they run in parallel. Give each finder the prompt in the section "The prompt of a finder".
5. Collect the candidates of all finders. 2 candidates at the same place with the same defect are 1 candidate. Do not vote: a candidate of only 1 finder stays.
6. Check each candidate. At the effort low, give each candidate a short verdict yourself. From the effort medium, start 1 verifier subagent for each candidate, all in 1 message. Give each verifier the prompt in the section "The prompt of a verifier".
7. Remove each rejected candidate. Keep each confirmed candidate. Keep a plausible candidate with the verdict `plausible`, except at the effort low.
8. Put the issues in sequence: the important issues first, then the minor issues.
9. Call `shotgun_submit_review` with the issues, a maximum of 32. Shotgun puts each issue into the list of steps or into the second list.
10. If Shotgun gives problems, correct all of them. Then call the tool again.
11. Tell the user the number of issues in each list in 1 or 2 sentences. The panel and the page of Shotgun show the issues.

## The effort

| Effort | Finders | Context | Verify pass |
| --- | --- | --- | --- |
| low | 1 generalist finder. | The hunks, and the facts of DataFlow for the changed functions. | You give 1 short verdict for each candidate. Drop the plausible candidates. |
| medium | 1 finder for each area of the focus, and 1 generalist finder. | Also the ripple of each hunk, and the read tools of DataFlow on demand. | 1 verifier subagent for each candidate. |
| high | As medium. Each finder runs a second pass with a different order of the hunks. Take the union of the passes, with no vote. | As medium. | As medium. For race and lifetime candidates, the verifier reasons first. |
| xhigh | As high, and 1 more pass for each hot changed function. A hot function has the band hot or very hot in `shotgun_get_review`. | Also the callers of each hot changed function. | As high. |
| max | As xhigh, with up to 5 passes for the finders of races and lifetime. | As xhigh. | As xhigh. A second verifier only with new evidence. An example is a sanitizer run, but only if a build is there and the user agrees in the chat. The run must reach the flagged line. |

Above the effort high, the recall grows little, and the cost grows fast. Do not add passes that the table does not give.

## The areas of the focus

| Area | Categories | The finder looks for |
| --- | --- | --- |
| Correctness | `correctness` | Code that does not do what the step or the brief needs, also a null pointer, a bound or an error path. |
| Threads and races | `race`, `deadlock` | Data that 2 threads can use at the same time with no protection. A deadlock only with a cycle in the lock order from DataFlow. DataFlow gives no lock order yet, so report no deadlock. |
| Lifetime | `lifetime` | Data that a thread or a lambda uses after the end of its owner, a leak, or a double free. |
| The brief | `spec`, `scope` | A spec or a condition of done that the diff does not give, and a change that the brief puts out of scope. |
| Tests | `test` | A condition of done of the brief with no test. No general request for tests. |
| Cleanups | `cleanup` | Code that works, but repeats code or does more work than necessary. |

The generalist finder looks at all areas of the focus, with less depth.

## The rules for all finders

- Read first the lines of the user in the steps of the levels 3 to 5. Nobody read them a second time, and these steps have the most risk. `shotgun_get_review` gives the writer, the step and the level of each run of lines. Then read the lines of Claude with `"walked": false`. Then read the other changes.
- The finders of races and lifetime start from the facts of DataFlow. Call `get_threads` for each changed C or C++ file. Take each shared access in a changed function or in its ripple. Judge if 2 threads can reach it at the same time with no lock. Do not search the code for races with no fact of DataFlow.
- Give each finder a small slice: the hunk, its ripple and its facts. The finder calls the read tools of DataFlow for more. Do not paste search results or a list of all facts into a prompt.
- Report only a problem with a failure scenario: the trigger, the path through the changed code, and the wrong result. For a race, the scenario also gives the 2 accesses and 1 interleave of the 2 threads.
- Do not report style, the format of the code, names, linter issues, or a general request for tests.
- Do not report a callout that the user closed, or an issue that the user closed, again. `shotgun_get_review` gives them with the reasons of the user. Report such a problem only with new evidence.
- A place is on a changed line or in the ripple. Copy a short text of the code in the lines exactly.

## The prompt of a finder

Give each finder this prompt. Fill in the parts in angle brackets.

```text
You are a finder in the code review of a Shotgun task. You did not write the code. Change no file, and run no shell command
that changes a file.

Area: <the area and what it looks for, from the table of the areas>
Base commit: <the base commit>
Your hunks: <the files and the ids of the hunks, the hunks of the user in the steps of the levels 3 to 5 first>
The brief: <the brief, for the area The brief>
The steps: <the titles and the checks of the steps of these hunks>
Closed by the user: <the closed callouts and the closed issues of these files, with the reasons>

1. Load the read tools of DataFlow with ToolSearch.
2. Read the hunks with mcp__plugin_dataflow_dataflow__get_diff, with "base" and "paths".
3. For each changed function, read the facts of DataFlow for your area, for example get_threads for races.
4. Find the candidates of your area. Use only facts that you read in this session.
5. Give at most 10 candidates, the most severe first. For each candidate, give:
   - the place: the file, the lines [first, last], and a short text of the code in the lines, copied exactly
   - the category, the severity (important or minor), the origin (new or pre-existing) and the source (engine or model)
   - the failure scenario: the trigger, the path and the wrong result, and for a race the interleave of the 2 threads
   - the open decisions of the fix as questions, with no answer of yours
   - the read tools of DataFlow that you called and that show the candidate
Give no candidate with no failure scenario. If you find no candidate, say so.
```

## The prompt of a verifier

Give each verifier this prompt, with 1 candidate.

```text
You are the verifier of 1 candidate in the code review of a Shotgun task. You did not write the code, and you did not find
the candidate. Change no file, and run no shell command that changes a file.

Base commit: <the base commit>
The candidate: <the candidate of the finder, with its place, its scenario and its tools>

1. Load the read tools of DataFlow with ToolSearch.
2. Read the code and the facts again with the read tools of DataFlow. Do not trust the finder.
3. Give your verdict:
   - confirmed: the code and the facts show the failure scenario.
   - plausible: you cannot confirm the scenario, and you find no proof against it.
   - rejected: the code or a fact shows that the failure cannot occur.
4. Give the verdict first, then the reason in 1 to 3 sentences. For a race or a lifetime candidate, give the reason first,
   then the verdict.
5. Give a file and a line, and a fact of DataFlow, for each claim of your reason.
```

## The issues

Each issue for `shotgun_submit_review` has these fields:

- `title`: a short title, a maximum of 60 characters.
- `summary`: the defect in 1 sentence.
- `scenario`: the `trigger`, the `path` and the `result`. A race also needs the `interleave`.
- `category`: 1 of the categories in the table of the areas.
- `severity`: `important` for a wrong result, a crash, a race, a leak or a gap in the brief. Else `minor`.
- `origin`: `new` if the task added the problem. `pre-existing` if the problem was in the code before the task, for example in a file with `"notCommittedBefore": true`.
- `verdict`: `confirmed` or `plausible`, from the verify pass.
- `source`: `engine` if the candidate came from a fact of DataFlow, else `model`.
- `place`: the file, the lines and a short text of the code.
- `fixPlaces`: up to 4 more places of the same class of bug. Report the class 1 time, not each line.
- `decisions`: 0 to 3 open decisions of the fix, as questions. Give no choice of yours.
- `tools`: the read tools of DataFlow that show the issue. A subagent of this session called them, so Shotgun accepts them.
- `repeats`: the id of an earlier issue, if the issue is the same problem. Shotgun keeps its id and its state.
- `evidence`: the new evidence for an earlier issue that the user closed. Give such an issue only with the verdict `plausible`.

Give a review with no issue as an empty list. A short `note` can tell the user the parts that the review did not read.

## After the review

The panel of Shotgun shows the list of steps and the second list. The user works through the issues, and closes an issue that is not a problem with a reason. The next review gets the reasons. The user selects "The task is done". Then the user writes the commit message, and can ask for a check of it.
