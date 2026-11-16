# The tools and the skills

Shotgun works with Claude Code in 2 ways:

- The plugin of Shotgun gives Claude Code 2 hooks and 7 skills. The hooks ask the guard before each file change, and give the context of the task with each prompt. The skills tell Claude how to do the work of each stage.
- The tools of Shotgun are in the MCP server of DataFlow. Claude reads the task with the read tools, and gives its results with the tools that start with `submit_`. Shotgun checks the data of each call.

[Install Shotgun](install.md#connect-to-claude-code) tells how to connect Shotgun to Claude Code.

- [The connection](#the-connection)
- [The requests for Claude](#the-requests-for-claude)
- [The skills](#the-skills)
- [The hooks](#the-hooks)
- [The tools](#the-tools)
- [Security and privacy](#security-and-privacy)

## The connection

Shotgun adds its tools to the MCP server of DataFlow with the API of DataFlow. DataFlow puts `shotgun_` before the name of each tool. Claude Code gets the tools from the plugin of DataFlow, so the full name of a tool is for example `mcp__plugin_dataflow_dataflow__shotgun_get_session`. Thus the tools need only the connection of DataFlow to Claude Code.

The plugin of Shotgun is in the folder `.shotgun\claude` in your home folder. Claude Code loads it from this local marketplace, so the plugin needs no install. The plugin is on only in the workspace folders with a task of Shotgun.

At each start, the log of Shotgun names the tools, for example "DataFlow 0.6.2 has the tools of Shotgun: shotgun_get_session, …". Run **Shotgun: Show Log** to see the log.

## The requests for Claude

You type each request in Claude Code. After each gate, the panel of Shotgun shows the next request. Claude loads the skill for the request:

| Stage | Request, for example | Skill |
| --- | --- | --- |
| 1 Brief | "Ask me questions about my brief." | `shotgun` |
| 1 Brief | A brief in the chat, and "Give this brief to Shotgun." | `shotgun` |
| 2 Survey | "Survey my brief." | `shotgun-survey` |
| 3 Order | "Survey my changed tasks." | `shotgun-survey` |
| 4 Plan | "Make the plan." or "Split step 2 into 2 steps." | `shotgun-plan` |
| 5 Build | "Do step 5." or "Fix the issues of step 5." | `shotgun-errand` |
| 5 Build | "Give me a frame for step 4." or "Give me a different frame for step 4." | `shotgun-frame` |
| 5 Build | "Explain the callout on line 129." or "Does the lambda on line 95 copy charge?" | `shotgun-explain` |
| 5 Build | "Do the loose ends." | `shotgun-errand` |
| 5 Build, or after the end of the task | "Check my commit message." | `shotgun-commit` |

## The skills

| Skill | Work |
| --- | --- |
| `shotgun` | The contract of Shotgun: the active task, the 5 stages, the guard and the gates. Also a brief from the chat, and the questions about the brief. |
| `shotgun-survey` | The survey of the brief in stage 2: the tasks, the hooks, the facts and the questions. Also the survey of the changed tasks in stage 3. |
| `shotgun-plan` | The steps of the plan in stage 4, in the sequence of your order, with the open decisions of each step. |
| `shotgun-errand` | A step of Claude in stage 5: Claude opens the step, changes only the files of its scope, and gives the receipt. The receipt has its choice for each open decision. Also the fixes after a receipt, and the loose ends that you hand to Claude. |
| `shotgun-frame` | The frame of a step in stage 5: all lines of the step, and a hole with 4 hints for each open decision. |
| `shotgun-explain` | The words of Claude for a callout, and the answer to your question about a line. Claude changes no code. |
| `shotgun-commit` | The check of your commit message against the diff. Claude changes no message, and makes no commit. |

The skills tell Claude that only you pass a gate and change a risk level. Claude does a stage again only when you ask.

## The hooks

| Hook | Time | Tool | Function |
| --- | --- | --- | --- |
| PreToolUse | Before Edit, MultiEdit, Write and NotebookEdit | `shotgun_guard` | The guard decides about the file change. A deny gives the reason to Claude, and the ledger records it. |
| UserPromptSubmit | Before each prompt | `shotgun_session_context` | Gives the stage of the active task and the next work to Claude. Shotgun keeps the prompt in memory for the check of a brief from the chat. |

The hooks have the type `mcp_tool`: Claude Code calls the tool in the MCP server of DataFlow. If VS Code does not run, the MCP server does not answer, and Claude Code continues the change. [The guard](usage.md#the-guard) tells the limits of the guard.

## The tools

Each tool gives its result as JSON. If the data of a call has problems, the tool gives all problems in 1 list, and changes nothing. Then Claude corrects the data, and calls the tool again.

These rules apply to the parameters of all tools:

- A file is relative to the first folder of the project, or absolute.
- Lines are `[first, last]`, from 1.
- The `code` of a place is a short text of the code in its lines, copied exactly. Thus the place stays with its code when the lines move.
- A step is its id, for example `S5`, or its number.

The tools change no line of your code. They write only the files in the folder `.shotgun` of the project. Only `start_step` saves the open text editors of the files of its scope.

| Tool | Stage | Kind | Function |
| --- | --- | --- | --- |
| [`get_session`](#get_session) | All | Read | The active task, its stage, the brief, the survey, the rule of the guard and the next work |
| [`submit_brief`](#submit_brief) | 1 | Write | A brief from the chat |
| [`submit_questions`](#submit_questions) | 1 | Write | The questions of Claude about the brief |
| [`submit_survey`](#submit_survey) | 2 | Write | The survey: the tasks, the hooks, the facts and the questions |
| [`get_order`](#get_order) | 3 and later | Read | Your order of the tasks |
| [`submit_task_survey`](#submit_task_survey) | 3 | Write | The survey of 1 changed task |
| [`get_plan`](#get_plan) | 4 and later | Read | The steps, their open decisions and their risk levels |
| [`submit_plan`](#submit_plan) | 4 | Write | The plan |
| [`get_step`](#get_step) | 5 | Read | A step, its decisions, its scope, and its receipt with your marks |
| [`start_step`](#start_step) | 5 | Write | Opens a step for an errand or a frame |
| [`submit_errand`](#submit_errand) | 5 | Write | Closes the step with the receipt |
| [`submit_frame`](#submit_frame) | 5 | Write | Closes the step with the holes of the frame |
| [`get_callouts`](#get_callouts) | 5 | Read | The callouts of the current step, and the answers on lines |
| [`submit_explanation`](#submit_explanation) | 5 | Write | The words of Claude for a callout |
| [`submit_line_answer`](#submit_line_answer) | 5 | Write | The answer to your question about a line |
| [`get_commit_message`](#get_commit_message) | 5 and later | Read | Your commit message, the changed files and the data of the ledger |
| [`submit_message_check`](#submit_message_check) | 5 and later | Write | The check of the commit message |
| [`guard`](#guard) | All | Hook | The PreToolUse hook calls it. Claude does not call it. |
| [`session_context`](#session_context) | All | Hook | The UserPromptSubmit hook calls it. Claude does not call it. |

### get_session

Gives the active task: its title, its stage of 5 and your gates. It gives the brief with its parts and the open questions, and the survey with your answers. It also gives the rule of the guard, the next work, and the other tasks of the project. In stage 5, it gives the current step and the next request. Claude calls this tool first for each request about Shotgun.

This tool has no parameters.

### submit_brief

Gives a brief that you wrote in the chat to Shotgun. Shotgun makes a new task in stage 1 for it, or fills the empty brief of the active task in stage 1. Shotgun never changes a brief with text.

| Parameter | Type | Function |
| --- | --- | --- |
| `title` | string | A short title of the task, a maximum of 200 characters. |
| `text` | string | The brief in your words, with no title line. Claude can add only the headings of the 5 parts and the list mark `- `. |
| `isNewTask` | boolean | Optional. True if you want a new task for this brief. |

Shotgun refuses each line that is not in one of your recent prompts. [A brief from the chat](usage.md#a-brief-from-the-chat)

### submit_questions

Gives the questions of Claude about the brief of the active task, in stage 1. The panel shows them. A new list replaces the open questions.

| Parameter | Type | Function |
| --- | --- | --- |
| `questions` | array | 1 to 10 questions. Each question has `text`, a maximum of 500 characters. Optionally, it has `part` (`goal`, `facts`, `specs`, `scope` or `done`) and `quote`: a short text of the brief, copied exactly. |

### submit_survey

Gives the survey of the brief, in stage 2. A new survey replaces the old survey. Shotgun refuses a fact with a read tool of DataFlow that Claude did not call in this stage.

| Parameter | Type | Function |
| --- | --- | --- |
| `tasks` | array | The tasks, in no sequence. Each task has `id` (for example `T1`), `title` and `hooks`: the ids of its hooks, empty for only new files. Optionally, it has `text`, `needs` (the ids of the tasks that it needs first) and `size`. |
| `hooks` | array | The hooks. Each hook has `id` (for example `H1`), `title`, `kind` (the new code at the place, for example "new check in solve()"), `file`, `lines` and `code`. |
| `facts` | array | Optional. The facts that the brief does not give. Each fact has `text`, `file`, `lines` and `tool`: the read tool of DataFlow that gave the fact, for example `get_threads`. |
| `questions` | array | Optional. The questions for you. Each question has `id` (for example `Q1`) and `text`. |

`size` is the estimate of Claude for the work of a task: `small`, `medium` or `large`.

### get_order

Gives your order of the tasks, in stage 3 and later. It gives the tasks in sequence, with their text, their hooks and the tasks that they need. `changed` gives the tasks of the plan with no survey for their text: a new task of yours, or a task with a new text.

This tool has no parameters.

### submit_task_survey

Gives the survey of 1 task of your order, in stage 3: its hooks and the tasks that it needs first. Claude changes no text and no place of a task.

| Parameter | Type | Function |
| --- | --- | --- |
| `task` | string | The id of the task, from `get_order`. |
| `text` | string | The text of the task now, copied from `get_order`. |
| `hooks` | array of strings | The ids of the hooks of the survey that the task changes. |
| `newHooks` | array | Optional. The new hooks of the task, as the hooks of `submit_survey`, with ids that the survey does not have. |
| `needs` | array of strings | The ids of the tasks of the order that this task needs first. |
| `size` | string | Optional. The estimate of Claude for the work of the task: `small`, `medium` or `large`. |
| `note` | string | Optional. A short note for you, for example the hooks that changed. A maximum of 500 characters. |

### get_plan

Gives the plan of the active task, in stage 4 and later. It gives the steps in sequence with their places, texts, checks and open decisions, and the risk level of each step. A decision has your answer, or the state `open`.

This tool has no parameters.

### submit_plan

Gives the plan, in stage 4: the steps in the sequence of your order. Each task of the plan needs 1 step or more. Shotgun gives each step a risk level from the facts of DataFlow and from its open decisions. A step with no open decision gets at most level 2. A new plan replaces the old plan. It keeps the state of each step of the build with the same id and the same title.

| Parameter | Type | Function |
| --- | --- | --- |
| `steps` | array | The steps. Each step has `id` (for example `S1`), `title`, `task`, `places`, `text`, `checks` and `decisions`. `task` is the id of the task of the order. `text` gives the goal and the result of the step, in 1 to 3 sentences, but no answer to an open decision. `checks` are 1 to 5 checks for you. Optionally, a step has `hooks` (the ids of the hooks of the survey) and `note`. |

A step has 1 to 8 places. A place has `file`. For a file that is there, it also has `lines` and `code`. It has `insert: true` if the new lines go next to these lines, and these lines do not change. An example is a new data member next to the other members. For a new file, a place has `new: true`, and no lines and no code.

`decisions` gives the open decisions of the step, 0 to 3. Each decision has `question`, and optionally `options`: up to 4 options that Claude sees, with no choice. Shotgun gives them the ids `D1` to `D3`. An empty list is a step with no open decision. [Open decisions](usage.md#open-decisions) tells their rules.

### get_step

Gives a step of the build, in stage 5. It gives the text, the places, the checks, the decisions, the level, the writer, the state and the scope of the step. It also gives the receipt of the step with your marks and notes: the issues and the questions.

| Parameter | Type | Function |
| --- | --- | --- |
| `step` | string | Optional. The step. Default: the current step. |

### start_step

Opens the current step of the build for an errand or a frame, in stage 5, before Claude changes a file. Shotgun saves the open text editors of the files of the scope, and DataFlow keeps their text as the base of the step. Then the guard lets Claude change these files. Claude calls this tool again after a receipt to fix your issues, or for a different frame. The step keeps its base.

| Parameter | Type | Function |
| --- | --- | --- |
| `step` | string | The step. |
| `kind` | string | Optional. `errand`: Claude writes the step, at level 1 or 2. `frame`: Claude writes a frame with holes for you, at level 3, or at level 4 after **I want a frame**. |

### submit_errand

Closes the open step after the changes of Claude, in stage 5. Shotgun gets the diff since the base from DataFlow. Each change in the diff needs a change in the receipt.

| Parameter | Type | Function |
| --- | --- | --- |
| `step` | string | The open step. |
| `changes` | array | The changes since the base. Each change has `file`, `lines` (in the text now), `title` (what the change does) and `check` (what you check). Optionally, it has `note`: a change that you did not ask for, a risk, or an answer to your question. |
| `looseEnds` | array | Optional. The places outside of the scope that the step can also need. Each loose end has `text`, and optionally `file` and `lines`. You decide about them. |
| `choices` | array | The choice of Claude for each open decision of the step. Each choice has `decision` (for example `D1`) and `choice`: the choice and its reason, in 1 or 2 sentences. Shotgun refuses a receipt with no choice for an open decision. |

### submit_frame

Closes the open frame step after Claude wrote the frame, in stage 5. Each open decision of the step is exactly 1 hole: a marker `/*@hole N: question */` in the place of the whole code of the decision. The frame has all other lines. Shotgun checks each marker, each place and each decision. Claude does not give the answers in the chat.

| Parameter | Type | Function |
| --- | --- | --- |
| `step` | string | The open step. |
| `holes` | array | The holes. Each hole has `n` (the number of its marker), `decision` and `question` (the same text as in the marker). `decision` is the id of its open decision, for example `D1`. A hole also has the 4 hints `nudge`, `pointer`, `example` and `answer`. |
| `note` | string | Optional. A short note for you: what the frame has, and the decisions that are holes. |

| Hint | Content |
| --- | --- |
| `nudge` | Hint 1: a question that shows the way, with no code. |
| `pointer` | Hint 2: where the facts for the decision are. It has `text` and `places`. Each place has `file` and `lines`. |
| `example` | Hint 3: code of the project that is a good example. It has `text` (why it is a good example), `file`, `lines` and `code`. |
| `answer` | Hint 4: 1 possible code in the place of the marker. You can write a different answer. |

Shotgun refuses a hole whose answer is only a type, a name, a literal or a list of parameters. It also refuses a hole whose answer is in the text of the step. With no open decision, a step gets no frame.

### get_callouts

Gives the callouts of the current step, in stage 5: the new facts of DataFlow on your lines. Each callout has its id, place, kind, title, the facts of the engine, its state and the words of Claude. The tool also gives your questions about lines with the answers.

This tool has no parameters.

### submit_explanation

Gives the words of Claude for a callout, in stage 5: 1 to 3 sentences about the effect of the facts of DataFlow. The panel shows them under the facts with the badge **Model**. Claude changes no code.

| Parameter | Type | Function |
| --- | --- | --- |
| `callout` | string | The id of the callout from `get_callouts`, for example `C2`. |
| `line` | integer | Or the line of the callout. |
| `text` | string | The words of Claude: 1 to 3 sentences. |

### submit_line_answer

Gives the answer of Claude to your question about a line, in stage 5. Shotgun adds the facts of DataFlow at the line, and shows the answer at the line. Claude changes no code.

| Parameter | Type | Function |
| --- | --- | --- |
| `file` | string | The file. |
| `line` | integer | The line of the question, from 1. |
| `question` | string | Your question, copied exactly from the prompt. |
| `answer` | string | The answer: 1 to 4 sentences. |

### get_commit_message

Gives the commit message from the input box of Source Control, in stage 5 or after the end of the task. It also gives the changed files, the steps of the plan, your decisions, the lines of each writer and the loose ends. Then Claude reads the diff, and gives its check.

This tool has no parameters.

### submit_message_check

Gives the check of your commit message against the diff. Claude changes no message, and makes no commit.

| Parameter | Type | Function |
| --- | --- | --- |
| `message` | string | The commit message, exactly as `get_commit_message` gave it. |
| `agrees` | boolean | True if the message agrees with the diff: no point is missing or wrong. |
| `points` | array | 1 to 12 points. Each point has `kind` and `text`, a maximum of 300 characters. Optionally, it has `file` and `line`. |
| `note` | string | Optional. A note for you, a maximum of 600 characters. |

| Kind | Point |
| --- | --- |
| `ok` | The message tells a change of the diff correctly. |
| `missing` | The diff has a change that the message does not tell. |
| `wrong` | The message tells a change that the diff does not have. |
| `question` | A question for you. |

### guard

The PreToolUse hook of the plugin calls this tool before each file change. The tool gives the decision of the guard, and the reason of a deny. Claude does not call it.

| Parameter | Type | Function |
| --- | --- | --- |
| `tool` | string | The tool of Claude Code, for example `Edit`. |
| `file` | string | The file that the tool changes. |
| `cwd` | string | The folder of the session of Claude Code. |

### session_context

The UserPromptSubmit hook of the plugin calls this tool before each prompt. The tool gives the stage of the active task and the next work to Claude. Claude does not call it.

| Parameter | Type | Function |
| --- | --- | --- |
| `event` | string | The name of the event of the hook. |
| `cwd` | string | The folder of the session of Claude Code. |
| `prompt` | string | Your prompt. Shotgun keeps your last 20 prompts in memory for the check of a brief from the chat. |

## Security and privacy

- Shotgun sends no data to a server. Claude Code gets the data of the tools through the MCP server of DataFlow on your computer. Claude Code sends it to the model as a part of the session. [Security and privacy of DataFlow](https://github.com/KnurrliDev/DataFlow/blob/master/docs/tools.md#security-and-privacy) tells about the MCP server.
- Shotgun keeps your last 20 prompts only in memory, and only for its window. No file gets them.
- The guard helps you, but it is not a security boundary. [The guard](usage.md#the-guard) tells its limits.
- The connection changes the settings of Claude Code. [Connect to Claude Code](install.md#connect-to-claude-code) tells each change.
