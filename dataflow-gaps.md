# DataFlow: gaps for Shotgun

- Date: 13 November 2026
- DataFlow: version 0.5.0, with version 1 of the application programming interface (API) for extensions
- Status: after this analysis, DataFlow closed 28 of the 29 items. `dataflow-gaps-2.md` gives the status of each item, and the new gaps.
- Sources in the repository of DataFlow: `api/dataflow-api.d.ts`, `docs/api.md`, `docs/tools.md`, `docs/heat-score-strategy.md`, `TODO.md`, `src/api/api.ts`, `src/mcp/host.ts`, `src/mcp/tools.ts`, `src/review/guide.ts`, `src/lenses/heat.ts`, `src/state/store.ts`, `src/webview-side/guide.tsx` and `engine/include/dataflow/callgraph.hpp`

Shotgun is a VS Code extension for pair programming with a language model. It uses DataFlow as a dependency. It gets the API with `getApi(1, { client: 'Shotgun' })`. The model reads the facts of DataFlow through its Model Context Protocol (MCP) server.

A gap is a method, a parameter, a field, an event or an analysis that Shotgun needs and that DataFlow 0.5.0 does not have. This document gives all gaps that the analysis of 13 November 2026 found.

Shotgun can start with version 1 of the API as it is. No gap stops the start of the work on Shotgun. Each fix removes code from Shotgun, or makes a fact of Shotgun more accurate.

Each item has these parts:

- **Data:** the code or the document of DataFlow that shows the gap
- **Use in Shotgun:** the reason why Shotgun needs the fix
- **Until the fix:** the procedure of Shotgun with DataFlow 0.5.0
- **Possible fix:** a change of DataFlow that removes the gap

## Terms of Shotgun

| Term | Description |
| --- | --- |
| Stage | One of the 5 parts of the work: brief, survey, order, plan and build. |
| Hook | A place where new code goes into the code that is there, for example a new row in a dialog. |
| Plan | The steps of the work, in the form of a guided review: title, place, text and checks. |
| Risk level | A number from 1 to 5 for each step of the plan. It selects the writer of the step: the model or the user. |
| Receipt | A diff walk through the lines that the model wrote in a step. |
| Callout | A note at a line of new code. It tells a fact that the engine found. |

## The risk level and the heat

Shotgun makes the risk level of a step from the heat of DataFlow. The step gets the band of the hottest function that has a line of the step. This rule is a proposal for Shotgun.

| Heat band of DataFlow | Risk level | Writer of the step |
| --- | --- | --- |
| No heat: a new file with no caller | 1 | The model |
| cool, 0 to 24 | 2 | The model |
| warm, 25 to 49 | 3 | The model writes a frame, and the user writes each decision |
| hot, 50 to 74 | 4 | The user |
| very hot, 75 to 100 | 5 | The user |

With this rule, a wrong heat score is a wrong permission. A score that is too low lets the model write code that the user must write. Thus the gaps of the heat are important for Shotgun.

## Order of the work

Do the groups in this sequence.

| Group | Items | Reason |
| --- | --- | --- |
| 1 | 1, 2, 3, 9, 15, 17, 21, 25 | Shotgun has no good procedure without the fix. |
| 2 | 4, 5, 8, 10, 11, 12, 13, 14, 18, 19, 22, 23, 24, 26, 28, 29 | Shotgun has a procedure, but it needs more code or it gives less accuracy. |
| 3 | 6, 7, 16, 20, 27 | The item is small or optional. |

## Guide

### 1. A new guide replaces the guide that shows

- **Data:** DataFlow has 1 guide in its state. `showReviewPlan` and `showDiffWalk` in `src/mcp/host.ts` call `store.update({ guide })`. Thus a new guide replaces the guide that shows. It also replaces a guide of the user or of a different client.
- **Use in Shotgun:** The plan of Shotgun must stay while a receipt shows. Shotgun must not remove a guided review of the user.
- **Until the fix:** Shotgun keeps the plan and the marks in its own state. After a receipt, Shotgun shows the plan again and sets each mark again with `reviewStep`.
- **Possible fix:** Give each guide an identifier (`id`). Keep a guide that has a different `id`. Show it again when the top guide closes.

### 2. The facts of a guide do not give its client

- **Data:** `GuideFacts` in `api/dataflow-api.d.ts` has no field `client`. The state has the name of the client, because the tab Guide shows "Plan of" with this name. `closeGuide` and `reviewStep` in `src/mcp/host.ts` do not compare the client. Thus a client can close the guide of a different client, or set a mark on it.
- **Use in Shotgun:** Shotgun must know if the guide on the screen is its plan. Shotgun must not close a guide of the user.
- **Until the fix:** Shotgun compares the title and the steps of the guide with its plan.
- **Possible fix:** Add `client` and the `id` of item 1 to `GuideFacts`. Refuse `close_guide` and `review_step` for the guide of a different client. Accept them only with a flag `force`.

