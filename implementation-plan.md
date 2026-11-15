# Shotgun: implementation plan

- Date: 13 November 2026, changed on 14 November 2026
- Status: the phases 0 to 9 are done. Section 8 gives the status of each phase.
- Sources:
  - the design canvas: https://claude.ai/artifact/Sxm9DJ8WPE6LAFqW8PVD6z
  - `dataflow-gaps.md` and `dataflow-gaps-2.md` in this folder
  - `docs/api.md`, `docs/tools.md` and `src/mcp/claude.ts` in the repository of DataFlow
  - the documentation of Claude Code on 13 November 2026: hooks, plugins, MCP, the extension for VS Code, and legal and compliance

Shotgun is a VS Code extension for pair programming with Claude. The work of a task goes through 5 stages, and each stage of Claude starts and ends at a gate of the user. A risk level for each step selects the writer of the step. The user writes the hot code, and Claude writes the cool code with a receipt. The goal is code that the user owns and understands.

This document gives the architecture, the phases of the work and the decisions. Section 2 gives the decisions of the user. Section 3 gives the proposals of this plan, which the user can change before a phase starts. Section 4 gives the open decisions.

## 1. Scope

Version 1 has these parts:

- the 5 stages: brief, survey, order, plan and build
- the pages of Shotgun for the survey, the order, the plan and the ledger
- a panel beside the text editor for the brief and the build
- items in the text editor: hooks, steps, holes, callouts and the lines of Claude
- the risk levels from the facts of DataFlow
- the guard, the errands of Claude with receipts, the frames with holes and hints, the callouts, and the questions on a line
- the ledger, and a check of the commit message on a request of the user

These items are not in the scope of version 1:

- A commit. The user makes each commit.
- A chat in Shotgun. The user talks to Claude in Claude Code.
- A request of Shotgun to a model. Claude Code makes all requests, with the login of the user. Thus Shotgun needs no API key.
- Facts for code that is not C or C++ code, and platforms other than Windows x64. Shotgun gets these limits from DataFlow.
- Change Ripple with no change of the side view of DataFlow. See item 41 of `dataflow-gaps-2.md`.

## 2. Decisions of the user

1. A task has 5 stages: brief, survey, order, plan and build. The user writes the brief and the order, and Claude writes the survey and the plan.
2. A hook is a place where new code goes into the code that is there, for example a new button in the GUI.
3. In stage 3, the user puts the tasks in sequence. The user can also rewrite a task and add a task.
4. The plan has the form of a guided review of DataFlow: a title, a place, a text and checks for each step.
5. Shotgun is its own extension. It has its own view, and it works in the text editor. DataFlow keeps its own side view, and Shotgun puts no item into it.
6. The survey, the order, the plan and the ledger are full pages of Shotgun. The brief and the build use a panel beside the text editor.
7. Shotgun uses DataFlow as a dependency for facts.
8. The risk level comes from the heat band of DataFlow: a new file 1, cool 2, warm 3, hot 4 and very hot 5. 3 more rules apply:
   - Callers that the call graph cannot see (`reachUnknown`) give level 3 or higher.
   - A worker thread at the line gives 1 level more.
   - A new data member of a type on a frame path gives level 3.
9. Only the user can change a risk level. Shotgun records each change.
10. Shotgun uses the Claude Code extension of VS Code as DataFlow does. The user tells Claude what to do. A button of Shotgun records a decision of the user, and it does not start an action of Claude.
11. The user can give the brief in a file, or directly to Claude in the chat of Claude Code.
12. For a brief from the chat, Claude can add only the headings of the 5 parts and list marks. The context hook gives each prompt of the user to Shotgun. Shotgun keeps the last prompts only in memory, and `submit_brief` refuses each line that is not in the words of the user.

13. In the survey, a fact that Claude writes gets the badge "Model", with the DataFlow tool that Claude names and the place as a link. The facts that Shotgun gets from DataFlow for each hook (the function, the threads, the locks, the frame path and the heat) get the badge "Engine".
14. The risk rules of D1: before the end of the scan of the call graph, a step gets no level. After a stopped scan or a failed scan, the level is 3 or higher. A frame path past the limit, or a line in the main loop, gives level 4 or higher. A lock at the line gives 1 level more. A change of a data member gets the level of the hottest function that uses it. A file that is not C or C++ gets level 2, with the label "no facts".
15. Until the frames of phase 7, the user writes a step of risk level 3, as a step of level 4. Claude never writes a step of level 3 with no frame.
16. A frame at level 4: the panel of a level-4 step has the button "I want a frame". The ledger records this decision. Then the user tells Claude "Give me a frame for step N." Shotgun opens a frame at level 4 only after the button.
17. In stage 5, the user can change the level of each step that Claude did not start, also the current step of the user. The ledger records each change, and a new writer applies at once.
18. The frame lines of Claude get no receipt. They get the tag "Claude · frame" in the text editor, and the user reads them while the user fills the holes. The gate "The step is done" needs each hole filled.
19. D2: the default voice of the callouts is normal: problems and warnings. A pause is 2 seconds with no edit in the files of the step.
20. Shotgun needs DataFlow 0.6.1 or a later version. DataFlow 0.6.1 has the fixes of the second gap list, also `getRipple` with a base. Shotgun has no procedures for older versions.
21. A loose end that the user hands to Claude becomes the next step of the plan, with risk level 2: after the step that is open, or before the next step that nobody started.
22. The brief cannot stop the next stage. Each part of the brief is optional, and each question of Claude about the brief is optional. The gate "The brief is ready" never waits. The template tells that each part is optional, and its hints are descriptions, not orders.
23. Shotgun has a sidebar in the activity bar, as DataFlow has: the tasks of the project, the page, the brief, the ledger, the guard, the panel, a project folder to open, the recent projects, the connection to Claude Code and the log.
24. The user can return the active task to each earlier stage at any time, also a done task. The work of the later stages stays, and the user passes the gates again. Claude does a stage again only when the user asks. A new survey starts a new order, and a new plan keeps the state of each step of the build with the same id and the same title.
25. A return from the build closes an open step: the step goes back to todo, its changes stay in the files, and its base goes away. A step with a receipt or with holes keeps its state.
26. A click on a hook, on a place of a step or on a change shows the place in the side view of DataFlow, with its lines highlighted and a short note. A small button beside it opens the text editor. This changes decision 5: after a click of the user, Shotgun puts 1 note into the side view of DataFlow, in 1 file at a time.

The user gave decision 10 on 13 November 2026, the decisions 11 to 23 on 14 November 2026, and the decisions 24 to 26 on 15 November 2026. Decision 10 changes the buttons of the canvas that started Claude. Section 12 lists these changes.

## 3. Proposals of this plan

The user can change each proposal before the phase that needs it starts.

| Number | Proposal | Phase |
| --- | --- | --- |
| P1 | The tools of Shotgun go into the MCP server of DataFlow with `registerTools`. Thus Claude Code has 1 connection for DataFlow and for Shotgun. | 1 |
| P2 | Shotgun has a plugin for Claude Code. Shotgun connects it as DataFlow connects its plugin: a marketplace in a local folder, and 2 settings of Claude Code. | 1 |
| P3 | The plugin has a skill for each stage of Claude. A request in words loads the skill, so Shotgun needs no MCP prompts. | 1 |
| P4 | The guard is a hook of type `mcp_tool`. Before each file change, Claude Code calls the tool `shotgun_guard`, and Shotgun decides with its own state. | 1 |
| P5 | The stage files are in `.shotgun/<task>/` in the first folder of the workspace. The user decides if git keeps them. | 1 |
| P6 | The build and the tests are the same as in DataFlow: TypeScript, esbuild, Preact for the webviews, and `@vscode/test-cli`. The publisher is `KnurrliDev`, and the license is MIT. | 1 |
| P7 | Claude gives its results to Shotgun only through the submit tools. Each submit tool checks the data, and gives all problems in 1 list. | 2 |
| P8 | Claude starts each errand and each frame with `shotgun_start_step`. Shotgun then makes the base of the step and opens its scope for the guard. | 6 |
| P9 | The hints of a hole come with the frame. A click shows the next hint, so no request to Claude is necessary. | 7 |
| P10 | A callout shows the facts of the engine at a pause. The sentence of Claude comes only when the user asks Claude for it. | 8 |
| P11 | The commit message comes from the input box of the Source Control view. Shotgun reads it with the API of the Git extension of VS Code. | 9 |
| P12 | The command **Shotgun: Pause** stops the guard for work outside of the task. Shotgun records each pause in the ledger. | 1 |
| P13 | Claude gives a brief from the chat to Shotgun unchanged, with `submit_brief`. Claude adds no fact and fills no part that is not there. It asks the user. | 2 |
| P14 | The context of Claude comes with each prompt. A UserPromptSubmit hook of type `mcp_tool` calls `shotgun_session_context`. Claude Code does not run this type of hook at SessionStart (S4). | 1 |
| P15 | The plugin of Shotgun is on only in the projects of Shotgun. The marketplace goes into the user settings of Claude Code. The plugin goes on in `.claude/settings.local.json` of the workspace folder. | 1 |

