# Phase 0: results of the spikes

Date: 14 November 2026

This document gives the results of the 6 spikes of phase 0 in `implementation-plan.md`. It also gives the result of 1 more test: the plugin of Shotgun on in only 1 project.

## Summary

- S1, S2, S3, S5 and S6 passed.
- S4 failed in its planned form. Claude Code does not run a hook of type `mcp_tool` at SessionStart. A UserPromptSubmit hook of type `mcp_tool` passed in its place.
- S5 found 1 change: a narrow format can break a long hole marker into 2 lines. The parser must accept this form.
- The test of the plugin settings found a better form: the plugin of Shotgun is on only in the projects of Shotgun.
- The plan gets 2 new proposals, P14 and P15. The section "Changes to the plan" gives all changes.
- The spikes found no new gap in DataFlow.
- No decision of the user is necessary before phase 1.

## Setup

| Part | Version or form |
| --- | --- |
| VS Code | The test builds 1.146.0 and 1.143.1 in the folder `.vscode-test` of DataFlow |
| DataFlow | 0.6.0, commit `ec0141c` of `master`, from its repository folder |
| Claude Code | 2.1.323, the CLI of the VS Code extension of Claude Code, in print mode with the model `sonnet` |
| clang-format | 19.1.0 |
| Project | A copy of the fixture `battery` of DataFlow, with a git repository and a compile database |
| Engine of DataFlow | 8 threads, with the setting `dataflow.engine.maxThreads` |

The spikes did not change the settings of the user:

- The test build of VS Code had its own folder for the user data and its own folder for the extensions.
- The environment variables `DATAFLOW_MCP_REGISTRY` and `CLAUDE_CONFIG_DIR` moved the registry of DataFlow and its Claude settings into the run folder.
- The runs of Claude Code used `--setting-sources project` and `--plugin-dir`. Thus they did not load the user settings of Claude Code.
- The option `--no-session-persistence` kept the runs out of the session history of the user.

Correction, 14 November 2026: the settings files of the user did not change, but the plugin data of Claude Code of the user changed. The CLI uses the login and thus the config folder of the user:

- The probes V2 and V3 added the marketplace `shotgun-spike-market` to `~/.claude/plugins/known_marketplaces.json`, and its plugin to `installed_plugins.json`.
- The runs with `--plugin-dir` made empty folders in `~/.claude/plugins/data` and `~/.claude/projects`.
- Phase 1 found these changes and removed them. The rule for the hook tests in section 9 of the plan prevents them now.

The spikes used the Claude subscription of the user for 4 runs with an answer of the model. 5 probes stopped at the init message of Claude Code, before the answer of the model.

`spikes/README.md` tells how to do the spikes again. `spikes/run.mjs` is the runner, `spikes/ext` is the spike extension, and `spikes/plugin` is the spike plugin.

## Results

| Spike | Result | Main data |
| --- | --- | --- |
| S1 Panel | Pass | `viewsContainers.secondarySidebar` puts the panel into the secondary side bar of VS Code 1.143.1 and 1.146.0. |
| S2 Guard | Pass | A deny of `shotgun_guard` stopped the edit. The hook took 6 to 7 ms. With VS Code closed, the guard is off. |
| S3 Skills | Pass | The request "Survey my brief." loaded the skill. Claude loaded the MCP tool with `ToolSearch` first. |
| S4 Session | Fail, with a replacement | No hook of type `mcp_tool` at SessionStart. A UserPromptSubmit hook gave the context in 5 ms. |
| S5 Holes | Pass, with 1 change | Tab and Shift+Tab move between the holes. A narrow format breaks a long marker into 2 lines. |
| S6 Receipt | Pass | `getDiff` with the base `mark:s6` gave the changed line with its function and its heat. |
| Plugin in 1 project | Pass | Claude Code loaded the plugin from a marketplace in a trusted scope, with the plugin on in the local settings of the project. |

### S1 Panel

**Question:** can an extension put a webview view beside the text editor?

**Data:**

- The spike extension had 2 view containers. Container A was under `viewsContainers.secondarySidebar`, and container B was under `viewsContainers.activitybar`.
- VS Code 1.146.0 and 1.143.1 showed container A in the secondary side bar. The command `workbench.view.extension.<id>` opened each container.
- The webview views of the 2 containers showed their HTML. The image `images/p0-panels-and-holes.png` shows panel A on the right side.
- The documentation of the contribution points that the spike used lists only `activitybar` and `panel`. The logs of VS Code had no message about `secondarySidebar`.
- In the first run, the 2 views stayed empty with a progress icon. The function `activate` waited for all spikes, and VS Code shows a view only after `activate` returns.

**Effect on the plan:**

- The panel of Shotgun goes into the secondary side bar with `viewsContainers.secondarySidebar`.
- `engines.vscode` of Shotgun becomes `^1.143.0`. The spike did not test a VS Code before 1.143.1.
- The function `activate` of Shotgun returns at once. Long work starts after it.