### 3. A step of a guide needs a C or C++ file that is there

- **Data:** `showReviewPlan` in `src/mcp/host.ts` opens the file of each step. `resolveGuidePlan` in `src/review/guide.ts` gives a problem in these cases:
  - The file is not in the project.
  - The file is not a C or C++ file.
  - The lines are not in the file.

  With a problem, DataFlow shows no guide.
- **Use in Shotgun:** A plan has steps for new files. It also has steps in other files, for example `CMakeLists.txt`, a `.ui` file or a `.qml` file.
- **Until the fix:** Shotgun shows such a step only in its own view. Thus the guide of DataFlow does not have all steps of the plan.
- **Possible fix:** Let a step have a place with no file, for example the text "new file: `tests/fake_solver.hpp`". For such a step, keep the file that the side view shows. As an alternative, accept each text file of the project as the file of a step.

### 4. A step has no data of the client

- **Data:** A step of `show_review_plan` has the fields `title`, `file`, `lines`, `text`, `checks` and `kind`. A step of `show_diff_walk` has `hunks` in the place of `file` and `lines`. The field `kind` has 5 fixed values. No field keeps data of the client.
- **Use in Shotgun:** A step of the plan has a risk level and a writer. A step of a receipt has the writer of its lines. The user must see these data in the tab Guide.
- **Until the fix:** Shotgun writes these data at the start of the text of the step.
- **Possible fix:** Add `label` to a step: a short text that the tab Guide shows next to the title. Add `data` to a step: an object that DataFlow keeps and gives again in `GuideFacts`.

### 5. The user cannot write a note for a step

- **Data:** The tab Guide in `src/webview-side/guide.tsx` has the marks OK, issue and question. It has no text field. Only a client can write the note of a step, with `review_step`. `GuideFacts` gives `hasNote`, but it does not give the text of the note.
- **Use in Shotgun:** The user does a review of the plan before the user accepts it. For a step with the mark issue or question, Shotgun needs the reason of the user.
- **Until the fix:** Shotgun asks for the reason in its own view.
- **Possible fix:** Add a text field for a note of the user to each step in the tab Guide. Give the note of the client and the note of the user in `GuideFacts`.

### 6. The event of the guide does not give the cause

- **Data:** `ApiEvents` in `src/api/api.ts` sends `onDidChangeGuide` each time the state has a new guide object. The event has all facts of the guide, but not the cause. An edit that moves the lines of a step also sends the event.
- **Use in Shotgun:** Shotgun needs 2 causes: the user set a mark, or the user went to a different step.
- **Until the fix:** Shotgun compares each event with the event before it.
- **Possible fix:** Add `change` to the event, with the values `start`, `step`, `mark`, `note`, `move` and `close`. Add `by`, with the value `user` or the name of the client.

### 7. A plan has a maximum of 20 steps

- **Data:** `MAX_GUIDE_STEPS` in `src/review/guide.ts` is 20. A diff walk has a maximum of 40 steps.
- **Use in Shotgun:** A plan for a large task can have more than 20 steps.
- **Until the fix:** Shotgun shows a long plan in parts of 20 steps.
- **Possible fix:** Add sections to a guide, or set the maximum to 40 steps.

## Heat

### 8. The reasons of the heat are text

- **Data:** The function `heat` in `src/mcp/host.ts` gives each reason as 1 text, with the points and the group at its end. An example is "Runs in each frame: called in the main loop of main (+40 reach)". `HeatReason` in `src/lenses/heat.ts` has `group`, `points` and `text`. It has no name for the signal.
- **Use in Shotgun:** Shotgun shows the signals of a hook, for example the frame path and the data that threads share. A rule of Shotgun cannot safely read an English sentence.
- **Until the fix:** Shotgun uses only the score and the band for its rule. It shows the reasons as text.
- **Possible fix:** Add `signals` to each function of `get_heat`. Each signal has `id`, `group`, `points`, `text` and `value`. Examples of `id` are `framePath`, `frameLoop`, `callers`, `callerFiles`, `includeReach`, `interface`, `decisions`, `depth`, `writes`, `sharedData`, `loopCosts`, `length`, `commits`, `fixes` and `recent`.

### 9. No flag tells that the reach is complete