## 4. Open decisions

| Number | Decision | Phase |
| --- | --- | --- |
| D1 | Decided on 14 November 2026: the user accepted the 5 rules. Decision 14 gives them. | Before phase 5 |
| D2 | Decided on 14 November 2026: the voice normal, and a pause of 2 seconds. Decision 19 gives them. | Before phase 8 |
| D3 | Decided on 15 November 2026: a public release, as for DataFlow. The VSIX package goes to the GitHub page of the releases, not to the Marketplace, because DataFlow is not in the Marketplace. The documents are as in DataFlow: a short README, `docs/install.md`, `docs/usage.md`, `docs/tools.md` and `docs/development.md`. | Before phase 10 |

## 5. Terms

| Term | Description |
| --- | --- |
| Task | 1 work item of the user, from the brief to the commit message. An example is "a cycle limit for the solver". |
| Stage | One of the 5 parts of a task. |
| Gate | A decision of the user that ends a stage or a step. Shotgun records each gate in the ledger. |
| Hook | A place where new code goes into the code that is there. |
| Step | A part of the plan with a title, places, a text, checks and a risk level. |
| Writer | The user or Claude. The risk level of a step selects the writer. |
| Scope | The files that Claude can change in an open step. |
| Base | A copy of the text of the files of a scope at the start of a step. `markBase` of DataFlow makes it, and `getDiff` gives the changes since the base. |
| Errand | A step that Claude writes, at risk level 1 or 2. |
| Frame | The lines of a step that Claude writes around the decisions of the user. Claude writes a frame at risk level 3, or at level 4 on a request of the user. |
| Hole | A place in a frame for 1 decision of the user. |
| Hint | Help for a hole. The 4 hints of a hole give more help each time: nudge, pointer, example and answer. |
| Receipt | The list of the changes of Claude in a step. |
| Mark | OK, issue or question. The user puts a mark on each change of a receipt. |
| Callout | A fact of the engine on a line that the user wrote. |
| Loose end | A place that a change of a step can also need, for example a load function for a new data member. |
| Ledger | The record of the decisions of the user and of the writer of each line. |

## 6. Architecture

### 6.1 Parts

| Part | Function |
| --- | --- |
| The extension of Shotgun | It keeps the tasks, the stages and the gates. It runs the rules, gets the facts from DataFlow, and gives the tools to Claude. |
| The page | A webview in a tab of the editor area. It shows the survey, the order, the plan and the ledger. |
| The panel | A webview view beside the text editor. It shows the brief and the build: the current step, its holes, hints, callouts, receipt and loose ends. |
| The text editor | Shotgun shows the hooks, the steps, the holes, the callouts and the lines of Claude there. |
| The tools of Shotgun | MCP tools in the server of DataFlow. Claude reads the task and gives its results through them. |
| The plugin of Shotgun | A plugin of Claude Code with the skills and the hooks of Shotgun. |
| DataFlow | It gives the facts of the engine, the heat, the bases and the diffs. |
| Claude Code | The user talks to Claude there: in the panel of the extension for VS Code, in a terminal, or in the desktop app. |

The plugin of DataFlow is on in the user settings of Claude Code. The plugin of Shotgun is on in the local settings of each project with a Shotgun task (P15). Thus each client of Claude Code gets the tools, the skills and the guard in these projects.

### 6.2 A stage of Claude

The survey is an example:

1. The user gives the brief in `brief.md` or in the chat of Claude Code. Then the user clicks **The brief is ready**. Shotgun records the gate, and starts the scan of the call graph.
2. The panel shows the next request, for example "Survey my brief". The user types the request in Claude Code.
3. Claude Code loads the skill `shotgun-survey`. Claude calls `shotgun_get_session` and reads the code with the tools of DataFlow.
4. Claude calls `shotgun_submit_survey`. Shotgun checks each hook with the facts of DataFlow, and gives each problem back to Claude.
5. Claude corrects the problems, and calls the tool again.
6. Shotgun writes `survey.json`, shows the survey page, and shows the hooks in the text editor.

The other stages of Claude run in the same way: the user asks, Claude reads, and Claude submits. A stage of the user changes only the state of Shotgun.

### 6.3 Stage files

| File | Source | Content |
| --- | --- | --- |
| `.shotgun/active.json` | Shotgun | The active task, and the pause of the guard. A workspace has 1 active task. |
| `task.json` | Shotgun | The id, the title and the start time of the task, its stage, and its gates with their times. |
| `brief.md` | User | The goal, the facts, the specs, the limits and the condition of done. |
| `questions.json` | Claude | The questions of Claude about the brief. |
| `survey.json` | Claude | The facts, the tasks, the hooks and the questions of the survey. |
| `engine.json` | Shotgun | The facts of DataFlow for each hook of the survey: the function, the threads, the locks and the heat. |
| `answers.json` | User | The answers of the user to the questions of the survey. |
| `order.json` | User | The tasks in sequence, with the new texts, the new tasks and the tasks for later. Each changed task keeps the last survey of Claude for its text. |
| `plan.json` | Claude | The steps of the plan: the task, the hooks, the places, the text and the checks of each step. |
| `risk.json` | Shotgun | The facts of DataFlow and the level of the rules for each step. |
| `levels.json` | User | The levels and the notes of the user for the steps. A level stays with the id of its step. |
| `build.json` | Shotgun | The state of each step, its scope and its base. The receipt of an errand, with the notes and the loose ends of Claude and the marks and the notes of the user. The holes of a frame with their hints, and the hints that the user opened. |
| `lines.json` | Shotgun | The writer of each changed line, with a hash of each line of the file. |
| `callouts.json` | Shotgun | The keys of the facts of DataFlow at the start of each step of the user. The callouts with the reasons of the user and the words of Claude. The answers of Claude on lines. |
| `loose.json` | Shotgun | The loose ends of the steps, the steps that Shotgun checked, the reasons of the user, and the steps of Claude for the loose ends. |
| `message.json` | Claude | The last check of Claude of the commit message: the message, its points and a note. |
| `decisions.jsonl` | Shotgun | The ledger: 1 line for each decision of the user and for each deny of the guard. |

Each JSON file has a `version` field. Shotgun writes each file in 1 step, as `writeTextAtomic` of DataFlow does.

### 6.4 Tools of Shotgun

The MCP name of each tool starts with `shotgun_`. In Claude Code, the full name is `mcp__plugin_dataflow_dataflow__shotgun_<name>`. In Claude Code, each MCP tool is a deferred tool: Claude loads it with `ToolSearch` before its first call (S3). Thus each skill gives the full names of its tools.

| Tool | Kind | Stage | Function |
| --- | --- | --- | --- |
| `get_session` | read | all | The active task, the stage, the gates of the user, and the next work of Claude. |
| `get_order` | read | 3, 4 | The tasks in the order of the user, the tasks with no survey for their text, and the warnings of the order check. |
| `get_plan` | read | 4, 5 | The steps with their levels, writers, places and notes. |
| `get_step` | read | 5 | The current step, its scope, its kind, and the marks and notes of its receipt. |
| `get_callouts` | read | 5 | The open callouts with their facts. |
| `get_commit_message` | read | 5 | The commit message and the summary of the ledger. |
| `submit_brief` | submit | 1 | The brief that the user wrote in the chat, and a short title of the task. Each line must be in a recent prompt of the user (decision 12). The brief goes into a new task, or into the active task in stage 1 if its brief has no text. |
| `submit_questions` | submit | 1 | 1 to 10 questions of Claude about the brief, each with a part and a quote of the brief. A new list replaces the open questions. |
| `submit_survey` | submit | 2 | The facts, the tasks, the hooks and the questions. Each hook gives a short text of its code. Shotgun then gets the facts of DataFlow for each hook. A new survey replaces the old survey. |
| `submit_task_survey` | submit | 3 | The hooks, the new hooks, the needs, the size and a note of a rewritten task or of a new task. Claude gives the text of the task too, so that Shotgun refuses a survey of an old text. |
| `submit_plan` | submit | 4 | The steps of the plan. Shotgun then gives each step the level of the rules from the facts of DataFlow. A new plan replaces the old plan. |
| `start_step` | submit | 5 | Opens a step for an errand or for a frame. |
| `submit_frame` | submit | 5 | The holes of a frame with their hints. |
| `submit_errand` | submit | 5 | The notes of Claude on its changes, and the loose ends that Claude found. |
| `submit_explanation` | submit | 5 | A sentence of Claude for a callout. |
| `submit_line_answer` | submit | 5 | The answer of Claude to a question of the user about a line. |
| `submit_message_check` | submit | 5 | The points of the check of the commit message. |
| `guard` | hook | all | The decision of the guard for a file change. |
| `session_context` | hook | all | A short text with the task, the stage and the gates for each prompt to Claude. With no active task, it gives no text. |

