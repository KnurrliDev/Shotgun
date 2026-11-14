# Shotgun: implementation plan

- Date: 13 November 2026, changed on 14 November 2026
- Status: a plan. Shotgun has no code yet.
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

The user gave decision 10 on 13 November 2026, and decision 11 on 14 November 2026. Decision 10 changes the buttons of the canvas that started Claude. Section 12 lists these changes.

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
| D1 | The 5 rules for the risk level that the user did not accept yet. The table "The risk level and the heat" in `dataflow-gaps-2.md` gives them. | Before phase 5 |
| D2 | The default voice of the callouts, and the time with no edit that makes a pause. | Before phase 8 |
| D3 | The users of Shotgun: only the user, a team, or a public release. This decision sets the release form and the documents. | Before phase 10 |

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
| `survey.json` | Claude | The facts, the tasks, the hooks and the questions of the survey, with the answers of the user. |
| `order.json` | User | The tasks in sequence, with the new texts, the new tasks and the tasks for later. |
| `plan.json` | Claude and user | The steps, the levels of the rules, the levels of the user and the notes of the user. |
| `build.json` | Shotgun | The state of each step, the holes, the receipts and the loose ends. |
| `lines.json` | Shotgun | The writer of each changed line. |
| `decisions.jsonl` | Shotgun | The ledger: 1 line for each decision of the user and for each deny of the guard. |

Each JSON file has a `version` field. Shotgun writes each file in 1 step, as `writeTextAtomic` of DataFlow does.

### 6.4 Tools of Shotgun

The MCP name of each tool starts with `shotgun_`. In Claude Code, the full name is `mcp__plugin_dataflow_dataflow__shotgun_<name>`. In Claude Code, each MCP tool is a deferred tool: Claude loads it with `ToolSearch` before its first call (S3). Thus each skill gives the full names of its tools.

| Tool | Kind | Stage | Function |
| --- | --- | --- | --- |
| `get_session` | read | all | The active task, the stage, the gates of the user, and the next work of Claude. |
| `get_order` | read | 3, 4 | The tasks in the order of the user. |
| `get_plan` | read | 4, 5 | The steps with their levels, writers, places and notes. |
| `get_step` | read | 5 | The current step, its scope, its kind, and the marks and notes of its receipt. |
| `get_callouts` | read | 5 | The open callouts with their facts. |
| `get_commit_message` | read | 5 | The commit message and the summary of the ledger. |
| `submit_brief` | submit | 1 | The brief that the user wrote in the chat, unchanged, and a short title of the task. |
| `submit_questions` | submit | 1 | The questions of Claude about the brief. |
| `submit_survey` | submit | 2 | The facts, the tasks, the hooks and the questions. |
| `submit_task_survey` | submit | 3 | The hooks and the needs of a rewritten task or of a new task. |
| `submit_plan` | submit | 4 | The steps of the plan. |
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
- **UserPromptSubmit hook:** a handler of type `mcp_tool` that calls `shotgun_session_context` (P14). Its text tells Claude about the active task, the stage and the gates.
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
            "input": { "event": "${hook_event_name}", "cwd": "${cwd}" },
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
| The loose ends | `getMemberSites`, `getCallers` |
| The callouts | `getThreads`, `getLogic`, `getHidden` and `getPlace` after `onDidParse` |
| The state of the engine | `engineState`, `engineError`, `onDidChangeEngineState` |
| The proof of a callout, after a click of the user | `showLine`, `setLens` |

Shotgun needs the release of DataFlow with the fixes of the 2 gap lists, for example 0.6.0. At the start, Shotgun reads `packageJSON.version` of DataFlow. With an older version, Shotgun shows the reason and stops.

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
| 2 Brief | The brief, the questions of Claude, the first gate | Small | Phase 1 |
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
- **Gate:** **The brief is ready**, when each part has text. The gate starts the scan of the call graph.
- **Skill:** `shotgun`: the stages, the contract, the tools, and the rule that Claude writes no text in the brief. Claude gives a brief from the chat unchanged.
- **Done when:** 2 new tasks go from the brief to stage 2. The first task has a brief in a file, and the second task has a brief from the chat.

### Phase 3: survey