- **Data:** `HeatModel` in `src/lenses/heat.ts` has `isReachComplete`, but `HeatFacts` does not have it. `get_heat` gives the state of the scan as a text in `callGraph`, and the notices as texts. Until the scan of the call graph is complete, the reach has no callers and no frame path. In that time, the half points of a siloed function also do not apply.
- **Use in Shotgun:** Shotgun must not make a risk level from a score whose reach is not complete. Such a score can be too low or too high.
- **Until the fix:** Shotgun waits for `onDidChangeCallGraph` with the state `ready`. Then it calls `getHeat` again and reads the notices.
- **Possible fix:** Add `isReachComplete` to each function in `HeatFacts`, in `changedFunctions` and in `hottestChanges`.

### 10. `get_heat` does not accept lines

- **Data:** `HeatArgs` has `file` and `function`, and no lines. For a file with many functions, `get_heat` gives a part of the functions and the number of the others in `more`. `hottestIn` in `src/lenses/heat.ts` finds the hottest function in a range of lines. No tool gives this function to a client.
- **Use in Shotgun:** A step and a hook are a file and lines. Shotgun needs the heat of the functions in these lines.
- **Until the fix:** Shotgun calls `listFunctions`. Then it calls `getHeat` for each function in the lines.
- **Possible fix:** Add `lines` to `get_heat`: the first and the last line. Give the functions that have a line in the range, the hottest first.

### 11. Code outside of a function has no heat

- **Data:** The engine request `dataflow/metrics` gives data for each function definition of a file. Thus a type, a data member, an enumerator, a macro and a global variable have no score. `TODO.md` has the same limit for Change Ripple: "A change outside of a function gets no ripple."
- **Use in Shotgun:** Many steps add a member to a type, for example a field of the settings. Such a step gets no risk level from the heat.
- **Until the fix:** Shotgun gives such a step the risk level 2. It shows the include reach from `getIncludes` and the layout from `getOutline`. The user can set a higher risk level.
- **Possible fix:** Add a heat score for a type and for a data member. Take its reach from the include reach of the header, and from the functions and the files that use it. Take its risk from the threads that share the member.

### 12. A line has no facts of its own

- **Data:** The heat is the heat of a function. `get_structure` gives the statements with their kinds. Below the third level, it gives only the number of the statements. `get_threads` gives the threads that share data, not the threads that run a line.
- **Use in Shotgun:** A hook is a line. New code at a hook runs with the loops, the threads and the locks of that line. Thus 2 hooks in 1 function can have different risks.
- **Until the fix:** Shotgun uses the heat of the function of the hook.
- **Possible fix:** Add the read tool `get_place` with `file` and `line`. Give these data for the line:
  - the function
  - the loops and the decisions around the line
  - the frame path
  - the thread starts that reach the line
  - the locks that the code holds at the line

### 13. The callers of the call graph are only a number

- **Data:** The reasons of the heat give the number of the transitive callers, and the frame path as a text. `get_calls` gives the callers in the file, and the direct callers in other files. No tool gives the transitive callers or the frame path as data.
- **Use in Shotgun:** The survey of stage 2 shows which functions reach a hook. The model also needs these paths to find the hooks.
- **Until the fix:** Shotgun and the model call `get_calls` for each function on the path, one function after the other.
- **Possible fix:** Add the read tool `get_callers` with `file`, `function` and `depth`. Give each caller with its file and its line, and the paths from the frame functions. Also add `framePath` to the signals of item 8, as a list of function names.

### 14. The heat has no data of the tests

- **Data:** No signal in `docs/heat-score-strategy.md` uses the tests of the project. The call graph can have the functions of the test files, but DataFlow does not know which files are test files.
- **Use in Shotgun:** For a step with the risk level 4 or 5, Shotgun tells the user if a test reaches the function. The checks of a step also use this fact.
- **Until the fix:** Shotgun has no such fact.
- **Possible fix:** Add a setting for the folders of the tests, for example `dataflow.heat.testFolders`. Give `tests` for each function in `get_heat`: the number of the test functions that reach it, and their files. Give no points for this signal.

### 15. A caller that the call graph cannot see makes a function siloed

- **Data:** `buildHeat` in `src/lenses/heat.ts` sets a function to siloed if its reach is less than 10. Then its risk and its history count half. `TODO.md` tells that the call graph does not see these calls:
  - a call through a pointer to a function or through a std::function
  - a call from a library, for example through a callback, a signal or a task queue
  - a call from a library to an override in the project, for example to an event handler of Qt

  A function with only such calls has no caller in the graph. Thus it gets a low reach, the half points and a cool band.