A submit tool changes no file if its data has a problem. It also checks the stage and the gates. For example, `submit_plan` gives an error before the user accepts the order.

### 6.5 The plugin of Shotgun

- **Folder:** Shotgun writes the plugin into `~/.shotgun/claude`, with the marketplace `shotgun-vscode` and the plugin `shotgun`. Claude Code loads a plugin of a local folder in place, so the plugin needs no install.
- **Connection:** the command **Shotgun: Connect to Claude Code** adds the marketplace to `extraKnownMarketplaces` in the user settings of Claude Code. It also adds the plugin to `enabledPlugins` in `.claude/settings.local.json` of each workspace folder (P15). **Shotgun: Disconnect from Claude Code** removes these settings. `src/mcp/claude.ts` of DataFlow is the model for this code.
- **Git:** Shotgun adds `.claude/settings.local.json` to `.git/info/exclude`, so that git does not show the file.
- **Skills:** `shotgun`, `shotgun-survey`, `shotgun-plan`, `shotgun-errand`, `shotgun-frame` and `shotgun-explain`. The description of each skill names the requests of the user that load it. Each skill gives the full names of its tools.
- **PreToolUse hook:** a handler of type `mcp_tool` that calls `shotgun_guard` on the server `plugin:dataflow:dataflow`. The matcher is `Edit|MultiEdit|Write`. `NotebookEdit` has its own handler, because its path is in the field `notebook_path`.
- **Time limit:** each handler has a time limit of 10 seconds. The default of Claude Code is 600 seconds.
- **UserPromptSubmit hook:** a handler of type `mcp_tool` that calls `shotgun_session_context` (P14). Its text tells Claude about the active task, the stage and the gates. The hook also gives the prompt of the user to Shotgun, for the check of a brief from the chat (decision 12).
- **Check:** the panel shows if Claude Code has the plugins of DataFlow and of Shotgun on. Shotgun reads this from the settings of Claude Code.

This example shows the hooks in `plugin.json`, with no handler for `NotebookEdit`. Phase 0 and phase 1 tested this form with Claude Code 2.1.323:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "mcp_tool",
            "server": "plugin:dataflow:dataflow",
            "tool": "shotgun_guard",
            "input": { "tool": "${tool_name}", "file": "${tool_input.file_path}", "cwd": "${cwd}" },
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "mcp_tool",
            "server": "plugin:dataflow:dataflow",
            "tool": "shotgun_session_context",
            "input": { "event": "${hook_event_name}", "cwd": "${cwd}", "prompt": "${prompt}" },
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The guard tool gives its decision as the JSON of a PreToolUse hook: `hookSpecificOutput` with `permissionDecision` and `permissionDecisionReason`. Claude sees the reason of a deny. The context tool gives `hookSpecificOutput` with `hookEventName` and `additionalContext`.

### 6.6 The guard

| State of Shotgun | Decision for a file in the project folders |
| --- | --- |
| A file in `.shotgun` | Deny, also in a pause. Claude gives its results with the tools of Shotgun. |
| No active task, a pause of the guard, or a done task | No decision. The normal permissions of Claude Code apply. |
| Stage 1 to 4 | Deny. Claude changes no file in these stages. |
| Stage 5 with no open step of Claude | Deny. The reason names the current step and its writer. |
| An open step of Claude, and the file is in its scope | No decision. |
| An open step of Claude, and the file is not in its scope | Deny. The reason names the scope. |

The guard makes no decision for a file outside of the project folders. Each deny goes into the receipt of the step and into the ledger.

The guard helps the user, but it is not a security boundary:

- Claude Code continues the tool call when the server of DataFlow has no connection, or when the tool fails or times out. The documentation of hooks gives this behavior. S2b showed it: with VS Code closed, the hook gave "MCP server 'plugin:dataflow:dataflow' not connected", and the edit continued.
- A change through Bash is outside of the guard. The skills tell Claude to change files only with the file tools.
- The receipt shows each change since the base of the step, also a change through Bash or a change that the guard did not see.

### 6.7 Items in the text editor

- **Decorations:** the hooks in stages 2 and 3, and the steps in stages 4 and 5, with the color of their risk level. Stage 5 adds the holes, the lines of Claude and the callouts.
- **CodeLens:** a line above each step, for example "Step 4 of 8 · risk 4 · you write". A click opens the step in the panel.
- **Hovers:** the facts of a hook, the hints of a hole, and the proof of a callout.
- **Commands:** Tab and Shift+Tab go to the next hole and to the hole before it, while the cursor is in a frame. A command shows the next hint of the hole at the cursor.
- **Hole markers:** the form is `/*@hole N: question */`. A narrow format can break a long marker into 2 lines with ` * ` (S5). Thus the parser accepts a marker on more than 1 line, and removes the ` * ` at the start of each line.
- **After an edit:** the items move with their lines. After a reload of the window, each item goes to the place where its first and its last line have the same text as before. The layers of DataFlow do the same.

### 6.8 Facts from DataFlow

| Use in Shotgun | API of DataFlow |
| --- | --- |
| The check of a hook | `getPlace`, `getHeat` with `lines`, `listFunctions`, `getOutline` |
| The risk level | `getHeat` with `signals`, `isReachComplete` and `reachUnknown`, `getPlace` for the threads and the locks, and `types` of `getHeat` for a data member |
| The frame functions | `scanCallGraph`, `getCallGraph`, `onDidChangeCallGraph` |
| The receipt | `markBase`, `getDiff` with the base `mark:<name>` and `allFiles`, `deleteMark` |
| The loose ends | `getOutline` for the new members, `getMemberSites`, and `getRipple` with the base of the step |
| The callouts | `getThreads`, `getLogic`, `getHidden` and `getPlace` after `onDidParse` |
| The state of the engine | `engineState`, `engineError`, `onDidChangeEngineState` |
| The proof of a callout, after a click of the user | `showLine`, `setLens` |

Shotgun needs DataFlow 0.6.1, the release with the fixes of the 2 gap lists (decision 20). At the start, Shotgun reads `packageJSON.version` of DataFlow. With an older version, Shotgun shows the reason and stops.

### 6.9 The writer of each line

- When Claude calls `shotgun_start_step`, Shotgun saves the documents of the scope, because Claude Code writes the files on the disk. Then Shotgun makes the base of the step.
- When Claude calls `shotgun_submit_errand` or `shotgun_submit_frame`, Shotgun gets the diff since the base. The added lines are lines of Claude.
- An edit of the user in the scope of an open step gets a warning.
- A line of Claude that the user changes becomes a line of the user. The lines of the answer of a hole are lines of Claude.
- `lines.json` keeps the ranges of the lines, and moves them with each edit.

## 7. Prerequisites

1. A release of DataFlow with the fixes, in VS Code.
2. A connection of DataFlow to Claude Code, with the command **DataFlow: Connect to Claude Code**.
3. Claude Code 2.1.323 or a later version. Phase 0 tested the hooks of type `mcp_tool` and the skills in plugins with this version.
4. A C or C++ project with a compile database, as DataFlow needs.
5. VS Code 1.143 or a later version, for the panel in the secondary side bar. Phase 0 tested 1.143.1 and 1.146.0.

## 8. Phases

Each phase ends with its tests, its documents and an item of the changelog. The user approves each commit.

| Phase | Content | Size | Needs |
| --- | --- | --- | --- |
| 0 Spikes | 6 short tests of the parts with the most risk. Done on 14 November 2026. | Small | DataFlow from `master` |
| 1 Foundation | Repository, tasks, stages, views, connection to Claude Code, guard. Done on 14 November 2026. | Large | Phase 0 |
| 2 Brief | The brief, the questions of Claude, the first gate. Done on 14 November 2026. | Small | Phase 1 |
| 3 Survey | `submit_survey` with its checks, the survey page, the hooks in the text editor | Large | Phase 2 |
| 4 Order | The order page, the survey of changed tasks, the order check | Medium | Phase 3 |
| 5 Plan | The rules, `submit_plan`, the plan page, the steps in the text editor | Large | Phase 4, D1 |
| 6 Build | Steps, errands, receipts, steps of the user, the writer of each line | Large | Phase 5 |
| 7 Frames | Holes, hints, Tab | Medium | Phase 6 |
| 8 Callouts | The facts of the engine on the lines of the user | Medium | Phase 6, D2 |
| 9 Ledger | Loose ends, the ledger page, the check of the commit message | Medium | Phase 6 |
| 10 Release | Documents, VSIX package, a full test with Claude Code | Small | Phases 1 to 9, D3 |

