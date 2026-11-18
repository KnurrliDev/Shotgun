# DataFlow: gaps for Shotgun, second analysis

- Date: 13 November 2026, changed on 14 November 2026
- First analysis: `dataflow-gaps.md`, with the items 1 to 29
- DataFlow: the branch `master` at the commit `b343592`. Its `package.json` file has the version 0.5.0. The section "Unreleased" of `CHANGELOG.md` has the changes.
- Sources in the repository of DataFlow: `CHANGELOG.md`, `api/dataflow-api.d.ts`, `docs/api.md`, `docs/tools.md`, `docs/api-gaps-strategy.md`, `TODO.md`, `engine/README.md`, `src/api/api.ts`, `src/api/tabs.ts`, `src/extension.ts`, `src/lenses/heat.ts`, `src/mcp/host.ts`, `src/mcp/extensionTools.ts`, `src/review/guide.ts`, `src/review/stack.ts`, `src/review/marks.ts`, `src/webview-side/tab.tsx` and `engine/include/dataflow/callgraph.hpp`
- Change of the design of Shotgun, 13 November 2026: Shotgun has its own view, and it works in the text editor. It puts no item into the side view of DataFlow. The section "The design of Shotgun" gives the effect on the items.

Shotgun is a VS Code extension for pair programming with a language model. It uses DataFlow as a dependency. It gets the application programming interface (API) with `getApi(1, { client: 'Shotgun' })`. The model reads the facts of DataFlow through its Model Context Protocol (MCP) server.

A gap is a method, a parameter, a field, an event or an analysis that Shotgun needs and that DataFlow does not have.

The first analysis found 29 gaps in DataFlow 0.5.0. Then DataFlow got 9 commits with fixes. This document gives the result of the second analysis:

- DataFlow closed 28 of the 29 items.
- Item 11 stays open in part.
- 12 gaps are new: the items 30 to 41.
- Shotgun does not need the items 34 to 40 now.
- Phase 1 of Shotgun found item 42 on 14 November 2026: a fault of the token of the MCP server at the first start.
- Phase 3 of Shotgun found item 43 on 14 November 2026: an extension cannot see the tool calls of an MCP client.
- Phase 6 of Shotgun found item 44 on 14 November 2026: a mark cannot keep a path that is not there.
- Phase 7 of Shotgun found item 45 on 14 November 2026: no fact gives the names in scope at a line.
- Phase 8 of Shotgun found item 46 on 14 November 2026: a race item gives the lines of its accesses only in a text.
- Phase 8 of Shotgun found item 47 on 14 November 2026: the engine stops on a check of a `std::optional` with an error after it.
- Phase 9 of Shotgun found item 48 on 14 November 2026: `getMemberSites` gives an internal error for a line with no type.
- Phase 9 of Shotgun found item 49 on 14 November 2026: the call graph does not see a change on the disk from a different program.

No open gap stops the work on Shotgun.

Status, 14 November 2026: DataFlow 0.6.1 has the fixes of the items 30 to 33 and 41 to 47, with their tests. All tests of DataFlow passed: 247 unit tests, the fixture tests and 66 tests of the engine. Shotgun needs DataFlow 0.6.1 (decision 20 of `implementation-plan.md`), and it uses the new data. The procedures of "Until the fix" are history. Item 11 stays open, because its score needs a calibration on real projects. The items 48 and 49 are open.

The second analysis used the code and the documents of DataFlow. It did not run the new tools, and it did not run the tests.

Each open item has these parts:

- **Data:** the code or the document of DataFlow that shows the gap
- **Use in Shotgun:** the reason why Shotgun needs the fix
- **Until the fix:** the procedure of Shotgun with DataFlow as it is
- **Possible fix:** a change of DataFlow that removes the gap

## Before Shotgun can use the new API

Status, 14 November 2026: done. The VS Code of the user has DataFlow 0.6.0.

1. Make a new VSIX package of DataFlow. Install the package. The installed extension is the release 0.5.0 from before the fixes. Its file `api/dataflow-api.d.ts` does not have the new methods.
2. Give the next release a new version number, for example 0.6.0. `getApi(1)` gives version 1 before and after the fixes. `extensionDependencies` has no minimum version. With a new number, Shotgun reads `packageJSON.version` of DataFlow, and it does not start with an older release.

## Terms of Shotgun