- **Use in Shotgun:** A cool band gives the risk level 2, and then the model writes the code. In a Qt application, many slots and event handlers get this band. This is the most important gap for Shotgun.
- **Until the fix:** The user must set a higher risk level for each such function. Shotgun cannot find these functions.
- **Possible fix:** Find a function whose address the code uses, and an override of a virtual function of a library. Set the reach of such a function to "not known". Do not use the half points for it. Give a reason that tells this to the user. As a second step, add an edge to the call graph from each `connect` call to its slot.

### 16. The frame path stops after 8 calls, and no notice tells it

- **Data:** `frame_max_depth` in `engine/include/dataflow/callgraph.hpp` is 8. A function that is more than 8 calls after a frame function is not on the frame path. No reason and no notice of `get_heat` tells that the limit stopped the path.
- **Use in Shotgun:** Such a function does not get the 40 points of the frame path. Thus its band and its risk level can be too low.
- **Until the fix:** The user adds a function from the middle of the path to `dataflow.heat.frameFunctions`.
- **Possible fix:** Give a notice in `get_heat` and in the tab Heat when the limit stops a frame path.

## Blocks, notes, comments and details

### 17. All clients share 1 layer for each file

- **Data:** `modelLayers` in `src/state/store.ts` has 1 layer for each file. All clients write in this layer. `highlight` and `comment_lines` with no `append` replace all notes or all comments of the file. `clear` with no file removes the layers of all files.
- **Use in Shotgun:** Shotgun puts callouts on the code. At the same time, Claude Code puts blocks and notes on the same file through the MCP server of DataFlow. Each client removes the items of the other client.
- **Until the fix:** Shotgun always uses `append`, and it does not call `clear`. Thus Shotgun cannot remove an old callout.
- **Possible fix:** Keep 1 layer for each client and each file. Let `clear`, `highlight` and `comment_lines` write only in the layer of their client.

### 18. A note has no identifier

- **Data:** The results of `highlight` and `comment_lines` give lines, but no identifier. `add_detail` gives an `id`, but no tool removes 1 detail. `clear` removes all items of a file.
- **Use in Shotgun:** Shotgun removes a callout when the user corrects the code. It also removes a callout that the user does not accept.
- **Until the fix:** Shotgun sends all its notes of the file again, without the old note. This procedure needs the fix of item 17.
- **Possible fix:** Give an `id` for each note, each comment and each detail. Add the view tool `remove` with a list of identifiers.

### 19. A note, a detail and a step have no button of a client

- **Data:** `NoteInput`, `AddDetailArgs` and the steps of a guide have texts, and no buttons. The API has no event for a click of the user on an item of a client.
- **Use in Shotgun:** The user answers a callout at the code, for example with "Show the proof" or "Not a problem". The user also asks for a hint at a step.
- **Until the fix:** Shotgun shows these buttons in the text editor and in its own view.
- **Possible fix:** Add `actions` to a note, a detail and a step. Each action has an `id` and a `title` for 1 button. Add the event `onDidInvokeAction` with the client, the `id`, the file, the line and the step.

### 20. An extension cannot add a tab to the details column

- **Data:** The API has methods for blocks, notes, comments, details and the guide. It has no method for a view of an extension in the side view.
- **Use in Shotgun:** Shotgun shows the stages, the plan with the risk levels, and the hints. With its own view, the user has 3 columns: the text editor, the side view and the view of Shotgun.
- **Until the fix:** Shotgun has its own view.
- **Possible fix:** Add `registerTab` with an `id` and a `title`. Accept simple content: sections, rows and buttons. This item is large and optional.

## Diff walk and Change Ripple

### 21. `get_diff` has no base in the middle of a task

- **Data:** The parameter `base` of `get_diff` accepts `uncommitted`, `target`, or a commit, a tag or a branch. Shotgun makes no commits. Thus the changes of all steps are in 1 diff against HEAD.
- **Use in Shotgun:** A receipt shows the changes of 1 step.
- **Until the fix:** Shotgun keeps a record of the lines that the model wrote. It puts the hunks of these lines first in the diff walk.
- **Possible fix:** Add the tool `mark_base` with a `name` and `paths`. It keeps the text of the files at that time. Let `get_diff` accept such a base, for example `base: 'mark:step-5'`.

### 22. A diff walk shows all hunks

- **Data:** `show_diff_walk` adds a step at the end for each hunk that is in no step of the plan. The result gives these steps in `addedSteps`.
- **Use in Shotgun:** A receipt shows only the hunks of the model. The hunks of the user in the same files are not a part of it.
- **Until the fix:** The receipt has the hunks of the user as more steps at its end.
- **Possible fix:** Add the parameter `allHunks` to `show_diff_walk`. With the value `false`, add no steps.