### Phase 0: spikes

The spikes test the parts with the most risk before the foundation. Each spike is a small extension or plugin outside of Shotgun. `docs/p0-spike-results.md` records each result, as in DataFlow.

| Spike | Question | Result for the plan |
| --- | --- | --- |
| S1 Panel | Can an extension put a webview view beside the text editor, for example in the secondary side bar? | The place of the panel, or a view in the activity bar that the user moves. |
| S2 Guard | Does a hook of type `mcp_tool` in a local plugin call a tool of `registerTools`? Does a deny stop an edit in the panel of Claude Code? | The input form of the hook, and the delay for each edit. |
| S3 Skills | Does a request in words, for example "Survey my brief", load a skill of the local plugin? | The form of the descriptions of the skills. |
| S4 Session | Does a SessionStart hook of type `mcp_tool` give its text to Claude? | The text of `session_context`. |
| S5 Holes | Do markers in comments of a C++ file stay after a format on save and after the `C/C++` extension? Do Tab and Shift+Tab move between them? | The form of the hole markers. |
| S6 Receipt | Does `getDiff` with the base of a mark give the changes of Claude Code, with their functions and heat? | The form of the receipt. |

S2 also records what the user sees when VS Code does not run. Then the hook of the guard cannot get to the server of DataFlow.

If S2 fails, the guard is a hook of type `command` with a small script. The script reads the state of Shotgun from `.shotgun/active.json`.

**Results:** S1, S2, S3, S5 and S6 passed. S4 failed in its planned form, and P14 replaces it. S2 passed, so the guard stays a hook of type `mcp_tool`. 1 more test found the settings of P15. `docs/p0-spike-results.md` gives the data, and section "Changes to the plan" in it lists each change of this plan.

### Phase 1: foundation

- **Repository:** `git init`, and `package.json` with `"extensionDependencies": ["KnurrliDev.dataflow"]` and `"engines": { "vscode": "^1.143.0" }`. Also the TypeScript configurations, the build script of the webviews, and the test setup of DataFlow.
- **Start:** Shotgun gets the API with `getApi(1, { client: 'Shotgun' })`, and checks the version of DataFlow. The function `activate` returns at once, because VS Code shows a view only after `activate` returns (S1).
- **Tasks:** the folder `.shotgun/`, the stage files, and the commands **Shotgun: New Task**, **Shotgun: Open Task**, **Shotgun: Pause** and **Shotgun: Continue**.
- **Stages:** a state machine for the stages and the gates. Each gate writes a line into `decisions.jsonl`.
- **Views:** the page and the panel with the bar of the stages, and a typed message protocol between the extension and each webview.
- **Claude Code:** the plugin folder, the commands to connect and to disconnect, the settings of P15, and the check of the connection. A test with the user settings shows that the form of P15 loads the plugin.
- **Tools:** `get_session`, `guard` and `session_context`, with the rules of the guard for the stages 1 to 4.
- **Tests:** unit tests of the state machine, the stage files, the rules of the guard and the plugin files. A script test runs `claude plugin validate` on the plugin folder if `claude` is on the PATH.
- **Done when:** in the panel of Claude Code, Claude reads the session, and the guard denies an edit of a project file in stage 1.

**Status, 14 November 2026:** done, with 2 differences from the plan and 1 open item:

- `scripts/test-claude.mjs` runs the condition with the CLI of Claude Code in print mode. All 17 checks passed. Claude read the session with `shotgun_get_session`. The guard denied the edit in stage 1 with the reason of the stage, and the file did not change. The ledger and the panel showed the deny.
- Difference: phase 1 has no skill. The text of the context names the full name of `shotgun_get_session`, and Claude found the tool with `ToolSearch`. The skill `shotgun` comes in phase 2, as planned.
- Difference: Shotgun keeps the state of a task in `task.json`. Section 6.3 has this file now.
- Open: the check of the messages of the hooks in the panel of the VS Code extension of Claude Code. This check needs the settings of the user. Thus the user does it.
- DataFlow 0.6.0 can give its MCP server a different token than the token file at the first start: gap 42 of `dataflow-gaps-2.md`. The test starts the server again after a 401.

### Phase 2: brief

- **New task:** Shotgun makes `brief.md` from a template with 5 parts: Goal, Facts, Specs, Not in scope and Done when. Shotgun opens the brief in the text editor.
- **Brief from the chat:** the user writes the brief in Claude Code. Claude calls `submit_brief` with the text of the user. Shotgun makes a task if no task is active, writes `brief.md`, and opens it.
- **Panel:** the check of the 5 parts, and the next request, for example "Ask me questions about my brief".
- **Questions:** `submit_questions`. The panel shows each question with its line of the brief. The user answers in the brief, or closes the question.
- **Gate:** **The brief is ready**, when each part has text. The gate starts the scan of the call graph. Decision 22 changed this rule: each part is optional, and the gate never waits.
- **Skill:** `shotgun`: the stages, the contract, the tools, and the rule that Claude writes no text in the brief. Claude gives a brief from the chat unchanged.
- **Done when:** 2 new tasks go from the brief to stage 2. The first task has a brief in a file, and the second task has a brief from the chat.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed all 37 checks with 3 prompts of Claude Code:

- Task 1: the test wrote the brief into `brief.md`. "Ask me questions about my brief." loaded the skill `shotgun`. Claude read the code and gave 8 questions with their parts and quotes. Claude did not change the brief.
- The test closed the questions with **Shotgun: Close Question**. The gate took task 1 to stage 2, and the scan of the call graph started.
- Task 2: the user gave a brief in the chat. Claude gave it with `submit_brief`, and Shotgun took it at the first call. Each line was in the words of the user, and the gate took task 2 to stage 2.

Differences from the plan:

- `submit_brief` makes a new task if no task is active, if the active task is after stage 1, or if Claude gives `"isNewTask": true`. It fills the brief of the active task in stage 1 only if that brief has no text. It never changes a brief with text.
- New commands for the keyboard: **Shotgun: Open Brief**, **Shotgun: Close Question** and **Shotgun: Pass the Gate**.
- The gate saves `brief.md` first. With open questions, a modal message asks the user before the gate.
- The ledger also records the brief of Claude, the questions of Claude, and each question that the user closes.

### Phase 3: survey

- **Tool:** `submit_survey` with the facts, the tasks, the hooks and the questions. Each hook has a file, a line or a range of lines, a kind and a title.
- **Checks:** each file is in the project, and each line is in its file. `getPlace` gives the function of each hook, and `getHeat` with `lines` gives its heat. A hook in a type gets the facts of `getOutline`. Each task names hooks of the survey.
- **Heat:** until `isReachComplete` is true, the page shows "heat after the scan".
- **Page:** the tasks, the hooks, the facts, and the questions with a field for each answer. A part of the code shows the place of the selected hook.
- **Text editor:** each hook gets a decoration, and a hover with the facts of its line.
- **Skill:** `shotgun-survey`: read the brief, read the code through DataFlow, submit, and correct each problem.
- **Gate:** **Order the tasks**.
- **Done when:** the survey of the fixture `battery` of DataFlow shows 7 hooks with their heat.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed all 56 checks with 4 prompts of Claude Code:

- Task 1: "Survey my brief." loaded the skill `shotgun-survey`. Claude read the code with 6 read tools of DataFlow. It gave a survey with 5 tasks, 6 hooks, 5 facts and 5 questions, and Shotgun took it at the first call. Each fact names a tool that Claude called.
- Each hook in a C++ file got the facts of DataFlow. The 4 hooks in functions got their heat: 30 or 40, warm. The 2 hooks in types got the facts of the type, with no score. The scan of the call graph was complete.
- The test answered 1 question on the page and 4 questions with **Shotgun: Answer Question**. The page opened the place of a hook in the text editor, and the text editor showed the hook with its id and title. The gate **Order the tasks** took task 1 to stage 3.
- Done when: Claude selects the number of the hooks. An earlier run gave 7 hooks, and the last run gave 6 hooks. In both runs, each hook in a function had its heat. A hook in a type has no heat, because a type has no score in DataFlow (gap 11).