| Term | Description |
| --- | --- |
| Stage | One of the 5 parts of the work: brief, survey, order, plan and build. |
| Gate | A decision of the user that starts or ends a stage of the model. |
| Hook | A place where new code goes into the code that is there, for example a new row in a dialog. |
| Plan | The steps of the work, in the form of a guided review: title, place, text and checks. |
| Risk level | A number from 1 to 5 for each step of the plan. It selects the writer of the step: the model or the user. |
| Receipt | A list of the changes that the model made in a step. The user marks each change. |
| Callout | A note at a line of new code. It tells a fact that the engine found. |

## The design of Shotgun

Shotgun is its own extension. This design is a decision of the user:

- Shotgun has its own view: a page, and a panel beside the text editor.
- Shotgun works in the text editor. The hooks, the holes, the callouts and the marks of the lines of the model are there.
- DataFlow has its own side view. Shotgun puts no item into it. A link of Shotgun opens it at a place, after a click of the user.

Thus Shotgun uses DataFlow for the facts:

- the heat with its signals, `isReachComplete`, `reachUnknown` and the tests
- the facts of a line from `getPlace`, the callers from `getCallers`, and the frame functions from `getCallGraph`
- the member sites from `getMemberSites`
- the marks from `markBase`, and the diff since a mark from `getDiff`
- the events `onDidParse`, `onDidChangeCallGraph` and `onDidChangeEngineState`
- `registerTools`: the model gets the tools of Shotgun through the MCP server of DataFlow

Shotgun does not use these fixes now:

- items 1 to 7: the stack of guides, and the labels and the notes of a step
- items 17 to 19: the layers of a client, the identifiers and the buttons
- item 20: the tab of an extension
- item 22: `allHunks` of a diff walk

These fixes stay useful for DataFlow and for MCP clients. The first analysis asked for them, because its design showed the plan, the receipts and the callouts in the side view of DataFlow.

## The risk level and the heat

Shotgun makes the risk level of a step from the facts of DataFlow. Only the user can change a level, and Shotgun records each change.

The plan page of the design canvas shows the basic rule and 3 more rules:

- the rule for `reachUnknown`
- the rule for a worker thread
- the rule for a new data member

The user accepted these 3 rules on 13 November 2026. The user accepted the other rules of the second table on 14 November 2026, with decision D1 of the plan of Shotgun.

The basic rule: the step gets the band of the hottest function that has a line of the step. `getHeat` with `lines` gives this function.

| Heat band of DataFlow | Risk level | Writer of the step |
| --- | --- | --- |
| No heat: a new file with no caller | 1 | The model |
| cool, 0 to 24 | 2 | The model |
| warm, 25 to 49 | 3 | The model writes a frame, and the user writes each decision |
| hot, 50 to 74 | 4 | The user |
| very hot, 75 to 100 | 5 | The user |

DataFlow gives more facts now, and these rules use them. The first 6 rules make a level only higher. The last 3 rules are for a step with no function.

| Fact of DataFlow | Rule of Shotgun | Status |
| --- | --- | --- |
| `isReachComplete` is false | No level. Shotgun waits for the end of the scan. After a stopped scan or a failed scan, the level is 3 or higher. | Accepted |
| `reachUnknown`: callers that the call graph cannot see | The level is 3 or higher. | Accepted |
| `framePath` with `isPastLimit` | The level is 4 or higher. | Accepted |
| The line of the step is in a main loop | The level is 4 or higher. See item 32. | Accepted |
| `getPlace` gives a worker thread for the line | The level is 1 higher, with a maximum of 5. | Accepted |
| `getPlace` gives a lock for the line | The level is 1 higher, with a maximum of 5. | Accepted |
| The step adds a data member to a type | Level 2. Level 3 if a member of the type has `framePath` or `shared`. See item 11. | Accepted |
| The step changes a data member that is there | The level of the hottest function in `users` of the member. | Accepted |
| The file is not a C or C++ file | Level 2, with the label "no facts". | Accepted |

DataFlow does not change the score of a function with `reachUnknown`. Section 2 of `docs/api-gaps-strategy.md` gives this decision: the client makes its own risk level from the flag. Thus the second rule is necessary.

With these rules, a wrong fact is a wrong permission. A level that is too low lets the model write code that the user must write. Thus the open gaps of the heat come first.

## The items of the first analysis