### S2 Guard

**Question:** does a hook of type `mcp_tool` in a local plugin call a tool of `registerTools`? Does a deny stop an edit?

**Data:**

- The spike plugin had a PreToolUse hook of type `mcp_tool` for `Edit|MultiEdit|Write|NotebookEdit`. The hook called `shotgun_guard` on the server `plugin:dataflow:dataflow`.
- The input `{"tool": "${tool_name}", "file": "${tool_input.file_path}", "cwd": "${cwd}"}` arrived with the values of the edit.
- The scope of the test was the folder `notes`. For `notes/inside.txt`, the tool gave `{}`, and the edit continued.
- For `outside.txt`, the tool gave a deny with a reason. The file did not change. Claude got the text "PreToolUse:Edit hook error:" and then the reason.
- Claude told the user about the deny. It did not try a different way to change the file.
- The hook took 6 to 7 ms, from its start to its result in the stream of Claude Code.
- A direct call of `shotgun_guard` through the bridge took 1.1 ms as the median of 30 calls, and 1.7 ms as the maximum.
- The bridge gave its answer to `initialize` 53 ms after its start.
- After the run, `getDiff` with the base `mark:s2` and `allFiles` gave only the edit of Claude: `notes/inside.txt`, line 2, 1 added line.

**S2b, with VS Code closed:**

- The status of the server `plugin:dataflow:dataflow` was `failed`. The bridge gave the reason "No VS Code window runs the DataFlow MCP server".
- Each hook of type `mcp_tool` gave the message "MCP server 'plugin:dataflow:dataflow' not connected". Claude Code continued the edit, and `outside.txt` changed.
- Thus the guard is off when VS Code does not run. Section 6.6 of the plan gives this behavior.
- The registry kept the window file of the stopped window. The bridge found no live window, and gave the correct reason.

**Effect on the plan:** the form of the guard hook stays. The delay of the guard is not a risk.

### S3 Skills

**Question:** does a request in words load a skill of the local plugin?

**Data:**

- The request "Survey my brief." loaded the skill `shotgun-spike:shotgun-survey` through the tool `Skill`.
- In Claude Code 2.1.323, each MCP tool is a deferred tool. Before the first call of a tool, Claude calls `ToolSearch` with `select:` and the full name of the tool.
- The skill gave only the end of the tool name. Claude found the full name, called the tool, and gave the marker of the tool.
- The run had 5 turns and took 7.2 s.

**Effect on the plan:**

- Each skill gives the full MCP names of its tools. Then Claude can load them with 1 call of `ToolSearch`.
- A deferred tool adds no tokens to a request until Claude loads it. Thus the risk of many tools becomes smaller.
- The hook tools `shotgun_guard` and `shotgun_session_context` are also in the list of deferred tools. Their descriptions tell Claude not to call them.

### S4 Session

**Question:** does a SessionStart hook of type `mcp_tool` give its text to Claude?

**Data:**

- Claude Code 2.1.323 does not run a hook of type `mcp_tool` at SessionStart. It gave the message "mcp_tool hooks are not available for the 'SessionStart' hook event (no MCP client context)".
- **Alternative A:** a UserPromptSubmit hook of type `mcp_tool` called `shotgun_session_context`. The input was `{"event": "${hook_event_name}", "cwd": "${cwd}"}`. Claude got the text of the tool. The hook took 5 ms.
- The tool put the name of the event from its input into `hookEventName` of `hookSpecificOutput`, next to `additionalContext`.
- **Alternative B:** a SessionStart hook of type `command` ran a script with the runtime of VS Code. The script read `.shotgun/active.json`, and Claude got its text. The hook took 118 to 144 ms.
- The command of alternative B was `ELECTRON_RUN_AS_NODE=1 "<Code.exe>" "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js"`. Claude Code ran it on Windows with no change.
- Alternative B also worked with VS Code closed. Alternative A then gave the message "not connected", and the prompt continued with no context.

**Effect on the plan:** proposal P14 uses alternative A. The context comes with each prompt, so Claude sees each gate that the user recorded after the last prompt. With no active task, the tool gives `{}`, and Claude gets no text. Alternative B stays a possible fallback.

### S5 Holes

**Question:** do the hole markers stay after a format? Do Tab and Shift+Tab move between them?

**Data:**

- The frame had 3 markers of the form `/*@hole N: question */`. The decorations showed each hole. The image `images/p0-panels-and-holes.png` shows them.
- The runner sent Tab 3 times and Shift+Tab 1 time to the window. The selection moved to the holes 1, 2, 3 and 2. The text did not change.
- The keybinding of the extension has the clause `editorTextFocus && shotgunSpike.inFrame`. It overrides the Tab of the text editor.
- clang-format 19.1.0 kept the 3 markers with the style LLVM, the style Google and the `.clang-format` of DataFlow.
- With `ColumnLimit: 40`, clang-format broke the 2 long markers into 2 lines. It added ` * ` at the start of each second line.
- With `ReflowComments: false`, the markers stayed.
- The `C/C++` extension and clangd use clang-format for a format. The spike did not test these 2 extensions directly.