Differences from the plan:

- Claude gives a short text of the code of each hook in the field `code`, and Shotgun checks it in the lines of the hook. A hook moves with its code. Section 6.7 gives a different rule for the other items: the text of the first and the last line.
- `getPlace` gets the line of the code of the hook. A hook in a type gets the shared members of the type from the field `types` of `getHeat`. Shotgun does not use `getOutline` or `listFunctions` for the check.
- Before the end of the scan of the call graph, the page shows the heat with "*" and a note. The plan gave the words "heat after the scan". At the end of the scan, Shotgun gets the facts again.
- The facts of DataFlow go into `engine.json`, and the answers of the user go into `answers.json`. Section 6.3 has these files now.
- New commands: **Shotgun: Answer Question** and **Shotgun: Check the Hooks Again**.
- Claude gives the ids of the tasks, the hooks and the questions. Thus a new survey keeps each answer with its question.
- In the first runs, Claude read the code only with the tool Read, and each fact named a tool that Claude did not call. Now the skill tells Claude to give a fact only from a call of a read tool of DataFlow. Shotgun cannot check the tool calls (gap 43 of `dataflow-gaps-2.md`). Only `scripts/test-claude.mjs` checks them.
- Fix: on Windows, a different program can keep a stage file open for a short time. Then "Shotgun: Open Task" did not change the active task. Now the write of a stage file tries again for a maximum of 1 second.

### Phase 4: order

- **Page:** the order page of the canvas: move, rewrite, add, later and remove.
- **Tools:** `get_order` and `submit_task_survey`. A rewritten task or a new task has no survey until Claude surveys it.
- **Order check:** the needs from the survey give a warning for a task that comes before a task that it needs. The badge **Model** shows that the needs are words of Claude.
- **Panel:** the next request, for example "Survey my changed tasks".
- **Gate:** **Accept the order**. A task with no survey gets its survey at the start of the plan. The skill `shotgun-plan` has this rule.
- **Done when:** the user rewrites a task, adds a task, gets their surveys, and accepts the order.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed all 70 checks with 5 prompts of Claude Code:

- The order page showed the 4 tasks of the survey of task 1. On the page, the test changed the text of task 1, added a task, and moved the new task up 1 place. The ledger recorded the 3 edits.
- "Survey my changed tasks." loaded the skill `shotgun-survey`. Claude read the order with `shotgun_get_order`, and gave a survey for each of the 2 changed tasks. Shotgun took both surveys at the first call. Claude changed no text, no place and no file.
- The new task got a new hook in `src/main.cpp`, with the facts of DataFlow. A note of Claude named a new decision of the user: the range of the limit.
- The gate **Accept the order** on the page took task 1 to stage 4. The panel showed the request "Make the plan.".
- In the survey of the changed tasks, Claude read the code only with the tools Read and Grep. A survey of a task has no facts, so no fact names a tool.

Differences from the plan:

- The canvas shows a size for each task. The survey of stage 2 and the survey of a task now have an optional size: small, medium or large.
- The canvas gives a reason for each need, for example "the limit". The survey has only the ids of the tasks. Thus a warning gives the places of the tasks, for example "Task 1 needs task 2. Task 2 comes later.".
- Claude gives the text of the task to `submit_task_survey`. Shotgun refuses a survey of a text that the user changed after the call of `get_order`.
- The user removes only a task that the user added. A task of the survey can only go to "later".
- In stage 4, the page shows the order with no edit, until phase 5 adds the plan page.
- After the test with Claude Code, the rows of the order page got a fixed form of 2 lines. The unit tests and a check in a browser ran after this change of the layout. The test with Claude Code did not run again.

### Phase 5: plan

- **Rules:** pure functions from the facts of DataFlow to a risk level. The tests use tables of facts and levels. The rules of D1 come into this phase.
- **Tool:** `submit_plan`. Each step names its task, its hooks and its places. A place is a file with lines, or a new file. Each task of the order has 1 step or more.
- **Levels:** Shotgun calculates the level of each step from the facts of each place. It waits for `isReachComplete`.
- **Page:** the plan page of the canvas. It shows the steps, and for the selected step its place, its heat, its rule, its level and the note of the user. The buttons **Lower**, **Raise** and **Rule value** change the level.
- **Text editor:** each step gets a decoration with the color of its level, and a CodeLens line.
- **New plan:** `submit_plan` can replace the plan before the gate. A level that the user changed stays with its step, if the step has the same id.
- **Gate:** **Accept the plan**. The levels of the user and their notes go into the ledger.
- **Done when:** the plan of the fixture gets the levels 3, 4, 5, 4, 2, 3, 1 and 1 from the rules.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed all 81 checks with 6 prompts of Claude Code:

- "Make the plan." loaded the skill `shotgun-plan`. Claude gave 8 steps for the 5 tasks of the order, in their sequence, and Shotgun took the plan at the first call. Claude changed no file.
- The rules gave the levels 3, 3, 3, 4, 3, 2, 2 and 2 from the facts of DataFlow. For example, step 4 changes a line of `solve_power_plan()`. The function is warm (level 3), and a worker thread runs the line (1 level more).
- 2 steps change a data member of a type. Each got the level of the hottest function that uses the member: `process()`, warm, level 3. A step with `CMakeLists.txt` got level 2 with "no facts".
- The page opened the place of a step in the text editor, and the CodeLens line showed the step with its level and its writer. On the page, the test raised the level of step 1 and wrote a note. The ledger recorded both.
- The gate **Accept the plan** on the page took task 1 to stage 5.

Differences from the plan:

- Done when: the plan of Claude is different from the example plan of the design canvas. A unit test gives the facts of the 8 steps of the canvas to the rules. The rules give the levels 3, 4, 5, 4, 2, 3, 1 and 1.
- Three files keep the writers apart: `plan.json` (Claude), `risk.json` (Shotgun) and `levels.json` (user). Section 6.3 has them now.
- Lines in no function and in no type get level 2. The rules of decision 14 have no level for them.
- In stage 4, Claude can survey a task with no survey with `submit_task_survey`. `submit_plan` refuses a task with no survey.
- A step that waits for the scan has no **Lower** and **Raise**. The user can set its level with the buttons **Level 1** to **Level 5**.
- New commands: **Shotgun: Set Risk Level** and **Shotgun: Check the Levels Again**.
- The main loop of the fixture is a for loop with 100 cycles. `get_place` gives `isOpenLoop` false for it, so the rule of the main loop does not find a line in it. Gap 32 of `dataflow-gaps-2.md` has this data now. No step of the test was in this loop.

### Phase 6: build

- **Steps:** the current step, and its state: to do, open for Claude, receipt to walk, or done.
- **Panel:** the current step with its writer, and the next request, for example "Do step 1".
- **Errand:** `shotgun_start_step` at level 1 or 2 saves the documents of the scope, makes the base of the step, and opens the scope for the guard. `shotgun_submit_errand` closes the scope, and makes the receipt from `getDiff`.
- **Receipt:** the panel shows each change with the note of Claude and its check. The user puts a mark on each change, and can write a note. A change outside of the scope gets a warning.
- **Issues:** `get_step` gives the marks and the notes of the user to Claude. The user asks, for example "Fix the issues of step 5", and Claude opens the step again.
- **Gate of an errand:** **Accept the receipt**. Shotgun then deletes the base of the step.
- **Steps of the user:** at level 4 or 5, the panel shows the place, the text and the checks of the step. The gate is **The step is done**.
- **Writer of each line:** `lines.json`, as section 6.9 tells.
- **Skill:** `shotgun-errand`: open the step, change only the files of the scope, submit a note for each change, and list the loose ends.
- **Done when:** step 5 of the fixture runs as an errand with a receipt, and step 2 runs as a step of the user.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed all 104 checks with 8 prompts of Claude Code:

- Before the gate "Accept the plan", the test set step 1 to level 4 and step 2 to level 2 with **Shotgun: Set Risk Level**.
- Step 1 of the user: Shotgun opened the step with a base of its file. The test wrote a line in `include/battery/types.hpp`, and selected "The step is done" in the panel. `lines.json` recorded the line of the user.
- "Do step 2." loaded the skill `shotgun-errand`. Claude called `shotgun_get_step`, opened the step with `shotgun_start_step`, and changed only the file of the scope with Edit. Then it gave the receipt with `shotgun_submit_errand`, and Shotgun took the receipt at the first call.
- The receipt had 1 change of 1 line, with a title and a check. It did not have the line of the user from step 1, because the base of step 2 came after step 1. The guard denied no edit, and no file outside of the scope changed.
- The text editor showed the line of Claude with a dashed mark in the gutter and the tag "Claude · not walked". After the mark of the user, the tag was "Claude · issue".
- The test put an issue with a note on the change in the panel. The gate stopped, and the panel showed the request "Fix the issues of step 2.".
- "Fix the issues of step 2." opened the step again. Claude read the note of the user with `shotgun_get_step`, added the comment, and gave a new receipt with a note. The step kept its base. The receipt of round 2 had a new hunk, so its change had no mark.
- The test marked the change OK, and the gate "Accept the receipt" ended step 2. The ledger recorded the starts, the receipts, the marks, the note and the 2 gates of the steps.
- Done when: the plan of Claude is different from the example plan of the design canvas. Thus the test used step 1 as the step of the user, and step 2 as the errand.