- **Tool:** `submit_survey` with the facts, the tasks, the hooks and the questions. Each hook has a file, a line or a range of lines, a kind and a title.
- **Checks:** each file is in the project, and each line is in its file. `getPlace` gives the function of each hook, and `getHeat` with `lines` gives its heat. A hook in a type gets the facts of `getOutline`. Each task names hooks of the survey.
- **Heat:** until `isReachComplete` is true, the page shows "heat after the scan".
- **Page:** the tasks, the hooks, the facts, and the questions with a field for each answer. A part of the code shows the place of the selected hook.
- **Text editor:** each hook gets a decoration, and a hover with the facts of its line.
- **Skill:** `shotgun-survey`: read the brief, read the code through DataFlow, submit, and correct each problem.
- **Gate:** **Order the tasks**.
- **Done when:** the survey of the fixture `battery` of DataFlow shows 7 hooks with their heat.

### Phase 4: order

- **Page:** the order page of the canvas: move, rewrite, add, later and remove.
- **Tools:** `get_order` and `submit_task_survey`. A rewritten task or a new task has no survey until Claude surveys it.
- **Order check:** the needs from the survey give a warning for a task that comes before a task that it needs. The badge **Model** shows that the needs are words of Claude.
- **Panel:** the next request, for example "Survey my changed tasks".
- **Gate:** **Accept the order**. A task with no survey gets its survey at the start of the plan. The skill `shotgun-plan` has this rule.
- **Done when:** the user rewrites a task, adds a task, gets their surveys, and accepts the order.

### Phase 5: plan

- **Rules:** pure functions from the facts of DataFlow to a risk level. The tests use tables of facts and levels. The rules of D1 come into this phase.
- **Tool:** `submit_plan`. Each step names its task, its hooks and its places. A place is a file with lines, or a new file. Each task of the order has 1 step or more.
- **Levels:** Shotgun calculates the level of each step from the facts of each place. It waits for `isReachComplete`.
- **Page:** the plan page of the canvas. It shows the steps, and for the selected step its place, its heat, its rule, its level and the note of the user. The buttons **Lower**, **Raise** and **Rule value** change the level.
- **Text editor:** each step gets a decoration with the color of its level, and a CodeLens line.
- **New plan:** `submit_plan` can replace the plan before the gate. A level that the user changed stays with its step, if the step has the same id.
- **Gate:** **Accept the plan**. The levels of the user and their notes go into the ledger.
- **Done when:** the plan of the fixture gets the levels 3, 4, 5, 4, 2, 3, 1 and 1 from the rules.

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

### Phase 7: frames and hints

- **Frame:** at level 3, or at level 4 on a request of the user, Claude opens the step with the kind `frame`. Claude writes the frame into the file, with a marker in a comment for each hole.
- **Tool:** `submit_frame` with the holes. Each hole has its question and 4 hints: a nudge, a pointer with places, an example with a place and its code, and the answer. Shotgun checks that each marker and each place is there.
- **Text editor:** each hole gets a decoration with its question. Tab and Shift+Tab go to the next hole and to the hole before it.
- **Hints:** the panel and the hover show the next hint after a click. The answer fills the hole, and its lines are lines of Claude.
- **Done holes:** Shotgun counts a hole as done when its marker is not there and its line has code.
- **Skill:** `shotgun-frame`: write only the lines with no decision, put each decision into a hole, and give the 4 hints.
- **Done when:** step 4 of the fixture has a frame with 3 holes, their hints, and Tab.

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

### Phase 9: loose ends, ledger and commit message

- **Loose ends:** after each step, `getMemberSites` gives the functions that use a type with a new data member. It also gives each `switch` statement that does not handle a new enumerator. `getCallers` gives the callers of each changed function.
- **Loose ends of Claude:** Claude adds its loose ends with `submit_errand`. They show with the badge **Model**.
- **Hand to Claude:** the user can make a loose end into a new step of level 1 or 2. This is a decision of the user, and it goes into the ledger.
- **Ledger page:** the decisions from `decisions.jsonl`, the lines of each file for each writer, and the receipts that the user did not walk.
- **Commit message:** `get_commit_message` reads the input box of the repository. The user asks, for example "Check my commit message". Claude compares the message with the diff, and calls `submit_message_check`. The ledger page shows each point.
- **Copy:** the ledger page copies the decisions as Markdown for a pull request.
- **Done when:** the ledger of the fixture task shows the decisions, the writers of the lines, and the check of a message.

### Phase 10: release

- **Documents:** `README.md`, `docs/usage.md`, `docs/tools.md` with the tools and the skills, and `CHANGELOG.md`.
- **Package:** a script for the VSIX package, as in DataFlow.
- **Full test:** 1 task from the brief to the commit message, with Claude Code in a real project of the user. This test uses the Claude subscription of the user.
- **D3:** the release form and the documents for the users of Shotgun.

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
- Item 41, a ripple of a base with no change of the side view: still useful for the loose ends of phase 9. Until the fix, the loose ends come from `getMemberSites` and `getCallers`.
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