| Item | Status | Fix in DataFlow | Effect on Shotgun |
| --- | --- | --- | --- |
| 1. A new guide replaces the guide that shows | Closed | A stack of 5 guides. The guide under the top guide shows again after a close. | Not in use now. |
| 2. The facts of a guide do not give its client | Closed | `id` and `owner` in `GuideFacts`. A change of a guide of a different owner needs `force`. | Not in use now. |
| 3. A step needs a C or C++ file that is there | Closed | A step can be in each text file, or in a new file with `newFile`. | Not in use now. |
| 4. A step has no data of the client | Closed | `label` and `data` on a step. `review_step` changes them. | Not in use now. |
| 5. The user cannot write a note for a step | Closed | The field "Your note" in the tab Guide, and `userNote` in `GuideFacts`. | Not in use now. |
| 6. The event of the guide does not give the cause | Closed | `change` and `by` in the event. | Not in use now. |
| 7. A plan has a maximum of 20 steps | Closed | The maximum is 40 steps. | Not in use now. |
| 8. The reasons of the heat are text | Closed | `signals` with `id`, `group`, `points`, `text` and `value`. | The rules read data, not sentences. |
| 9. No flag tells that the reach is complete | Closed | `isReachComplete` for the file and for each function. | The first rule uses it. |
| 10. `get_heat` does not accept lines | Closed | `lines` in `get_heat`. | 1 call for each step. |
| 11. Code outside of a function has no heat | Open in part | `types` in `get_heat`, with the facts of each data member. No score. | See item 11 below. |
| 12. A line has no facts of its own | Closed | The read tool `get_place`. | Each hook shows its loops, its locks and its threads. |
| 13. The callers of the call graph are only a number | Closed | The read tool `get_callers`, and `framePath` in the signals. | The survey shows the paths to a hook. |
| 14. The heat has no data of the tests | Closed | `tests`, and the setting `dataflow.heat.testFolders`. | A step of level 4 or 5 tells if a test reaches the function. |
| 15. A caller that the call graph cannot see makes a function siloed | Closed | `reachUnknown` with 3 causes, and no half points. A connection of Qt is a call. | The second rule. See items 30, 31 and 33. |
| 16. The frame path stops after 8 calls | Closed | A reason with 0 points, `isPastLimit` and a notice. | The third rule. |
| 17. All clients share 1 layer for each file | Closed | 1 layer for each client and each file. | Not in use now. |
| 18. A note has no identifier | Closed | An `id` for each note and each comment, and the view tool `remove`. | Not in use now. |
| 19. An item has no button of a client | Closed | `actions`, and the event `onDidInvokeAction`. Only an extension can add buttons. | Not in use now. |
| 20. An extension cannot add a tab | Closed | `registerTab` with sections, rows, badges, places and buttons. | Not in use now. Shotgun has its own view. |
| 21. `get_diff` has no base in the middle of a task | Closed | `mark_base`, `delete_mark` and the base `mark:<name>`. | A receipt shows the changes of 1 step. |
| 22. A diff walk shows all hunks | Closed | `allHunks` in `show_diff_walk`. | Not in use now. Shotgun makes its receipt from `get_diff`. |
| 23. `start_ripple` has no parameters | Closed | `base` and `paths`. The tool never asks the user. | The ripple of 1 step, but only with the side view. See item 41. |
| 24. A change outside of a function gets no ripple | Closed | The read tool `get_member_sites`. | The other places for a new member are facts of the engine. |
| 25. An extension cannot add tools to the MCP server | Closed | `registerTools`. The MCP name starts with the name of the client. | Shotgun needs no MCP server of its own. See item 40. |
| 26. No event tells the end of a parse | Closed | The event `onDidParse`. | Shotgun asks for new facts after the event. |
| 27. The engine state `failed` has no reason | Closed | `engineError`, and `error` in the event. | Shotgun shows the reason. |
| 28. Files that are not C or C++ files have no facts | Closed | The fix of item 3, and `allFiles` in `get_diff`. | A receipt has the changes of these files too. |
| 29. No tool reads the state of the call graph | Closed | The read tool `get_call_graph`. | The survey reads the frame functions. |

DataFlow compared the first list with its code. Section 12 of `docs/api-gaps-strategy.md` gives 6 corrections, for the items 3, 10, 13, 15, 25, 26 and 28. The second analysis agrees with each correction.

## Order of the work

Do the groups in this sequence. Do not do the items 34 to 40 for Shotgun.