Differences from the plan:

- Decision 15: until the frames of phase 7, the user writes a step of level 3. The plan page, the CodeLens lines and the tools show this writer.
- The steps go in a strict sequence. The current step is the first step that is not done, and Claude can open only the current step.
- The scope of a step is the files of its places. The guard denies each other file. The receipt also shows the files outside of the scope that changed while the step was open. A watcher of the file system gives them.
- Claude gives the receipt as changes. Each change has its lines, a title, a check for the user and an optional note. Each hunk of the diff needs a change, and each change needs a hunk. Thus the receipt has the form of the design canvas.
- DataFlow cannot make a mark of a path that is not there: gap 44 of `dataflow-gaps-2.md`. Shotgun reads a new file of the scope at the receipt. All its lines are added lines, with no facts of DataFlow.
- A step of the user also gets a base. At "The step is done", the diff since the base gives the lines of the user.
- `lines.json` keeps a hash of each line of a file with lines of a writer. After each change of the file, a diff of the lines moves the lines of each writer. A change of the spaces only keeps the writer of a line.
- The user can accept a receipt with a change that has no mark, after a modal message. The ledger keeps the number of these changes. An issue stops the gate.
- In a new round, a change with the same hunks keeps the mark OK. A change with an issue or a question starts with no mark, because Claude can answer in its note.
- New command: **Shotgun: Mark a Change**. The ledger keeps the file of a deny with `/`.
- After the test with Claude Code, 2 changes came. The row of the current step in the panel breaks between its parts now. Level 3 got the writer "user" in the views. The unit tests and a check in a browser ran after these changes. The test with Claude Code did not run again.

### Phase 7: frames and hints

- **Frame:** at level 3, or at level 4 on a request of the user, Claude opens the step with the kind `frame`. Claude writes the frame into the file, with a marker in a comment for each hole.
- **Tool:** `submit_frame` with the holes. Each hole has its question and 4 hints: a nudge, a pointer with places, an example with a place and its code, and the answer. Shotgun checks that each marker and each place is there.
- **Text editor:** each hole gets a decoration with its question. Tab and Shift+Tab go to the next hole and to the hole before it.
- **Hints:** the panel and the hover show the next hint after a click. The answer fills the hole, and its lines are lines of Claude.
- **Done holes:** Shotgun counts a hole as done when its marker is not there and its line has code.
- **Skill:** `shotgun-frame`: write only the lines with no decision, put each decision into a hole, and give the 4 hints.
- **Done when:** step 4 of the fixture has a frame with 3 holes, their hints, and Tab.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed 123 of 124 checks with 9 prompts of Claude Code. The 1 failure was a fault of the check, not of Shotgun:

- In stage 5, the test set step 3 to level 4 with **Shotgun: Set Risk Level** (decision 17). Shotgun opened the step for the user again with a new base. The panel showed the button "I want a frame", and the click recorded the decision (decision 16).
- "Give me a frame for step 3." loaded the skill `shotgun-frame`. Claude opened the step with the kind frame, changed only the file of the scope, and gave the frame with `shotgun_submit_frame`. Shotgun took the frame at the first call.
- The frame had 2 holes in `src/battery.cpp`. Hole 1 was a marker in the condition of a new `else if` branch. Hole 2 was a marker alone on its line, for the reset of the counter. Each hole had its 4 hints, and the facts of DataFlow at its line.
- The text editor showed the open holes, and the frame lines with the tag "Claude · frame". Tab selected hole 1, the test typed its code, and the panel showed the hole as yours.
- A click on "1 Nudge" showed the nudge of hole 2. "4 Show me" and the modal message put the answer of Claude into hole 2. `lines.json` recorded its line as a line of Claude.
- The gate "The step is done" ended step 3. `lines.json` recorded the line of the user in hole 1. The ledger recorded the frame request, the frame, the hints and the gate.
- The failure: the check of "4 Show me" read the file on the disk before the save, so it found the marker. The text editor had the answer: the gate needs each hole filled. Also, the file after the gate has the answer in the place of the marker. The check now reads the state of the hole in the panel. The test with Claude Code did not run again after this change.
- Done when: the design canvas has a frame in step 4 with 3 holes. The plan of Claude had a different step 3, and its frame had 2 holes.

Differences from the plan:

- The decisions 16, 17 and 18 came in this phase. Decision 15 ends: a step of level 3 gets a frame.
- After the user fills a hole, Shotgun finds its place with the text before and after the marker on its line. For a marker alone on its line, Shotgun uses the lines around it. A marker of a different hole in this text agrees with each text. Section 6.7 gives a different rule: the text of the first and the last line.
- A hole shows the function, the threads and the locks at its line. The design canvas shows the names in scope: gap 45 of `dataflow-gaps-2.md`.
- The pointer and the example are words of Claude, so they have the badge "Model". The design canvas has the badge "Engine" on the pointer.
- The button "Remove the frame" of the design canvas is not in Shotgun. The user asks Claude for a different frame, or uses the undo of the text editor.
- New commands: **Shotgun: I Want a Frame**, **Shotgun: Go to the Next Hole**, **Shotgun: Go to the Hole Before** and **Shotgun: Show the Next Hint**.
- With no open hole, Tab and Shift+Tab indent as usual. Tab does not take the place of a suggestion, an inline suggestion or a snippet.
- The test script clicks the Command Center of the title bar when a webview keeps the keys of the Command Palette.

### Phase 8: callouts

- **Facts:** after `onDidParse` of a file with lines of the user in the current step, Shotgun gets the facts of the changed functions. It uses `getThreads`, `getLogic`, `getHidden` and `getPlace`.
- **New facts:** Shotgun compares the facts with the facts at the start of the step. A new fact on a line of the user becomes a callout.
- **Sequence:** problems first, then warnings, then the other facts. The voice filters them: quiet, normal or talkative. A pause shows a maximum of 3 callouts. D2 gives the defaults.
- **Text editor:** a decoration, and a hover with the proof: the facts of the engine with their places. The link **Show in DataFlow** calls `showLine` and `setLens` after a click of the user.
- **Not a problem:** the user closes a callout with a reason. The reason goes into the ledger.
- **Tools:** `get_callouts` and `submit_explanation`. The user asks, for example "Explain the callout on line 129". The sentence of Claude shows under the fact, with the badge **Model**.
- **Questions on a line:** the user asks Claude in Claude Code, for example "Does the lambda on line 95 copy charge?". Claude puts its answer at the line with `submit_line_answer`. The answer keeps the facts of the engine and the words of Claude apart.
- **Skill:** `shotgun-explain`.
- **Done when:** the race of step 4 of the fixture shows as a problem callout.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed all 135 checks with 10 prompts of Claude Code. The run used the repository of DataFlow with the fixes of the items 30 to 33 and 41 to 47 of `dataflow-gaps-2.md`:

- In stage 5, the test set step 4 to level 4. Shotgun opened the step for the user, and kept the keys of the facts of DataFlow at the start of the step.
- The test typed `charge.is_dirty = true;` in `process()`, on line 101. The line was a line of the user at once.
- At the pause, the race of `charge.is_dirty` with the worker thread showed as the problem callout C1 on line 101. The text editor showed the tag "PROBLEM · charge.is_dirty: race". The status bar showed "Shotgun: 1 problem on your lines".
- "Explain the callout on line 101. Then answer my question: does the lambda on line 95 copy charge?" loaded the skill `shotgun-explain`. Claude explained the callout with `shotgun_submit_explanation`, and changed no file.
- Claude answered the question with `shotgun_submit_line_answer`. Shotgun added 2 facts of DataFlow at line 95, and the panel showed them apart from the answer.
- "Not a problem" closed the callout with the reason of the test, and the ledger kept the reason. The panel set the voice to quiet.
- The new data of DataFlow: the 2 holes of the frame of step 3 showed 8 names in scope each, for example `home_battery_ctl: HomeBatteryCtrl &`. Shotgun refused no fact of the survey, so Claude called each tool of its facts. The MCP server had the same token as the token file.
- An earlier run with DataFlow 0.6.0 passed all 11 checks of phase 8. Its 5 failures in stage 1 came from the restart of the MCP server after the 401 of item 42: the letter "w" went into the open `brief.md`.

