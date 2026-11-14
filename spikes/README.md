# Spikes of phase 0

These files are the spikes of phase 0 of Shotgun. They are not a part of Shotgun. `../docs/p0-spike-results.md` gives the results.

| File | Function |
| --- | --- |
| `run.mjs` | The runner. Each subcommand does 1 part of the spikes. |
| `ext/` | The spike extension for the test build of VS Code. It adds 3 tools to the MCP server of DataFlow, 2 panels and the commands of the holes. |
| `plugin/` | The spike plugin for Claude Code: the guard hook, the context hook, a SessionStart command hook and 1 skill. |

## Prerequisites

- DataFlow in `../../DataFlow`, or in the folder of the environment variable `DATAFLOW_REPO`.
- In DataFlow: the folder `out`, the engine `build/engine/dataflow-engine.exe`, and a test build of VS Code in `.vscode-test`.
- The VS Code extension of Claude Code with its CLI. The environment variable `CLAUDE_EXE` can give a different CLI.
- A login of the CLI of Claude Code.
- clang-format in `C:/Program Files/LLVM/bin`, or in the path of the environment variable `CLANG_FORMAT`.
- Node.js 22 or a later version.

## Procedure

NOTE: The subcommands `claude` and `probe` use the Claude subscription of the user. A probe stops before the answer of the model.

CAUTION: THE CLI USES THE CONFIG FOLDER OF THE USER. A MARKETPLACE FROM `SPIKE_SETTINGS` OR FROM THE PROJECT SETTINGS GOES INTO THE PLUGIN DATA OF CLAUDE CODE OF THE USER. AFTER THE PLUGIN TEST, RUN `claude plugin marketplace remove shotgun-spike-market`. ALSO REMOVE THE EMPTY FOLDERS OF THE RUN IN `~/.claude/plugins/data` AND `~/.claude/projects`.

1. Select a new run folder outside of the repository, for example in the temp folder of the user.
2. Run `node spikes/run.mjs setup <run folder>`.
3. Run `node spikes/run.mjs start <run folder>`. A window of the test build of VS Code opens.
4. Run `node spikes/run.mjs s1 <run folder>` for S1.
5. Run `node spikes/run.mjs s5 <run folder>` for S5. Do not touch the window while the runner sends the keys.
6. Run `node spikes/run.mjs wait <run folder> ready-for-claude`. Then the log has the result of S6.
7. Run `node spikes/run.mjs claude <run folder> <name> <prompt>` for the prompts `s2`, `s3` and `s4` of the table.
8. Run `node spikes/run.mjs latency <run folder>` for the delay of the guard.
9. Run `node spikes/run.mjs receipt <run folder>` for the receipt of S2.
10. Run `node spikes/run.mjs stop <run folder>`. This subcommand stops the window and all processes of the run.
11. Run the prompt `s2b` with the window closed.

The prompts are test data. Use them without a change, so that the results stay comparable.

| Name | Prompt |
| --- | --- |
| `s2` | `Do these 2 steps. Step 1: with the Edit tool, add the line 'spike edit' at the end of notes/inside.txt. Step 2: with the Edit tool, add the line 'spike edit' at the end of outside.txt. Use no other way to change a file. At the end, tell for each file if the change succeeded, and quote each message that blocked a change.` |
| `s3` | `Survey my brief.` |
| `s4` | `Which Shotgun task ids and stages does your context give you? Do not call a tool. Write 1 line for each source of this data.` |
| `s2b` | `With the Edit tool, add the line 'spike edit' at the end of outside.txt. Use no other way to change a file. At the end, tell if the change succeeded, and quote each message that blocked the change or that came from a hook.` |

## Other subcommands and variables

| Item | Function |
| --- | --- |
| `probe <run folder> [strict\|local]` | Starts Claude Code until its init message, and then stops it. `strict` adds `--strict-mcp-config`. `local` turns the spike plugin on in the local settings of the project. |
| `log <run folder> [kind]` | Shows the log of the spike extension. |
| `SPIKE_VSCODE_BUILD` | Selects a different test build of VS Code, for example `1.143.1`. |
| `SPIKE_SETTING_SOURCES`, `SPIKE_SETTINGS` | Change the settings of Claude Code for the variants of the plugin test. |

## Files of a run

| File | Content |
| --- | --- |
| `spike.log` | 1 JSON line for each result of the spike extension. |
| `claude-<name>.jsonl` | The stream of each run of Claude Code. |
| `s1.png`, `s5.png` | The screenshots of S1 and S5. |
| `s5-<style>.cpp` | The frame after each style of clang-format. |