| Group | Items | Reason |
| --- | --- | --- |
| 1 | 42 | A new user gets no tools of DataFlow and no guard of Shotgun in Claude Code. |
| 2 | 30, 31, 32 | The heat can be too low. Then the model gets a wrong permission. |
| 3 | 11, 33, 41, 43, 44, 45, 46 | Shotgun has a procedure, but it needs more code or it gives less accuracy. |

Status, 14 November 2026: the groups 1, 2 and 3 are done, except item 11. Item 47 came after this list, and it is done too.

## Heat

### 11. A type and a data member have no score

- **Data:** `get_heat` gives `types` with the facts of each data member: `readers`, `writers`, `files`, `users`, `framePath` and `shared`. `docs/tools.md` tells: "A type and a data member have no score yet." Section 9.3 of `docs/api-gaps-strategy.md` tells that the score needs a calibration first.
- **Use in Shotgun:** Many steps add a member to a type, or change a member. Such a step gets no band.
- **Until the fix:** Shotgun uses the 2 rules for a data member. These rules are coarse.
- **Possible fix:** After the calibration, add `score` and `band` to each type and each data member.
- **Status, 14 November 2026:** open. The score of a member is a new model of the heat. Section 9.3 of `docs/api-gaps-strategy.md` needs its calibration on the fixture projects and on real projects first. This is a decision of the user.

### 30. A call in a lambda that runs later counts for the function around the lambda

- **Data:** The comment at the top of `engine/include/dataflow/callgraph.hpp` tells: "a call in a lambda belongs to the function around it". `engine/README.md` tells the same for a lambda as the slot of `connect`. `TODO.md` has this item in its section Heat. An example is `connect(timer, &QTimer::timeout, this, [this] { tick(); })`. The call graph gives `tick` only 1 caller: the function with the call of `connect`. Thus `tick` gets no `reachUnknown`, and DataFlow can set it to siloed.
- **Use in Shotgun:** A function that a timer or a callback runs can get a cool band. Then the model writes its code. A lambda as a slot is the usual form in new Qt code.
- **Until the fix:** For each function of a step, Shotgun calls `getCallers` with the depth 1. Then it calls `getPlace` for each line in `callLines`. If `around` has a lambda with `isSynchronous: false`, Shotgun uses the rule for `reachUnknown`.
- **Possible fix:** Find each function that a lambda calls, if the lambda is not synchronous. Give it `reachUnknown` with the new cause `callback`. For a lambda as the slot of `connect`, add the edge from the signal.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1. A function that a lambda calls gets the cause `callback` if the lambda can run later. A lambda of a standard algorithm, a lambda that the code calls at once, and a local lambda that the function only calls give no cause. A lambda as the slot of `connect` connects the signal to each function that it calls. Limit: a lambda that a function of the project or of a library runs at once still gives `callback`, for example a visitor. In the fixture `battery`, `solve_power_plan` now has the cause `callback`, through the lambda of `tf::Executor::async`.

### 31. A function that the reflection of a framework can call has no flag

- **Data:** `merge_graph` in `engine/include/dataflow/callgraph.hpp` gives `reachUnknown` for 3 causes: `libraryOverride`, `address` and `slot`. The cause `slot` needs a `slots` section or a connection. The names `UFUNCTION` and `Q_INVOKABLE` are only in `engine/include/dataflow/outline.hpp`. Thus these functions get no flag:
  - a `UFUNCTION` of Unreal Engine that a Blueprint, a remote procedure call or the console calls
  - a `Q_INVOKABLE` function, and the functions of a `Q_PROPERTY`, that QML calls
- **Use in Shotgun:** With no caller in the C++ code, DataFlow sets such a function to siloed, and it gets a cool band. In an Unreal Engine project, this is the usual case for the functions of a Blueprint.
- **Until the fix:** Shotgun calls `getOutline` for the class of each function of a step. If the function has an annotation of this kind, Shotgun uses the rule for `reachUnknown`.
- **Possible fix:** Add the cause `reflection` to `reachUnknown`. Use it for a function with such an annotation and with no caller in the graph.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1. A function with no caller gets the cause `reflection` for `UFUNCTION`, `Q_INVOKABLE`, `Q_SCRIPTABLE`, `Q_SLOT`, and for a function that a `Q_PROPERTY` names. `via` gives the macro, for example `UFUNCTION(BlueprintCallable)`.

### 32. A line in the main loop is not on a frame path