Earlier runs found 4 faults, and this phase fixed them:

- Phase 7: a click on "I want a frame" while Shotgun opened the step for the user did not stick. Now a step that changes while it opens does not open. The store refuses a start with a writer that is not the writer of the step.
- A file with no lines of a writer did not get the lines that the user typed, so a callout had no line of the user. Now Shotgun follows the lines of the files of the scope from the start of a step of the user, or of the holes of a frame.
- The engine of DataFlow stopped on a check of a `std::optional` with an error after it: item 47 of `dataflow-gaps-2.md`. The frame of step 3 had such an error. The repository of DataFlow has a fix.
- The test script: "File: Save" in the Command Palette selected "File: Compare Active File with Saved", so the test saves with Ctrl+S. The test also waits for the new open of step 3 after the new level.

Differences from the plan:

- A pause is 2 seconds with no edit in a C or C++ file of the project, not the event `onDidParse`. DataFlow parses the text of the editor, so the facts at the pause agree with the text.
- The key of a fact at the start of the step has the text of its line. Thus a fact that only moved is no callout.
- The voice and the pause are the settings `shotgun.voice` and `shotgun.pauseSeconds` of VS Code (decision 19).
- Shotgun takes an answer on a line only for a question in the recent prompts of the user.
- The repository of DataFlow got the fixes of the items 30 to 33 and 41 to 47 of `dataflow-gaps-2.md` in this phase. They are not committed and not in a release. Shotgun uses their data: the accesses of a race (item 46), the main loops (item 32), the new files of a base (item 44), the names in scope at a hole (item 45), and the tool calls of Claude for decision 13 (item 43). With DataFlow 0.6.0, Shotgun uses its procedures from before the fixes.
- Item 11 of `dataflow-gaps-2.md` stays open: the score of a type and of a data member needs a calibration on real projects.

### Phase 9: loose ends, ledger and commit message

- **Loose ends:** after each step, `getMemberSites` gives the functions that use a type with a new data member. It also gives each `switch` statement that does not handle a new enumerator. `getCallers` gives the callers of each changed function.
- **Loose ends of Claude:** Claude adds its loose ends with `submit_errand`. They show with the badge **Model**.
- **Hand to Claude:** the user can make a loose end into a new step of level 1 or 2. This is a decision of the user, and it goes into the ledger.
- **Ledger page:** the decisions from `decisions.jsonl`, the lines of each file for each writer, and the receipts that the user did not walk.
- **Commit message:** `get_commit_message` reads the input box of the repository. The user asks, for example "Check my commit message". Claude compares the message with the diff, and calls `submit_message_check`. The ledger page shows each point.
- **Copy:** the ledger page copies the decisions as Markdown for a pull request.
- **Done when:** the ledger of the fixture task shows the decisions, the writers of the lines, and the check of a message.

**Status, 14 November 2026:** done. `scripts/test-claude.mjs` passed all 146 checks with 12 prompts of Claude Code. The run used DataFlow 0.6.1:

- At the gate of each step, Shotgun started a scan of the call graph, and then got the loose ends of the step from DataFlow. Each scan parsed only the 1 or 2 changed files, in about 0.7 seconds. `loose.json` had the steps 1 to 4 as checked.
- Step 1 of the user added the setting `cycle_limit`, and step 2 of Claude added the counter `waiting_cycles`. DataFlow gave a loose end for each new member: "process does not use cycle_limit" and "process does not use waiting_cycles". `process()` uses 3 of 4 data members of `OperationalSettings` and 10 of 11 data members of `HomeBatteryCtrl`, but not the new members at the 2 gates. The receipt of step 2 gave a loose end of Claude too.
- "Hand to Claude" made the first loose end the step L1 after step 4, with level 2. The panel showed the request "Do the loose ends.".
- The test wrote a commit message in the input box of Source Control. The tab **Ledger** of the panel showed the same text.
- "Check my commit message." loaded the skill `shotgun-commit`. Claude read the diff, gave its points with `shotgun_submit_message_check`, and changed no file. The check did not agree with the message, because the diff has no check of the limit yet: the later steps were not done.
- The ledger page showed the 39 decisions of the user, the lines of each writer, and the points of the check. "Copy for the pull request" put the ledger into the clipboard as Markdown.

Earlier runs, probes of DataFlow and the screenshots found 9 faults, and this phase fixed them:

- The test script: the stand-in of the user wrote only a comment line in step 1. In 1 run, the plan put the 2 new data members into step 1, so Claude could not do step 2. Now a run of Claude Code with no plugins stands in for the user and does the step.
- Shotgun asked DataFlow with the line of a new member. But `getOutline` and `getMemberSites` find a type only by a line with its name. Thus no gate got a loose end of DataFlow, and the log of Shotgun had no failure. Now a scan of the text finds the head of the type, and each failure of DataFlow goes to the log. A probe with the real DataFlow showed the fault. Item 48 of `dataflow-gaps-2.md` gives the internal error of `getMemberSites` for such a line.
- Shotgun skipped each hunk with a function, so a new data member next to a new inline function gave no loose end. Now the outline of the type gives the line of each member.
- After "Hand to Claude", the gate told the user to say "Do step 5." in place of "Do the loose ends.".
- The command **Shotgun: Hand a Loose End to Claude** took a loose end that is a decision of the user. Now the store and the command refuse it, as the panel does.
- The test script: the Source Control view scrolled to the file of the active editor, so the test found no input box. The test build has `scm.autoReveal` off now.
- The test script: the step of the user after step 4 was open, so the loose end went after it (decision 21). The test sets step 5 to level 2 now.
- The screenshots showed long names that did not break. A title ran under its chip, and the table of the ledger page cut off a column. Now the titles have the short names of the functions, long names break, and the table scrolls in a narrow card. A harness of the webviews with the stage files of a run, and the screenshots of the last 2 runs, showed the fix.
- A gate gave the false loose end "process does not use planning_cycles", though Claude added `planning_cycles = 0` to `process()` in the same step. The call graph of DataFlow does not see the changes that Claude Code writes on the disk, so the gate got an old index (item 49 of `dataflow-gaps-2.md`). Now each gate starts a scan of the call graph and waits for its end. A probe with the real DataFlow showed the fault and the fix.

Differences from the plan:

- The loose ends of a changed function come from `getRipple` with the base of the step, not from `getCallers`. A caller in the changed lines of the step is not a loose end. A step gets a maximum of 5 of these loose ends.
- A loose end of a data member is a function that uses half or more of the data members of the type, but not the new member. A static data member does not count, and a new type has no loose ends. Each new member gets a maximum of 8.
- Shotgun finds the head of a type with a scan of the text, because DataFlow finds a type only by a line with its name (item 48).
- At each gate, Shotgun waits for a scan of the call graph, for a maximum of 30 seconds (item 49). If the scan does not end in time, the gate gives no loose ends of the new members.
- "Hand to Claude" gives level 2 (decision 21), not a choice of level 1 or 2. Only a mechanical loose end with a place can go to Claude. The user closes a decision with a reason.
- Shotgun shows no tag in the text editor for a loose end. The panel and the page link to its place.
- Shotgun reads the commit message with the API of the Git extension of VS Code, every 2 seconds in stage 5. A check of Claude is old when the message changes.
- Shotgun needs DataFlow 0.6.1 (decision 20). The procedures for DataFlow 0.6.0 are removed.

### Phase 10: release

- **Documents:** `README.md`, `docs/usage.md`, `docs/tools.md` with the tools and the skills, and `CHANGELOG.md`.
- **Package:** a script for the VSIX package, as in DataFlow.
- **Full test:** 1 task from the brief to the commit message, with Claude Code in a real project of the user. This test uses the Claude subscription of the user.
- **D3:** the release form and the documents for the users of Shotgun.

**Status, 15 November 2026:** done, except the full test in a real project of the user:

- D3: the user selected a public release, as for DataFlow. The VSIX package goes to the GitHub page of the releases. It is not in the Marketplace, because DataFlow is not in the Marketplace.
- Documents: the README is short, with 5 screenshots of run 10 of `scripts/test-claude.mjs`. `docs/install.md`, `docs/usage.md`, `docs/tools.md` and `docs/development.md` give the details. `docs/tools.md` gives the 2 hooks, the 7 skills, and the 19 tools with their parameters. The file `LICENSE` has the MIT License.
- Package: `npm run package` makes `shotgun-0.1.0.vsix` with `scripts/package-vsix.mjs`: 60 files and 242 KB, for all systems. vsce 4.1.0 is a development dependency, as in DataFlow.
- A check of the package: a script installed the VSIX packages of DataFlow 0.6.1 and Shotgun 0.1.0 into the test build of VS Code 1.146.0, with its own extensions folder and user data. All 15 checks passed. Shotgun started from the package, and DataFlow got the 19 tools of Shotgun. The panel and the page showed the new task. The connection wrote the plugin of version 0.1.0 with its 2 hooks and 7 skills. The data of Claude Code of the user did not change.
- Full test: run 10 of `scripts/test-claude.mjs` did 1 task from the brief to the check of the commit message in the fixture of DataFlow. It passed all 151 checks. The user does the full test in a real project with the VSIX before the push of the release.

## 9. Tests

| Kind | Tests |
| --- | --- |
| Unit tests | The rules, the checks of the tools, the state machine and the logic of the order page. Also the hole markers, the moves of the line ranges, and the rules of the guard. |
| Integration tests | The extension in the test build of VS Code, with a fake API of DataFlow. The fake API has the type `DataFlowApi` and gives recorded facts. |
| Fixture tests | The real DataFlow with its fixture `battery`: the hooks, the levels, the bases and the receipts. |
| UI tests | Snapshots of the page and of the panel, as `spikes/ui` of DataFlow does. |
| Plugin tests | `claude plugin validate` on the plugin folder. |
| Hook tests | `scripts/test-claude.mjs`: `claude -p` with `--plugin-dir`, `--setting-sources project`, `--include-hook-events` and `--no-session-persistence`. Not `--strict-mcp-config`, because it also removes the MCP servers of plugins. These tests use the Claude subscription of the user, so they run only on request. |
| Rule for the hook tests | The CLI uses the login and thus the config folder of the user. A marketplace from the settings of a run goes into the plugin data of the user, so a test loads each plugin with `--plugin-dir`. The test records the plugin data of the user before the runs, removes the empty folders of the runs, and checks the data after them. |
| Skill tests | Cases of `claude plugin eval` for the requests that must load each skill. These tests use the Claude subscription of the user, so they run only on request. |
| Manual tests | 1 full task with Claude Code before each release. |

## 10. Repository layout

```text
shotgun/
  package.json
  tsconfig.json, tsconfig.webview.json
  scripts/                build of the webviews, VSIX package
  media/                  the icon of Shotgun
  scripts/test-claude.mjs the test with Claude Code
  plugin/                 the text of the skills, from phase 2. src/claude/plugin.ts makes plugin.json
  src/extension.ts        the start of the extension
  src/dataflow/           the copy of dataflow-api.d.ts, the version check, the facts
  src/session/            tasks, stages, gates, stage files, decisions
  src/rules/              the risk levels
  src/tools/              the tools for the MCP server of DataFlow, and their checks
  src/claude/             the plugin folder, and the settings of Claude Code
  src/editor/             decorations, CodeLens, hovers, holes, writers of lines
  src/build/              steps, errands, receipts, frames, callouts, loose ends
  src/views/              the extension side of the page and of the panel
  src/webview-side/       the Preact code of the page and of the panel
  src/test/unit/
  src/test/fixtures/
  spikes/                 the spikes of phase 0
  docs/
```

## 11. Code style

- The code follows the style of DataFlow: TypeScript with strict checks, and tabs. DataFlow has no lint tool other than the strict checks of TypeScript.
- Comments, commit messages and documents use ASD-STE100 Simplified Technical English.
- The rules, the checks of the tools and the state machine use no VS Code API. Thus the unit tests can call them directly.

## 12. Changes to the design canvas

Decision 10 changed these parts of the canvas on 14 November 2026. Each part that started Claude became a request that the user types in Claude Code. A dashed box with a speech mark shows each request.

| Board | Part of the old canvas | New part |
| --- | --- | --- |
| Stage 1 Brief | The button **Ask Claude for questions** | The request "Ask me questions about my brief." |
| Stage 1 Brief | The gate **Gather the facts** | The gate **The brief is ready**, then the request "Survey my brief." |
| Stage 1 Brief | Only a brief in a file | Also a brief in the chat. Claude gives the text of the user to Shotgun unchanged. |
| Stage 2 Survey | No way to change the survey | A request for a change, for example "Add a hook for the log line at the start of main()." |
| Stage 3 Order | The button **Survey the changed tasks** | The request "Survey my changed tasks." In Play, a dashed button shows the answer of Claude. |
| Stage 4 Plan | The button **Change the plan** | A request for a change, for example "Split step 4 into 2 steps." Then the request "Do step 1." |
| Stage 5 Frame | The buttons **Other shape** and **Hand the step to Claude** | The request "Give me a different frame for step 4." For a step of Claude, the user lowers its level, then asks "Do step 4." |
| Stage 5 Callouts | The buttons **Hint** and **Reply** | The request "Explain the callout on line 129." Claude puts its answer to a question at the line. |
| Stage 5 Errands | No request after an issue | The requests "Fix the issues of step 5." and "Do the loose ends." |
| Stage 5 Ledger | The button **Copy the message** | The message comes from Source Control, and the request "Check my commit message." starts the check. |

The gates stay buttons, because they record decisions of the user. A click on the hint ladder shows a hint that came with the frame, so it sends no request to Claude.

## 13. Effect on the gap list of DataFlow

- Item 40, prompts of an extension: not necessary. The skills of the plugin of Shotgun do this work.
- Item 41, a ripple of a base with no change of the side view: DataFlow 0.6.1 has it. The loose ends of phase 9 use it with the base of each step.
- The items 11 and 30 to 33 of the heat stay important for the risk levels of phase 5.
- Phase 1 found item 42: the MCP server and the token file can have different tokens at the first start of DataFlow. The order of the work puts it first.
- This plan and the spikes of phase 0 find no other new gap.

## 14. Risks

| Risk | Effect | Answer of the plan |
| --- | --- | --- |
| Claude names a wrong hook or place. | A step at the wrong place. | `submit_survey` and `submit_plan` check each place with the facts of DataFlow. |
| The heat is too low, for example because of the gaps 30 to 32. | Claude writes a step that the user must write. | The user can raise each level. The plan page shows `reachUnknown` and the signals. |
| Claude Code does not call the guard, or the guard fails. | A change outside of the scope. | The receipt shows each change since the base. |
| Claude does not use the skills. | Claude changes a file with no open step. | The guard denies the change. Its reason tells Claude to call `shotgun_start_step`. |
| The user changes a file while Claude changes it. | A conflict between the text editor and the disk. | Shotgun saves the scope before a step, and warns on an edit in an open scope. |
| A new version of Claude Code changes hooks, plugins or skills. | The guard or the skills stop. | The minimum version is 2.1.323 (phase 0). A test runs `claude plugin validate`. The panel shows the state of the connection. |
| VS Code does not run, or no DataFlow window has the project. | The hooks of Shotgun give "not connected" for each prompt and each file change. The guard is off (S2b). | P15 turns the plugin on only in the projects of Shotgun. In these projects, the message tells the user that the guard is off. |
| A tool result is too large. | Claude Code cuts the result at 25,000 tokens. | The tools give short data, and the read tools give parts on request. |
| Many tools in the list of Claude. | More tokens in each request of Claude Code. | Each MCP tool is a deferred tool, so it adds tokens only after Claude loads it (S3). Shotgun adds 19 tools with short descriptions. |
| A slow hook. | A delay before each file change. | S2 measured 6 to 7 ms for each guard hook, and 1.1 ms for each call through the bridge. The guard tool reads only the state in memory. |
| A format breaks a hole marker. | Shotgun loses a hole. | The parser accepts a marker on more than 1 line (S5). |
| DataFlow gives its server a different token at the first start (gap 42). | A new user has no tools of DataFlow and no guard of Shotgun in Claude Code. | Gap 42. Until the fix, the user starts the MCP server of DataFlow again. |
| A test with the CLI of Claude Code changes the data of Claude Code of the user. | A marketplace or a folder of a test stays in the setup of the user. | The rule for the hook tests in section 9. |
| Shotgun keeps the prompts of the user (decision 12). | A prompt can have private data. | Shotgun keeps only the last 20 prompts or 200,000 characters, only in memory, and only for its window. No file gets them. |
| A version of Claude Code does not fill `${prompt}` in the input of the hook. | `submit_brief` refuses each brief from the chat. | The tool tells Claude that it has no prompt. `scripts/test-claude.mjs` checks the brief from the chat. |
