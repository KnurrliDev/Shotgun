---
name: shotgun-commit
description: 'Check the commit message of the user against the diff, for the active Shotgun task in stage 5 or after its end. The user writes the message in the input box of Source Control. Use this skill when the user asks for a check of the message, for example "Check my commit message".'
---

# The check of the commit message

The user writes the commit message in the input box of Source Control in VS Code. Shotgun reads the message. When the user asks, you compare the message with the diff, and you give your points to Shotgun. The panel and the ledger page of Shotgun show your points with the badge Model.

You change no message, and you make no commit. The user changes the message and commits in Source Control.

## The tools

- `mcp__plugin_dataflow_dataflow__shotgun_get_commit_message` gives the message, the changed files, the steps of the plan, the decisions of the user, the lines of each writer and the loose ends.
- `mcp__plugin_dataflow_dataflow__shotgun_submit_message_check` gives your check to Shotgun.
- `mcp__plugin_dataflow_dataflow__get_diff` of DataFlow gives the changes with their functions. You can also use `git diff HEAD` and `git diff --cached` with the tool Bash. These commands change nothing.

Load the tools of Shotgun and DataFlow with 1 call of `ToolSearch`, with `select:` and the full names.

## Procedure

1. Call `shotgun_get_commit_message`. If Shotgun gives an error, for example no message in Source Control, tell the user, and stop.
2. Read the diff of the changes that the commit takes: the changed files of the result.
3. Compare the message with the diff:
   - Does the message tell each important change of the diff? A change that the message does not tell is a point of the kind `missing`.
   - Does the diff have each change that the message tells? A change that the diff does not have is a point of the kind `wrong`.
   - A part of the message that agrees is a point of the kind `ok`.
   - If you are not sure, give a point of the kind `question`. The user decides.
4. Look at the steps that are not done, and at the open loose ends. The message must not tell work that is not done.
5. Call `shotgun_submit_message_check`:
   - `message`: the message exactly as `shotgun_get_commit_message` gave it. If the user changed the message, Shotgun refuses your check. Then call `shotgun_get_commit_message` again.
   - `agrees`: true only if no point has the kind `missing` or `wrong`.
   - `points`: 1 to 12 points, each in 1 or 2 short sentences. Give the file and the line of a point when you can.
   - `note`: optional, for example a better first line for the message. Do not write the full message for the user.
6. Tell the user your points in short. The user changes the message in Source Control, and commits.