- **Data:** `merge_graph` makes a frame function of each function that a main loop calls. The reason is the text "called in the main loop of" and a name. The function with the main loop gets no frame path, and with no callers DataFlow sets it to siloed. `get_place` gives `isOpenLoop` for each loop with no fixed number of iterations, also for a loop that reads a file. No field tells that a loop is a main loop.
- **Use in Shotgun:** A hook in the body of the main loop runs in each frame. The band of its function is cool, thus the model gets the step.
- **Data:** The fixture `battery` of DataFlow has the main loop `for (int cycle = 0; cycle < 100; ++cycle)` in `main()`. DataFlow calls it the main loop, but `get_place` gives `isOpenLoop` false for it, because it has a fixed number of iterations. Thus the procedure below does not find a line in this loop. Phase 5 of Shotgun found this on 14 November 2026.
- **Until the fix:** Shotgun reads the reasons of the frame functions from `getCallGraph`. It takes the name after "called in the main loop of". A line in an open loop of that function gets the level 4 or higher. This procedure reads a text.
- **Possible fix:** Add `isMainLoop` to a loop in `around` of `get_place`. Add `mainLoops` with the function, the file and the line to `get_call_graph`.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1, as the possible fix tells. `isMainLoop` comes only with a complete call graph. Shotgun uses the 2 fields. The definition of a main loop did not change, so the fixture `battery` still has no main loop. Also, an open loop in `main` that calls no function of the project is no main loop. A different definition is a decision of the user.

### 33. The public functions of a library have callers out of the project

- **Data:** The call graph has only the functions in the project folders. `buildHeat` in `src/lenses/heat.ts` sets a function to siloed if its reach is less than 10 and it has no `reachUnknown`. The users of the public functions of a library are in other projects. In the project, only the tests call these functions.
- **Use in Shotgun:** In a library project, a public function with few tests gets a cool band. A change of its behavior can break each user of the library.
- **Until the fix:** The user sets a higher level for such a step.
- **Possible fix:** Add a setting for the folders of the public headers, for example `dataflow.heat.publicFolders`. A function with its declaration there gets `reachUnknown` with the cause `public`.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1 with the setting `dataflow.heat.publicFolders`. The cause `public` comes only for a function with no other cause, and not for a private member function.

### 49. The call graph does not see a change on the disk from a different program

- **Data:** `onDidSaveTextDocument` in `src/extension.ts` sets `isGraphOld` after VS Code saves a C or C++ file. A change on the disk from a different program, for example the tool Edit of Claude Code, sets nothing. Then no scan starts.
- **Data:** a question after such a change gets the facts of the old index, with `isReachComplete` true. A probe of phase 9 of Shotgun wrote a new data member, and a write of it in `process()`, on the disk. `getMemberSites` gave the new member, but `process()` had no use of it. After `scan_call_graph`, `process()` had the use. The scan parsed the 2 changed files in 839 ms.
- **Data:** after a save of VS Code too, the first question gets the old index, because `requestCallGraph` starts the scan only after the answer.
- **Data:** the test of phase 9 of Shotgun found the fault on 14 November 2026. At the gate of step 2, Shotgun gave the false loose end "process does not use planning_cycles". Claude added `planning_cycles = 0` to `process()` in step 2.
- **Use in Shotgun:** the loose ends of the new members need the uses that the changes of the step add. Claude Code writes its changes on the disk.
- **Until the fix:** at the gate of each step, Shotgun calls `scanCallGraph`, and waits for the state `ready` of `getCallGraph` for a maximum of 30 seconds. If the scan does not end in time, Shotgun gives no loose ends of the new members.
- **Possible fix:** watch the C and C++ files of the project with a `FileSystemWatcher`, and set `isGraphOld` for a change on the disk. While the index is old, give `isReachComplete` false or a note. Or let a question about the call graph wait for the scan of the changed files.

## API

### 34 to 39. Items that Shotgun does not need now

These items came from the design that showed the work of Shotgun in the side view of DataFlow. With its own view, Shotgun does not need them. The numbers stay, so no number of this list changes.

| Item | Gap |
| --- | --- |
| 34 | An extension cannot show its tab. |
| 35 | A guide has no buttons of its own. |
| 36 | The event of a click on a step does not give its guide. |
| 37 | The event of a close does not give the guide that closed. |
| 38 | A plan that replaces a guide removes the marks and the notes of the user. |
| 39 | No tool gives the notes of a client with their lines. |

