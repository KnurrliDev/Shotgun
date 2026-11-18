# Develop Shotgun

This document tells how to change, run, test and release the code of Shotgun. [Install Shotgun](install.md#build-from-the-source-code) tells how to get the necessary software and the source code.

- [Files](#files)
- [Install the dependencies](#install-the-dependencies)
- [Run the extension](#run-the-extension)
- [Do the tests](#do-the-tests)
- [Make a release](#make-a-release)
- [Publisher ID](#publisher-id)

## Files

| File | Function |
| --- | --- |
| `package.json` | The extension manifest: the commands, the views, the settings, the keys and the npm scripts |
| `src/extension.ts` | The start of the extension. VS Code calls `activate()`. The class `Shotgun` connects the stage files, the views, the text editor, DataFlow and Claude Code. |
| `src/session/` | The tasks, the stages, the gates, the stage files and the decisions. `store.ts` reads and writes the folder `.shotgun`. `risk.ts` has the rules of the risk levels, and `review.ts` the rules of the review of stage 6. |
| `src/tools/` | The tools of Shotgun for the MCP server of DataFlow, and their checks. `tools.ts` has the names, the descriptions and the parameters of the tools. `guard.ts` has the rules of the guard. |
| `src/claude/` | The plugin of Shotgun for Claude Code, and the settings of the connection. `plugin.ts` makes `plugin.json` and the hooks. |
| `src/dataflow/` | The copy of `dataflow-api.d.ts` of DataFlow, the link to DataFlow and the check of its version |
| `src/editor/` | The text editor: the hooks, the steps, the holes, the writers of the lines and the callouts |
| `src/git/` | The commit message from Source Control |
| `src/views/` | The extension side of the sidebar, the panel and the page. `protocol.d.ts` has the messages between the extension and the webviews. |
| `src/webview-side/` | The code of the panel and the page in the webview, with Preact |
| `src/test/unit/` | The unit tests |
| `plugin/skills/` | The skills of the plugin for Claude Code |
| `scripts/` | `build-webviews.mjs` bundles the panel and the page with esbuild. `package-vsix.mjs` makes the VSIX package. `test-claude.mjs` is the test with Claude Code. `measure-review.mjs` measures the review skill on the cases of `review-cases.mjs` and `review-cases-hard.mjs`. `harness.mjs` has the shared parts of these 2 scripts. |
| `media/` | The icon of Shotgun |
| `spikes/` | The tests of phase 0 |
| `docs/` | The documents of Shotgun |
| `implementation-plan.md` | The plan of Shotgun: the decisions, the phases and the status of each phase |
| `dataflow-gaps.md`, `dataflow-gaps-2.md` | The gaps of DataFlow that Shotgun found, with their fixes |
| `open-editor.bat` | Opens VS Code with the Shotgun extension of this folder |
| `.vscode-test.mjs` | The settings of the `vscode-test` command |
| `.vscodeignore` | The files that the `.vsix` package does not contain |

## Install the dependencies

1. Open a terminal in the root folder of the repository.
2. Type `npm install`.

## Run the extension

1. Install DataFlow 0.6.2 or later in VS Code, or get the repository of DataFlow.
2. Type `npm run compile`.
3. Open the root folder of the repository in VS Code.
4. Push F5. The configuration "Run Extension" opens a second window with Shotgun. The title of the second window starts with "[Extension Development Host]".
5. In the second window, open a C or C++ project with a compile database.

To open the second window with no debugger, run `open-editor.bat` in the root folder of the repository. The script compiles Shotgun, and opens VS Code with Shotgun. If VS Code has the second window already, it loads the window again with the new code. To open a folder in the window, give the folder as an argument, for example `open-editor.bat C:\Projects\App`.

The window uses the DataFlow extension of VS Code. To use DataFlow from its repository, set the environment variable `DATAFLOW_REPO` to its folder. The script then compiles DataFlow too. If VS Code runs as administrator, run the script as administrator.

## Do the tests

| Command | Tests |
| --- | --- |
| `npm test` | The unit tests in a test build of VS Code. The tests load DataFlow from `../DataFlow`, or from the folder of the environment variable `DATAFLOW_REPO`. If the environment variable `CLAUDE_EXE` gives the CLI of Claude Code, a test also checks the plugin with `claude plugin validate`. |
| `node scripts/test-claude.mjs <run folder>` | The test with Claude Code. Type `npm run compile` first. Use a new run folder outside of the repository. |
| `node scripts/measure-review.mjs <run folder>` | The measurement of the review skill (P36). Type `npm run compile` first. Options: `--efforts low,medium,high`, `--runs 3`, `--group basic`, `--group hard`, `--cases B1,C1` and `--model sonnet`. With `--report`, the script makes the results again from the runs in the run folder, with no new run. The script uses the test build and the fixture of `../DataFlow`, or of the folder of `DATAFLOW_REPO`. Set `DATAFLOW_EXTENSION` to use a different extension of DataFlow, for example an extracted VSIX. |
| `node scripts/measure-review.mjs --check` | Tests the cases with no run of Claude Code. Each case must apply to the fixture, and each place of a bug must be there. The project must compile. The options `--group` and `--cases` select the cases. Clang 20 or later is necessary. If `clang++` is older, set `CLANG_EXE` to a newer Clang. |

`scripts/test-claude.mjs` does 1 full task in a copy of the fixture `battery` of DataFlow, from the brief to the end of the review:

- 2 tasks go from the brief to stage 2. The gate of the empty brief is on, and the sidebar shows the task. Task 1 has a brief in a file, and task 2 has a brief from the chat. The guard denies a change in stage 1.
- Claude makes the survey of task 1. A click on a hook shows it in DataFlow. Task 1 returns to stage 1 and comes back with the same survey, and then goes to stage 3.
- On the order page, the test changes the order. Claude surveys the changed tasks, and task 1 goes to stage 4.
- Claude makes the plan, the test changes the levels, and task 1 goes to stage 5.
- In the build, a run of Claude Code with no plugins stands in for the user, and writes step 1. Claude does step 2 and gives a receipt. The test puts an issue on a change, Claude fixes it, and the test accepts the receipt.
- The test sets step 3 to level 4, and asks for a frame. Claude gives the frame, and the test fills the holes with Tab and the hints.
- In step 4, the test writes a line with a race. The race shows as a callout, and Claude explains it and answers a question about a line.
- The test ends step 4, hands a loose end to Claude, and writes a commit message. Claude checks the message.
- The test passes "The build is done", selects the effort and the focus of the review, and copies the review prompt. A new run of Claude Code reviews the task with subagents. The test checks a refusal of Shotgun through the bridge.
- The issues are steps. A run of Claude Code with no plugins writes the fix of the first step for the user. For Claude, the test takes a step with no line near the lines of the first step, because 1 fix can remove 2 issues. The test lowers this step to level 2, and Claude fixes it with a receipt. "Not a problem" closes 1 issue.
- Round 2 reviews the fixes, and checks each fixed issue in a subagent. A correct fix stays fixed. An issue with a wrong fix comes again with its id. The closed issue does not come again. The test ends the task, and Claude checks the commit message again.

NOTE: `scripts/test-claude.mjs` uses the Claude subscription of the user for 17 runs of Claude Code. It does not change the settings of the user.

`scripts/measure-review.mjs` measures the review skill on the 22 cases of `scripts/review-cases.mjs` and `scripts/review-cases-hard.mjs` in a copy of the fixture `battery`. The group `basic` has 8 cases with 1 known bug each, and 4 cases with no bug. The group `hard` has 7 cases with known bugs, and 3 clean cases that look wrong. For each case, effort and run, it makes a task in stage 6 and runs the review prompt in a new run of Claude Code.

An issue finds a bug if 2 conditions are true. Its place must be near a line of the bug, and its title or summary must name the defect. A test gap never finds a bug. The score does not count a case with the field `invalid`.

Each other issue is a test gap, a pre-existing problem, or an issue of the kind other. Each brief asks for a test, and no change has a test, so a test gap is a correct issue. An issue of the kind other is a false alarm, or a real problem that the case did not plan. The precision is the issues of the known bugs, divided by the issues of the known bugs and of the kind other.

The run folder gets `results.jsonl`, `results.md` and `summary.json`. They give the recall, the precision, the time, the subagents and the cost of each effort. They also list each issue of the kind other, and each issue at the place of a known bug that names a different defect, so that you can examine them. With a run folder that has `results.jsonl`, the script continues with the runs that are not done.

NOTE: `scripts/measure-review.mjs` uses the Claude subscription of the user for each run: 198 runs with the default options, about 5 hours. The option `--group hard` has 90 runs. It does not change the settings of the user.

## Make a release

A release is a VSIX package on the GitHub page of the releases. The package is for all systems, because Shotgun has no program of its own. But Shotgun needs DataFlow, and the package of DataFlow is only for Windows x64.

1. Change the version in `package.json`, and write the changes of the version in `CHANGELOG.md`.
2. Type `npm run package`. The script `scripts/package-vsix.mjs` does these steps:
   - It removes the folder `out`. Thus the package has no files of an old build.
   - It runs `vsce package --no-dependencies`. vsce compiles the extension, and it writes `shotgun-<version>.vsix` into the root folder of the repository.
3. Install the VSIX in VS Code with DataFlow, and open a C or C++ project. Make sure that the log of Shotgun names the tools of Shotgun.
4. Do 1 full task with Claude Code in a real project, from the brief to the check of the commit message.
5. Commit the changes, and push them.
6. Make a tag for the version, and push the tag:

   ```bat
   git tag -a v0.1.0 -m "Shotgun 0.1.0"
   git push origin v0.1.0
   ```

7. On GitHub, open the releases of the repository, and click **Draft a new release**. Select the tag, write the changes of `CHANGELOG.md` as the notes, and attach the VSIX file. Then click **Publish release**.

The package has no `node_modules` folder, because the extension has no runtime dependencies. If you add a runtime dependency, remove the option `--no-dependencies` from the script, or bundle the dependency.

vsce changes the relative links of `README.md` in the package to links to the repository on GitHub, for example the links to the screenshots. Thus the files of these links must be on the branch `master` on GitHub.

## Publisher ID

The `publisher` value in `package.json` is `KnurrliDev`, so the extension ID is `KnurrliDev.shotgun`. VS Code updates an extension only with a VSIX that has the same extension ID. Thus do not change the publisher ID after a release.

Shotgun finds DataFlow with the extension ID `KnurrliDev.dataflow`. `extensionDependencies` in `package.json` and `src/dataflow/version.ts` have it.