**Effect on the plan:**

- The form of the marker stays. The parser accepts a marker on more than 1 line. It removes the ` * ` at the start of each line of the question.
- A frame with open holes is not correct C++, for example `if (/*@hole 1*/)`. The compiler and the engine can show errors until the user fills the holes. Phase 7 tests the effect on the engine and on the callouts.

### S6 Receipt

**Question:** does `getDiff` with the base of a mark give the changes on the disk, with their functions and their heat?

**Data:**

- `markBase({ name: 's6', paths: ['src'] })` kept 5 files with 9,732 bytes.
- The spike changed `src/battery.cpp` on the disk, as Claude Code does. `getDiff({ base: 'mark:s6', allFiles: true })` gave 1 hunk: line 12 with 1 added line.
- The hunk was in `electricity::power_ctrl::best_preset`. Its heat was 22, in the band cool, with `isReachComplete` true.
- `deleteMark({ name: 's6' })` removed the mark.
- `markBase` also accepts a file, for example `outside.txt` in S2.
- For a file that is not C or C++, `getDiff` gives the hunks with `isCpp` false, with no function and no heat.

**Effect on the plan:** the receipt uses the fields of `getDiff`. They are the file, the hunk id, the lines, and the number of added and removed lines. They are also the functions, and the heat with its band and `isReachComplete`.

### Plugin in 1 project

**Question:** can Shotgun turn its plugin on in only 1 project?

**Reason:** a plugin in the user settings runs its hooks in each project. In a project with no DataFlow window, each prompt and each file change then gives the message "not connected".

**Data:** 3 probes stopped at the init message of Claude Code.

| Variant | Marketplace in | Plugin on in | Result |
| --- | --- | --- | --- |
| V1 | The project settings | The local settings of the project | Not loaded, with no message |
| V2 | `--settings`, a trusted scope | The local settings of the project | Loaded, with the skill and the hooks |
| V3 | `--settings` | `--settings` | Loaded |

Claude Code did not load a marketplace from the project settings. Such a marketplace probably needs the trust of the user first. The spike did not change the user settings, so V2 is the model for a marketplace in the user settings.

**Effect on the plan:** proposal P15. Shotgun writes the marketplace into the user settings, as DataFlow does. It turns the plugin on in `.claude/settings.local.json` of each workspace folder with a Shotgun task. Phase 1 tests this form with the user settings.

## Limits of the spikes

- The spikes used the CLI of Claude Code in print mode, not the panel of the VS Code extension. The extension uses the same CLI. Phase 1 must check the messages of the hooks in the panel.
- The spikes did not test a VS Code before 1.143.1.
- The plugin test used `--settings` in the place of the user settings.
- The spikes did not test the format of the `C/C++` extension and of clangd directly.

## Notes for the tests of Shotgun

- The option `--include-hook-events` with `--output-format stream-json` gives each start and each result of a hook. A test can check the guard and the context with it.
- The option `--strict-mcp-config` also removes the MCP servers of plugins. The tests of Shotgun cannot use it.
- The environment variable `ENABLE_CLAUDEAI_MCP_SERVERS=false` keeps the connectors of the claude.ai account out of a test run.
- The runner removed the environment variables `CLAUDE*` and `ANTHROPIC*` of the session that started it. Thus each run used the normal login of the CLI.

## Changes to the plan

| Section | Change |
| --- | --- |
| 3 Proposals | New: P14, the context with each prompt. New: P15, the plugin on in each project of Shotgun. |
| 6.1 Parts | The plugin of Shotgun is on in the local settings of each project of Shotgun. |
| 6.4 Tools | `session_context` gives the context for each prompt. The skills give the full tool names. |
| 6.5 Plugin | A UserPromptSubmit hook in the place of the SessionStart hook. The connection writes the settings of P15. |
| 6.6 Guard | The data of S2b. |
| 6.7 Text editor | The parser accepts a marker on more than 1 line. |
| 7 Prerequisites | Claude Code 2.1.323 or a later version. VS Code 1.143 or a later version. |
| 8 Phases | Phase 0 is done. Phase 1 gets `^1.143.0`, the rule for `activate`, and the settings of P15. |
| 9 Tests | Hook tests with `claude -p`, and the options of this document. |
| 14 Risks | The data of the spikes for 4 risks, and 1 new risk for the hole markers. |

## Effect on the gap list of DataFlow

The spikes found no new gap. These parts of DataFlow worked as their documentation tells: `registerTools`, `markBase`, `getDiff`, `deleteMark`, `scanCallGraph`, `getCallGraph`, the command `dataflow.claude.connect`, and the bridge.

## Decisions

No decision of the user is necessary before phase 1. P14 and P15 are proposals, and the user can change them before phase 1 starts.