The items 36 and 37 are differences between the code and `docs/api-gaps-strategy.md`. Section 7.3 of that document gives the field `guide` for the event of a click, and `ActionEvent` does not have it. The close of the last guide gives `null`, with no `by`.

### 40. An extension cannot add prompts to the MCP server

- **Status:** not necessary now. The plugin of Shotgun for Claude Code has a skill for each stage, and a request in words loads the skill. See `implementation-plan.md`.
- **Data:** `registerTools` adds tools. The MCP server has 3 prompts of DataFlow: `explain-function`, `guided-review` and `diff-walk`. No method adds a prompt.
- **Use in Shotgun:** A prompt for each stage of the model starts the stage from Claude Code with 1 command, for example the survey.
- **Until the fix:** The plugin of Shotgun for Claude Code has these commands. Shotgun needs this plugin for its guard.
- **Possible fix:** Add `registerPrompts` to the API, with the same rule for the names as `registerTools`.

### 41. No read tool gives the ripple of a base

- **Data:** `start_ripple` is a view tool. `runReview` in `src/extension.ts` opens the side view, and shows the story of the review there. `get_ripple` gives only the last review of the side view. It has no parameters.
- **Use in Shotgun:** Shotgun shows the loose ends of a step in its own view. For them, it needs the code that the changes since a mark reach. It must not change the side view of DataFlow, and it must not replace a review of the user.
- **Until the fix:** Shotgun calls `startRipple` only after a click of the user. Then DataFlow opens its side view with the review.
- **Possible fix:** Add `base` and `paths` to `get_ripple`. With them, the tool makes a review, and it does not change the side view.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1. `get_ripple` and `getRipple({ base, paths })` make a new review. The side view and the review of the user do not change. Shotgun uses it for the loose ends of phase 9.

### 48. `getMemberSites` gives an internal error for a line with no type

- **Data:** `getOutline` and `getMemberSites` find a type by a line with its name. `typeNameColumns` in `src/side/outline.ts` gives the columns of all names of the line, and the engine tries each column.
- **Data:** for the line of a data member, for example `int cycle_limit = 8;`, `getOutline` gives the clear error "No class, struct, union or enum on line 115 of types.hpp.". `getMemberSites` gives the error "Cannot read properties of undefined (reading 'state')". The text of this error agrees with `res.callGraph.state` in `memberSites` of `src/extension.ts`, if the result of the engine for a name that is not a type has no `callGraph`.
- **Data:** the line of a data member with a class type, for example `OperationalSettings operational_settings;`, gives the type of the member, not the type around the line.
- **Data:** a probe of phase 9 of Shotgun found the error on 14 November 2026, with the MCP tools `get_outline` and `get_member_sites` on the project of the test of Shotgun.
- **Use in Shotgun:** at the gate of each step, Shotgun gets the loose ends of the new data members and of the new enumerators. It knows the added lines of the step, but not the line of the head of their type.
- **Until the fix:** Shotgun finds the head of the type around the added lines with a scan of the text: the scan goes up from a line and counts the braces. Then Shotgun gives the line of the head to `getOutline` and to `getMemberSites`.
- **Possible fix:** in `memberSites` of `src/extension.ts`, read `res.callGraph?.state`, and request the scan of the call graph only with a state. Then `get_member_sites` gives the error of `src/mcp/host.ts` for a line with no type. Also let the 2 methods find the innermost class, struct, union or enum around a line, for example with a new field `around`. Add the line of a data member to the tests of the 2 tools in `src/test/fixtures/mcp.test.ts`.

## MCP server

### 42. The server and the token file can have different tokens at the first start