### 23. `start_ripple` has no parameters

- **Data:** `docs/tools.md` gives no parameters for `start_ripple`. The tool compares the working tree with the merge base of the target branch. If the repository has no target branch, VS Code asks the user for it.
- **Use in Shotgun:** Shotgun shows the code that the changes of 1 step reach. A question of VS Code in the middle of a step stops the work of the user.
- **Until the fix:** Shotgun runs Change Ripple for all changes of the branch, and only on a request of the user.
- **Possible fix:** Add `base` and `paths` to `start_ripple`, as in `get_diff`. Accept the base of item 21.

### 24. A change outside of a function gets no ripple

- **Data:** `TODO.md` has this item for Change Ripple. A changed type, global variable or macro shows only as "outside of a function".
- **Use in Shotgun:** After a new data member or a new enumerator, Shotgun shows the other places that also need the new member. Examples are a load function, a save function and a `switch` statement.
- **Until the fix:** The model finds these places with a search of the text. Thus they are words of the model, not facts of the engine.
- **Possible fix:** Add the read tool `get_member_sites` with a type. Give the functions that use most data members of the type. For an enum, give each `switch` statement on the enum that has no `default`.

## API and MCP server

### 25. An extension cannot add tools to the MCP server

- **Data:** `DataFlowApi` has `callTool` and `tools`, but no method that adds a tool. `createTools` in `src/mcp/tools.ts` makes a fixed list of tools.
- **Use in Shotgun:** The model needs tools for the stages, for example `get_brief`, `submit_survey`, `submit_plan` and `get_step`. With these tools in the MCP server of DataFlow, Claude Code needs only 1 connection.
- **Until the fix:** Shotgun has its own MCP server, with its own port, token, bridge and plugin for Claude Code.
- **Possible fix:** Add `registerTools` to the API. Each tool has `name`, `title`, `description`, `inputSchema`, `isReadOnly` and a function `call`. Put the name of the client before the name of each tool. Give a disposable that removes the tools.

### 26. No event tells the end of a parse

- **Data:** The API has 4 events: the engine state, the view, the guide and the call graph. `TODO.md` tells that the extension sends the text to the engine 250 ms after the last key.
- **Use in Shotgun:** After the user writes code, Shotgun asks for new facts, for example with `getThreads` and `getHidden`. It must ask after the engine has the new text.
- **Until the fix:** Shotgun asks after a save of the file, and after a fixed time.
- **Possible fix:** Add the event `onDidParse` with the file and the parse errors.

### 27. The engine state `failed` has no reason

- **Data:** `EngineStateEvent` has `state` and `compileDatabases`, and no text for an error.
- **Use in Shotgun:** Shotgun tells the user why stage 2 cannot start.
- **Until the fix:** Shotgun tells the user to read the output channel DataFlow.
- **Possible fix:** Add the text `error` to `EngineStateEvent`, and a property with the same text to the API.

### 28. Files that are not C or C++ files have no facts

- **Data:** The engine reads only C and C++ code. `showReviewPlan` refuses other files with the text "The side view shows only C and C++ files."
- **Use in Shotgun:** A hook can be in a `.ui` file of Qt Designer, in a `.qml` file or in a CMake file. An example is a new button in the graphical user interface (GUI). Such a hook has no check of its place and no heat.
- **Until the fix:** Such a hook has only the words of the model. Shotgun tells this to the user.
- **Possible fix:** Do the fix of item 3. Then such a file can be the place of a step. Facts for these files are not necessary now.

### 29. No tool reads the state of the call graph

- **Data:** Only `scan_call_graph` and `stop_call_graph` give `CallGraphFacts`, with the frame functions of the project. The first tool starts a scan, also after the user stopped the scan. The second tool stops a scan that runs. The event `onDidChangeCallGraph` comes only with a new state.
- **Use in Shotgun:** The survey of stage 2 shows the frame functions, and asks the user if the list is complete. Shotgun must read the list with no effect on the scan.
- **Until the fix:** Shotgun keeps the data of the last event.
- **Possible fix:** Add the read tool `get_call_graph`. It gives `CallGraphFacts`, and it starts no scan.

## Limits that Shotgun gets from DataFlow

These limits are not gaps. Shotgun has them because it uses DataFlow.

- DataFlow has facts only for C and C++ code.
- The VSIX package of DataFlow is only for Windows x64.
- DataFlow comes as a VSIX file. Thus the user must install DataFlow before Shotgun.
- `docs/api.md` tells that an extension calls a view method only on a request of the user. Thus Shotgun calls a view method only after a click of the user.