- **Data:** `getToken` in `src/mcp/manager.ts` keeps the token in `this.token` only after `await this.context.secrets.get`. At the start of DataFlow, 2 calls can run at the same time: `startNow` for the server, and `definition` for `provideMcpServerDefinitions` of VS Code.
- **Data:** If the secret storage has no token yet, each call makes a different random token. The server keeps the token of its call. `this.token` and the token file can get the token of the other call.
- **Data:** Then the bridge gets the answer 401 "The token is missing or wrong", and Claude Code shows the server `plugin:dataflow:dataflow` as failed.
- **Test:** `scripts/test-claude.mjs` of Shotgun uses a test build of VS Code with a new profile and `dataflow.mcp.enabled` true. 3 runs on 14 November 2026 gave the 401. After "DataFlow: Stop MCP Server" and "DataFlow: Start MCP Server", the bridge worked. The new server takes the token of `this.token`.
- **Use in Shotgun:** The tools and the hooks of Shotgun are in the MCP server of DataFlow. After the first connection, a new user can have no tools of DataFlow and no guard of Shotgun in Claude Code.
- **Until the fix:** The test of Shotgun starts the MCP server again after a 401. A user can run "DataFlow: Stop MCP Server" and "DataFlow: Start MCP Server", or reload the window.
- **Possible fix:** Keep the promise of the first call, for example `this.tokenPromise ??= this.readToken()`. Then all calls get the same token. Add a unit test with 2 calls at the same time.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1, as the possible fix tells, with the function `tokenSource` and its unit test. In the test of phase 8 of Shotgun, the restart of the server after the 401 let a letter go into the open `brief.md`.

### 43. An extension cannot see the tool calls of an MCP client

- **Data:** The API has no event for the call of a tool of the MCP server. An extension gets only the calls of its own tools from `registerTools`.
- **Data:** In the test of phase 3 of Shotgun, Claude gave 7 facts, each with a read tool of DataFlow. Claude called none of these tools. It read the code with the tool Read of Claude Code.
- **Use in Shotgun:** Decision 13 of the plan of Shotgun: a fact of Claude shows the read tool of DataFlow that gave the fact. Shotgun must refuse a fact with a tool that Claude did not call.
- **Until the fix:** The skill `shotgun-survey` tells Claude to give a fact only from a call of a read tool. Shotgun cannot check this. The badge "Model" shows that the fact is a text of Claude. A hook of the plugin of Shotgun after each tool call can record the calls, but only in Claude Code with this plugin.
- **Possible fix:** Add the event `onDidCallTool` to the API. The event gives the client, the tool, the arguments and the time of each call of a read tool. Or add a method that gives the tool calls since a time.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1. The event comes for each tool, also for the view tools and the tools of extensions, with `isReadOnly`, `isError` and `error`. A view tool can also show a fact, for example `show_flow`. Shotgun refuses a fact of the survey with a tool that Claude did not call in the stage. Limit: the server keeps no sessions, so with 2 clients at the same time, the name of the client can be wrong.

### 45. No fact gives the names in scope at a line

- **Data:** `get_place` gives the function, the statements around the line, the locks and the threads. It gives no local variable, no parameter and no data member that the code at the line can use.
- **Use in Shotgun:** The design canvas shows the names in scope for each hole of a frame, with their types and the badge "Engine", for example `home_battery_ctl.planning_cycles : int`. The user then sees the facts for the decision.
- **Until the fix:** The hole shows the function, the threads and the locks at its line. The pointer hint of Claude names the places of the facts.
- **Possible fix:** Add `inScope` to `get_place`. It gives the parameters, the local variables before the line, and the data members of the class, with their types.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1. `inScope` gives a maximum of 60 names, each with its type and its kind, and `isInScopeCapped` tells that more names are in scope. A lambda sees only its captures and its parameters. Each hole of a frame of Shotgun shows the first 12 names.

### 46. A race item gives the lines of its accesses only in a text

- **Data:** each item of `get_threads` gives `caller` and `worker` as a text, for example "reads 94, 101 · writes 129". A line of a different file has the name of the file, for example "worker.cpp:12". The item has no field with the lines, the roles and the threads of its accesses.
- **Use in Shotgun:** A callout needs the lines of a race. A race with an access on a line of the user is a callout on that line.
- **Until the fix:** Shotgun reads the numbers of the lines from the 2 texts. A line with a file name is not a line of the file. A new form of the text can stop this procedure.
- **Possible fix:** Add `accesses` to each item. Each access gives its file, its line, its role (read or write), its thread (caller or worker) and its locks.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1. Each access gives its line, its role, `isWrite`, its thread and its locks, and its file only for a different file. `pair` tells that the access can run at the same time as an access of a different thread. Shotgun puts a callout of a race only on the lines with a pair. An item of the kind `capture` has no accesses.

## Engine

### 47. The engine stops on a check of a `std::optional` with an error after it

- **Data:** the analysis of the unchecked optional accesses stops the engine with the exit code 3221225477 (0xC0000005, an access violation). The requests `dataflow/optionalAccess` and `dataflow/calls` use this analysis. `add_optional_findings` of `dataflow/flow` also uses it. This is the smallest text that stops the engine 0.6.0:

  ```cpp
  #include <optional>
  void process(std::optional<int> &future, int n) {
    const bool limit = future && n >= missing;
  }
  ```

- **Data:** in the tests, the engine stopped only with a `std::optional` on the left side of `&&` and an error in a comparison on the right side. `future && missing` did not stop it. `c.n > 0 && c.n >= settings.cycle_limit` did not stop it. Without the error, all requests worked.
- **Data:** the test of phase 8 of Shotgun found the fault on 14 November 2026. The frame of Claude used a setting that the test did not add: `future && home_battery_ctl.waited_cycles >= settings.cycle_limit`. DataFlow started the engine again 3 times, and each start stopped on the same text. Then the engine stayed stopped.
- **Use in Shotgun:** the callouts and the facts of each stage need the engine. The code of the user often has an error while the user types.
- **Until the fix:** the panel of Shotgun shows "the engine failed". The user removes the error, and runs **DataFlow: Restart Engine**.
- **Possible fix:** do not run `diagnoseFunction` with `UncheckedOptionalAccessModel` on a function with an error, for example an expression in its body with `containsErrors()`. The 3 calls are in `analysis.hpp`, `calls.hpp` and `flow.hpp`. Add the text above as a test of the engine.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1, with a test of the engine.

### 50. A worker has no race with a second run of itself

- **Data:** `get_threads` gives 1 run of each worker thread, with its handle and its joins. In the fixture `battery`, the worker `solve_power_plan()` starts through `tf::Executor::async` on line 96. Its handle is `home_battery_ctl.charging_future`, and its join is "get on line 109". Each item gives pairs of an access of the caller and an access of the worker.
- **Data:** the test of phase 13 of Shotgun found a race on 17 November 2026 that `get_threads` does not give. The change of the task resets the handle at the cycle limit with no join. The next cycle then starts a second run of the worker while the first run still runs. The 2 runs write the same `Optimizer` on the lines 65 and 74 with no lock.
- **Use in Shotgun:** the finders of races in the review start from the facts of `get_threads` (P20). A race of 2 runs of a worker gets only the badge "Model". A change that drops a handle with no join is a usual fault.
- **Until the fix:** the skill `shotgun-review` tells the finders to judge the accesses of 2 runs of a worker against each other. They do this if the change can start a second run before the first run ends. Such a race has the source `model`.
- **Possible fix:** find each reset, move or new value of a handle with no join before it, on a path that can start the worker again. Then give the pairs of the accesses of the worker with themselves, for example with a new value of `pair`.

## Marks

### 44. A mark cannot keep a path that is not there

- **Data:** `create` in `src/review/marks.ts` gives the error "These paths are not there" for a path that is not there, and no mark changes. `markDiff` finds the new files only under the paths of the mark.
- **Use in Shotgun:** A step can make a new file, for example a test. The base of the step needs the path of the new file. Then `getDiff` with the mark gives the new file with its functions and its heat.
- **Until the fix:** Shotgun makes the mark only with the files of the scope that are there. At the receipt, Shotgun reads each new file of the scope itself. All its lines are added lines, with no functions and no heat. A mark of the folder of the new file is not a good procedure, because the folder can have more than 500 files.
- **Possible fix:** Let `markBase` keep a file path that is not there as a file with no text. Then `getDiff` gives the file as a new file when it is there.
- **Status, 14 November 2026:** fixed in DataFlow 0.6.1, as the possible fix tells. `notFound` gives the paths that are not there, so a wrong path does not stay hidden. Shotgun marks each file of the scope.

## Limits that Shotgun gets from DataFlow

These limits are not gaps. Shotgun has them because it uses DataFlow.

- DataFlow has facts only for C and C++ code. A different text file has a diff, but it has no facts.
- The VSIX package of DataFlow is only for Windows x64.
- DataFlow comes as a VSIX file. Thus the user must install DataFlow before Shotgun.
- A view method changes the side view of DataFlow. Shotgun calls a view method only for a link that the user clicks.
- `markBase` and `scanCallGraph` are view methods, but they do not change the side view.
- A mark has a maximum of 500 files and 20 MB, and a client has a maximum of 20 marks. The model cannot use a mark of Shotgun through the MCP server.
- The MCP server keeps only the name of the MCP client that connected last.
