# Use Shotgun

This document tells how to do a task with Shotgun and Claude Code. [Install Shotgun](install.md) tells how to install Shotgun and connect it to Claude Code.

- [A task, step by step](#a-task-step-by-step)
- [The sidebar, the panel and the page](#the-sidebar-the-panel-and-the-page)
- [The brief](#the-brief)
- [The survey](#the-survey)
- [The order](#the-order)
- [The plan and the risk levels](#the-plan-and-the-risk-levels)
- [Open decisions](#open-decisions)
- [The build](#the-build)
- [Frames](#frames)
- [Callouts](#callouts)
- [Loose ends](#loose-ends)
- [The ledger and the commit message](#the-ledger-and-the-commit-message)
- [The review](#the-review)
- [Return to an earlier stage](#return-to-an-earlier-stage)
- [The guard](#the-guard)
- [Commands and keys](#commands-and-keys)
- [Settings](#settings)
- [Files](#files)

## A task, step by step

1. Run **Shotgun: Connect to Claude Code**. [Connect to Claude Code](install.md#connect-to-claude-code) tells what the connection changes.
2. Run **Shotgun: New Task**, or select **New Task…** in the sidebar of Shotgun. Give the title of the task. Shotgun opens `brief.md` with its 5 parts.
3. Start a new session of Claude Code in the project. Claude gets the context of the task with each prompt.
4. Write the brief in `brief.md`, or give the brief to Claude in the chat and tell Claude to give it to Shotgun. Each part of the brief is optional.
5. Optionally, tell Claude "Ask me questions about my brief." You can answer a question in the brief, and close it in the panel.
6. Select **The brief is ready** in the panel. The gate does not wait for a part of the brief or for an answer.
7. Tell Claude "Survey my brief." Claude reads the code, and gives the tasks, the hooks, the facts and its questions to Shotgun.
8. Read the survey on the page of Shotgun. Answer the questions of Claude on the page, or with **Shotgun: Answer Question**.
9. If the survey must change, tell Claude what to change. When the survey is correct, select **Order the tasks**.
10. On the order page, put the tasks in sequence. You can change the text of a task, add a task, and keep a task for later.
11. Tell Claude "Survey my changed tasks." Claude gives the hooks and the needs of each task with a new text, and of each new task.
12. When the order is correct, select **Accept the order**.
13. Tell Claude "Make the plan." Claude makes the steps in your sequence, and names the open decisions of each step. Shotgun gives each step a risk level.
14. Check the open decisions and the levels on the plan page. Answer a decision in words, or add a decision of yours. To change a level, select **Lower**, **Raise** or **Shotgun: Set Risk Level**. Write your reason in the note of the step.
15. When the plan is correct, select **Accept the plan**.
16. In stage 5, the panel shows the current step. The steps go in sequence.
17. For a step of Claude, tell Claude "Do step N." Claude changes the files of the step, and gives a receipt. The receipt also shows the choice of Claude for each open decision of the step.
18. Walk the receipt in the panel. Put a mark on each change: **OK**, **Issue** or **Question**. Write a note for Claude if necessary.
19. For an issue or a question, tell Claude "Fix the issues of step N." Then walk the new receipt.
20. Select **Accept the receipt**.
21. For a step of level 3, tell Claude "Give me a frame for step N." Each open decision of the step is a hole of the frame. Fill each hole. Then select **The step is done**.
22. For a step of yours, write its code. Then select **The step is done**. At level 4, you can select **I want a frame** first.
23. While you write a step, read the callouts of DataFlow on your lines. Tell Claude "Explain the callout on line N." for the words of Claude. Ask Claude about a line, for example "Does the lambda on line 95 copy charge?".
24. At the gate of each step, Shotgun gets the loose ends of the step from DataFlow. Hand a mechanical loose end to Claude, and tell Claude "Do the loose ends.".
25. After the last step, select **The build is done**. The task goes to stage 6, the review.
26. In the panel, select the effort and the focus of the review. Select **Copy the review prompt**, start a new session of Claude Code, and paste the prompt.
27. Work through the steps of the issues, as through the steps of the build. Close an issue that is not a problem with **Not a problem** and your reason.
28. After your fixes, copy the prompt of the next round into a new session. The next round checks the fixes.
29. Select **The task is done**.
30. Write the commit message in Source Control. Tell Claude "Check my commit message.". Then commit in Source Control.

At any time, click an earlier stage in the stage bar of the panel or of the page to return the task to that stage. You can also run **Shotgun: Return to a Stage...**.

## The sidebar, the panel and the page

Shotgun shows its data in 3 places:

- The sidebar of Shotgun in the activity bar: the tasks of the project and the commands.
- The panel of Shotgun in the secondary side bar: the stage, the next work, the gate, and the request for Claude Code. In stage 5, the panel has the tabs **Steps**, **Loose ends** and **Ledger**. In stage 6, it has the tabs **Review** and **Ledger**.
- The page of Shotgun in the editor area: the survey, the order, the plan, the review or the ledger of the active task.

The panel and the page have a stage bar with the 6 stages. A stage with a check mark is done. A click on an earlier stage returns the task to that stage.

A badge shows the source of a text:

| Badge | Source |
| --- | --- |
| **Model** | The words of Claude |
| **Engine** | The facts of DataFlow |
| **Rule** | The risk level of the rules of Shotgun |
| **You** or **Claude** | The writer of a stage or of a step |

### The sidebar

The icon of Shotgun in the activity bar opens the sidebar of Shotgun, as DataFlow has its sidebar:

- **New Task…** and the tasks of the project with their stages. A click on a task makes it the active task, and shows the panel.
- **Show Page**, **Open Brief**, **Show the Ledger** and **Return to a Stage…** for the active task.
- **Pause** or **Continue** for the guard.
- **Show Panel** for the panel of Shotgun in the secondary side bar.
- **Open Project Folder…** and **Recent Projects**: the last 10 folders with a task of Shotgun, from all windows. A click opens the folder in this window.
- **Claude Code**, with the state of the connection: a click connects Shotgun to Claude Code. And **Show Log**.

### Links to the code

A link to a place in the code shows the place in the side view of DataFlow, with its lines highlighted and a note. Shotgun uses only 1 side view:

- If the side view is open, it shows the place.
- If no side view is open, DataFlow opens 1 new side view beside the text editor.
- No text editor opens, also when a C or C++ file is open in the text editor.

The small pen button beside a link opens the place in the text editor. A place where you write opens in the text editor at once, and a pen icon comes before its name. These places are the places of a step of yours, and the holes and the places of a frame while you fill its holes.

The side view of DataFlow shows only C and C++ files, so a place in a different file opens in the text editor. The notes of Shotgun stay in 1 file: a place in a different file removes the notes of the last file.

## The brief

In stage 1, you write the brief in `brief.md` of the task. The brief has 5 parts, and each part is optional:

| Part | Content |
| --- | --- |
| Goal | The purpose of the change. |
| Facts | What is true in the code or in the product now, for example a limit, a thread or a known fault. |
| Specs | What the new code must do. |
| Not in scope | The work that is not a part of this task. |
| Done when | The tests or the checks that show that the task is done. |

Claude works with the text that you write, and it can ask you about the rest. Tell Claude "Ask me questions about my brief." for its questions. The panel shows them. You can answer a question in the brief, and close it in the panel. An answer is optional.

The gate **The brief is ready** does not wait for a part of the brief or for an answer.

### A brief from the chat

Claude gives your brief to Shotgun with your words. Claude can add only the headings of the 5 parts and list marks. Shotgun refuses each line that is not in one of your recent prompts. Thus the brief stays your text.

For this check, the plugin of Shotgun gives each prompt to Shotgun. Shotgun keeps your last 20 prompts only in memory, and only for its window. No file gets them.

## The survey

In stage 2, Claude reads your brief and the code. Claude gives the survey to Shotgun:

- The tasks, in no sequence. A task can need a different task first.
- The hooks: the places in the code that the tasks change. Each hook has a short text of its code. Thus the hook stays with its code when the lines move.
- The facts that the brief does not give. Each fact names the read tool of DataFlow that shows it.
- The questions for you.

Shotgun checks each part of the survey, and gives all problems back to Claude in 1 list. Claude then corrects the survey. Claude changes no file in this stage. Shotgun also refuses a fact with a tool that Claude did not call in this stage.

The page of Shotgun shows the words of Claude with the badge **Model**. It shows the facts of DataFlow with the badge **Engine**. For each hook in a C or C++ file, Shotgun gets these facts from DataFlow: the function, the threads, the locks and the heat. The heat is a score from 0 to 100 for the risk of a change.

Until the scan of the call graph is complete, the heat can change. The page then marks the heat with "*". At the end of the scan, Shotgun gets the facts again.

In the stages 2 and 3, the text editor shows a line at the left side of each hook. The id and the title of the hook come after its first line. Move the pointer onto a hook to see its facts.

A click on a hook on the page shows its code in the side view of DataFlow. The lines of the hook are highlighted, with the id and the title of the hook as the note. The small pen button beside the hook opens the file at the hook in the text editor. The places of the steps and the changes of a receipt work in the same way. [Links to the code](#links-to-the-code) tells more.

## The order

In stage 3, you put the tasks of the survey in sequence on the order page. Each task shows its text, its hooks, the estimate of Claude for its size, and the tasks that it needs. You can:

- move a task up or down
- change the text of a task
- add a task
- keep a task for later, or put it back into the plan
- remove a task that you added

Each edit is a decision of yours, and the ledger records it. Claude changes no text and no place of a task.

The order check uses the needs from the survey of Claude. If a task comes before a task that it needs, the check gives a warning. Shotgun does not move a task.

A task with a new text and a new task have no survey. Tell Claude "Survey my changed tasks." Claude then gives the hooks and the needs of each of these tasks. If you change the text again, the task has no survey again. A task with no survey at the gate gets its survey at the start of the plan.

The gate **Accept the order** needs 1 task or more in the plan, and a text for each task of the plan. With warnings, the button tells their number, and a modal message asks you first.

## The plan and the risk levels

In stage 4, Claude makes the steps of the plan in your sequence. Each step has a task, hooks, places, a text and checks. A place is lines of a file that is there, or a new file.

Shotgun gives each step a risk level from the facts of DataFlow. The level of a step is the highest level of its places:

| Facts of DataFlow | Risk level |
| --- | --- |
| A new file | 1 |
| A cool function, a file that is not C or C++ ("no facts"), or lines with no function | 2 |
| A warm function | 3 |
| A hot function | 4 |
| A very hot function | 5 |

More rules make a level only higher:

- Callers that the call graph cannot see: level 3 or higher.
- A frame path with more than 8 calls, or a line in the main loop: level 4 or higher.
- A worker thread at the line: 1 level more. A lock at the line: 1 level more. The maximum is 5.
- A data member of a type: level 2, or level 3 if threads share a member or a member is on a frame path. A change of a data member gets the level of the hottest function that uses it. A new data member next to the other members changes no member, so the hottest function does not apply.
- Before the end of the scan of the call graph, a function with an incomplete reach has no level. After a stopped scan or a failed scan, the level is 3 or higher.

The open decisions of the step change the level of the rules too. A step with no open decision gets at most level 2, but level 5 stays. The next section tells more.

In stage 5, the level selects the writer of the step. At the levels 1 and 2, Claude writes. At level 3, Claude writes a frame with a hole for each decision, and you fill the holes. At the levels 4 and 5, you write, and at level 4 you can ask for a frame. Only you change a level: in stage 4, and in stage 5 for a step that Claude did not start. The ledger records each level and each note of yours.

In the stages 4 and 5, the text editor shows each place of a step with the color of its level, and a CodeLens line. A click on the CodeLens line shows the step on the page.

## Open decisions

The plan names the open decisions of each step: 0 to 3 choices that the brief, your answers and the order do not settle. An example is "What happens to the solve that still runs at the limit?". Claude can give the options that it sees, but not its choice. A type, a name, a signature or a value that the brief gives is no decision.

The open decisions select your work:

- A step with no open decision gets at most level 2, so Claude writes it, and you walk the receipt. The heat of the place does not change this.
- A step with an open decision keeps the level of the heat. At level 3, each open decision is a hole of the frame. At the levels 4 and 5, you write the step.
- A step of level 5 stays your step, also with no open decision.

The plan page shows the open decisions under each step. The badge **Model** marks a decision of Claude, and **You** marks a decision of yours. You can:

- **Answer** a decision in words. Then it is no hole, and the writer puts your answer into the code.
- **Open again** a decision that you answered.
- **Add a decision** of yours, for example a choice that Claude did not see. It is open, so the step keeps the level of the heat.
- **Remove** a decision that you added.

You change the decisions in stage 4, and in stage 5 for a step that Claude did not start. An answer or a new decision changes the level at once, and the ledger records it. A level of yours comes first.

An open decision in a step of Claude is a choice of Claude in its errand. The gate **Accept the plan** names these decisions, and a modal message asks you first. The receipt of the step shows each choice of Claude with the badge **Model**. For a different choice, put an issue on its change.

A plan of version 0.1.0 has no open decisions. Its steps keep the level of the heat.

## The build

In stage 5, the steps of the plan go in sequence. The current step is the first step that is not done.

A step of Claude is an errand:

1. You tell Claude "Do step N." Claude opens the step with the tool `shotgun_start_step`.
2. Shotgun saves the files of the scope of the step: the files of its places. DataFlow keeps their text as the base of the step. Then the guard lets Claude change these files.
3. Claude changes the files, and gives the receipt with the tool `shotgun_submit_errand`. Shotgun gets the diff since the base from DataFlow. Each change in the diff needs a change of Claude with its lines, a title and a check for you. The scope closes again.

The panel shows the receipt. Each change shows the title and the check of Claude, its lines, the added and the removed lines, the heat of DataFlow, and its diff. A note of Claude has the badge **Model**, for example for a change that you did not ask for. The receipt also shows the edits that the guard denied, and the loose ends of Claude. It also shows the files outside of the scope that changed while the step was open.

Put a mark on each change: **OK**, **Issue** or **Question**, and write a note for Claude if necessary. An issue stops the gate. Tell Claude "Fix the issues of step N." Claude reads your marks and your notes with the tool `shotgun_get_step`, and opens the step again. The step keeps its base, so the new receipt has all changes since the first start. A change with no new code keeps your mark OK.

The gate **Accept the receipt** deletes the base of the step. If a change has no mark, a modal message asks you first. The ledger keeps such a change as not walked.

You write a step of the levels 3, 4 and 5. Shotgun keeps the text of the files of its places as the base of the step. Write the code of the step, and select **The step is done**. Shotgun records your lines since the base. Claude changes no file in your step, but it can answer your questions in the chat.

`lines.json` keeps the writer of each changed line. The text editor shows a mark in the gutter for each line of Claude. The mark is dashed until you walk its change, and then it has the color of your mark. A line of Claude that you change becomes your line. If you change a file of the scope while Claude writes the step, Shotgun shows a warning.

## Frames

A step of level 3 gets a frame. A step of level 4 gets a frame only after you select **I want a frame** in the panel.

1. You tell Claude "Give me a frame for step N." Claude opens the step with the tool `shotgun_start_step` and the kind `frame`. A frame needs an open decision of the step, so a step with no open decision gets no frame.
2. Claude writes all lines of the step that are not the code of an open decision. These are the declarations, the signatures, the calls that the plan names, and the code of each decision that you answered. In the place of the code of each open decision, Claude writes a marker in a comment, for example `/*@hole 1: What happens to the solve that still runs at the limit? */`.
3. Claude gives the holes with the tool `shotgun_submit_frame`. Each open decision has exactly 1 hole. Each hole has 4 hints: a nudge, a pointer to the facts, an example from the project, and 1 possible answer. Shotgun checks each marker, each place and each decision.

A hole holds the whole code of its decision, for example a condition with its branch, the change of the state and the error path. Shotgun refuses a hole that is only a type, a name, a literal or a list of parameters. It also refuses a hole whose answer is in the text of the step. Such code has no decision, so it is a line of the frame.

The panel shows the holes and the state of each hole. Select a hole to see its question and the facts of DataFlow at its line. The hint ladder shows the hints one at a time. The hints came with the frame, so a click sends no request to Claude. **4 Show me** puts the answer of Claude into the hole, after a modal message. Its lines are lines of Claude.

In the text editor, an open hole has a dashed box. Tab goes to the next open hole and selects its marker, and Shift+Tab goes to the hole before it. Type your code in the place of the marker. With no open hole, Tab and Shift+Tab indent as usual. The hover of a hole shows its question, the hints that you opened, and a link to the next hint.

When each hole has code, select **The step is done**. The frame lines have the tag "Claude · frame" in the gutter, and they get no receipt. For a different frame, tell Claude "Give me a different frame for step N."

## Callouts

While you write a step of yours, or the holes of a frame, Shotgun gets the facts of DataFlow for your lines:

- the races of the threads, and data that a thread uses after the end of its function: a **problem**
- the checks of the threads, and the warnings of the logic: a **warning**
- the hidden C++, for example a copy or a temporary: **info**

A new fact on one of your lines is a callout. At the start of the step, Shotgun keeps the facts of DataFlow. Thus a fact that was there before your change is not a callout.

Callouts never come while you type. They come at a pause: 2 seconds with no edit. A pause shows a maximum of 3 callouts, the problems first. The voice selects the kinds:

| Voice | Callouts |
| --- | --- |
| Quiet | Only the problems. |
| Normal | The problems and the warnings. This is the default. |
| Talkative | Each new fact, also the hidden C++. |

The text editor shows a tag after the line of each callout. The hover shows the facts of the engine with their places. "Show in DataFlow" opens the line in the side view of DataFlow. "Not a problem" closes the callout with your reason, and the ledger keeps the reason.

The callouts show the facts of DataFlow with the badge **Engine**. For the words of Claude, tell Claude "Explain the callout on line N." The panel shows them with the badge **Model**.

You can ask Claude about a line, for example "Does the lambda on line 95 copy charge?". Claude puts its answer at the line. Shotgun adds the facts of DataFlow at the line, so the facts and the words of Claude stay apart.

## Loose ends

A loose end is a place that the changes of a step can also need. At the gate of each step, Shotgun gets the loose ends from DataFlow, while the base of the step is still there:

- a function that uses most data members of a type, but not a new member, for example a function that loads the settings: **mechanical**
- a switch statement that does not handle a new enumerator: **mechanical**
- a caller that gets the result of a changed function: **your decision**
- a loose end that Claude gave with its receipt: **mechanical**, with the badge **Model**

The tab **Loose ends** of the panel shows them. **Hand to Claude** makes a mechanical loose end the next step of the plan, with risk level 2. Then tell Claude "Do the loose ends.". **Close** keeps your reason in the ledger, for example for a caller that needs no change.

## The ledger and the commit message

The ledger page shows your decisions and the lines of each file. It shows your lines, the lines of Claude that you walked, and the lines of Claude that you did not walk. A click on a file shows the file in the side view of DataFlow. **Walk** highlights the first lines of Claude that you did not walk in DataFlow. **Copy for the pull request** puts your decisions, the lines of each writer and the issues of the review into the clipboard as Markdown. Each issue has its state and your reason.

You write the commit message in the input box of Source Control. The tab **Ledger** of the panel shows the same text. Tell Claude "Check my commit message.". Claude compares the message with the diff. It gives its points with the badge **Model**: what agrees, what is missing, what is wrong, and its questions. If you change the message after the check, the panel tells you that the check is old.

Shotgun makes no commit, and Claude changes no message. You commit in Source Control.

## The review

In stage 6, a new session of Claude Code reviews the whole diff of the task. A new session did not write the code, so it reviews with a fresh view. The diff starts at the commit of HEAD at the first gate **Accept the plan**. That gate also names the files with changes that were not committed then, because the review sees their changes too. The review needs a repository of git.

1. After the last step, select **The build is done**. The task goes to stage 6.
2. In the panel, select the effort and the focus of the review. You can also write a point of yours, for example "Look at the error paths.".
3. Select **Copy the review prompt**. Start a new session of Claude Code in the folder of the project, and paste the prompt.
4. Claude loads the skill `shotgun-review`. Its subagents find the candidates, and a verify pass checks each candidate. Then Claude gives the issues to Shotgun. Claude changes no file.
5. Work through the steps of the issues. The panel shows the current step with its gate.
6. After your fixes, select **Copy the prompt of round 2**, and paste it into a new session. The next round checks the fixes.
7. Select **The task is done**.

The effort sets the finders, the context and the verify pass. It does not set the number of issues.

| Effort | The review |
| --- | --- |
| Low | 1 finder. Claude gives a short verdict for each candidate, and drops the plausible candidates. |
| Medium | 1 finder for each area of the focus, and 1 finder for all areas. The finders also read the ripple of each hunk. 1 verifier checks each candidate. This is the default. |
| High | As medium. Each finder does a second pass with a different order of the hunks. |
| Extra high | As high, with more passes and the callers of the hot changed functions. |
| Max | As extra high, with up to 5 passes for races and lifetime. A second verifier comes only with new evidence, for example a sanitizer run that you agree to. |

Above high, a review finds few more issues, but it uses much more time and many more tokens.

A measurement of Shotgun tested the efforts low, medium and high on 12 small changes of 1 to 4 hunks. Of these changes, 8 had 1 known bug each. Each effort found each of these bugs. A review at low took about 1 minute. A review at medium or high took about 2 minutes, and the CLI gave about 3.5 times the cost of low. Thus for a small change, low can be enough. The measurement did not compare the efforts on large changes.

The focus has these areas. The default focus is all areas except cleanups.

| Area | The review looks for |
| --- | --- |
| Correctness | Code that does not do what the step or the brief needs, also a null pointer, a bound or an error path |
| Threads and races | Data that 2 threads can use at the same time with no protection. The finder starts from the races of DataFlow. |
| Lifetime | Data that a thread or a lambda uses after the end of its owner, a leak, or a double free |
| The brief | A spec or a condition of done that the diff does not give, and a change that the brief puts out of scope |
| Tests | A condition of done of the brief with no test |
| Cleanups | Code that works, but repeats code or does more work than necessary |

Each issue has a place, a severity, a verdict, an origin and a failure scenario. The severity is important or minor, and the verdict is confirmed or plausible. The origin is new or pre-existing. The failure scenario gives the trigger, the path and the wrong result. A race also gives the interleave of the 2 threads. The badge **Engine** marks an issue that a fact of DataFlow gives, for example a race of DataFlow. **Model** marks an issue that Claude found, also with the help of facts of DataFlow. A click on an issue shows its place in the side view of DataFlow.

Shotgun puts each issue into 1 of 2 lists:

- The list of steps has the confirmed new issues, the important issues first. It has a cap of 3 issues, plus 1 for each 100 changed lines of the task, with a maximum of 10.
- The second list has the plausible issues, the issues that were in the code before the task, and the issues above the cap.

**Not a problem** closes an issue with your reason. The ledger keeps the reason, and the next review gets it. Claude names a closed issue or the problem of a closed callout again only with new evidence, and then the issue goes into the second list. **Open again** opens a closed issue. A new review of the same round replaces the open issues of the last review. It keeps the issues that you closed and the steps that you started.

### The steps of the issues

Each issue of the list of steps is a step of yours at level 4. The id of the step is the id of the issue, for example I3. The steps of the issues go in sequence, as the steps of the build, and the panel shows the current step with its own gate:

- Write the fix of the issue. Then select **The step is done**. Shotgun records your lines, and gives callouts and loose ends, as in the build. The gate fixes the issue.
- You can ask Claude about the issue in the chat. At level 4, select **I want a frame**, and tell Claude "Give me a frame for step I3.". The frame has a hole for each open decision of the fix.
- To let Claude fix the issue, select **Lower** on the page until level 2. Then tell Claude "Do step I3.", and walk the receipt.
- On the page, answer an open decision of the fix in words, or add a decision of yours, as on the plan page.
- **Make it a step** adds an issue of the second list at the end of the list of steps. **Back to the second list** removes it again, before Claude starts it.
- **Not a problem** for a started step removes the step. Its changes stay in the files.

### Rounds

After you fix an issue, the next review is a new round. The panel then shows **Copy the prompt of round 2**. The prompt tells Claude to review the fixes: the hunks that changed since the last round, with their ripple, and each fixed issue. If a fix is not correct, Claude gives its issue again, and the issue is a step again. A correct fix gets no issue.

After 3 rounds, the panel tells you to think about the approach of the task again, for example with a different plan. A modal message asks before it copies the prompt of round 4.

### Your feedback

Each issue that you fix or close is feedback for the review. For each area of the focus, the page shows the issues of the list of steps that you closed with no action. It counts all tasks of the folder. After 10 decided issues, an area with more than 10% with no action gets the button **Turn off**. It removes the area from the focus of the next review. Your feedback also moves the cap on the steps to the last rank before the issues with no action pass 10%.

The gate **The task is done** never waits. With open issues in the list of steps, a modal message asks first, and the ledger keeps them as open.

## Return to an earlier stage

You can return the active task to an earlier stage at any time, also a done task. Click the stage in the stage bar of the panel or of the page, or run **Shotgun: Return to a Stage...**. Shotgun asks first, and the ledger records the return.

- The work of the later stages stays: the survey, the order, the plan and the build. Pass the gates again to come back. Claude does a stage again only when you ask, for example "Survey my brief.".
- A new survey of Claude starts a new order, because the old order was for the tasks of the old survey.
- A new plan of Claude keeps the state of each step of the build with the same id and the same title. The other steps of the build start again.
- An open step of the build goes back to todo. Its changes stay in the files. A step with a receipt or with the holes of a frame keeps its state.
- In the stages 1 to 4 and in stage 6, the guard denies each change of a file again.

## The guard

Before each file change of Claude Code, the plugin of Shotgun asks the guard. In the stages 1 to 4 and in stage 6, the guard denies each change of a file of the project. Claude gets the reason. In stage 5, the guard lets Claude change only the files of the scope of its open step. The same rule applies to the step of an issue in stage 6. The ledger records each deny.

**Pause** stops the guard for work outside of the task, and **Continue** starts it again. The ledger records the pause.

The guard helps you, but it is not a security boundary:

- If VS Code does not run, Claude Code continues the change.
- The guard does not see a change through a shell command. The receipt of a step shows each change of its scope since the base of the step. It also shows the files outside of the scope that changed while the step was open.

## Commands and keys

| Command | Function |
| --- | --- |
| Shotgun: New Task | Makes a task in stage 1 with `brief.md`. The new task becomes the active task. |
| Shotgun: Open Task | Selects a different task of the folder. |
| Shotgun: Return to a Stage... | Returns the active task to an earlier stage. The work of the later stages stays. |
| Shotgun: Show Panel | Shows the panel of Shotgun in the secondary side bar. |
| Shotgun: Show Page | Opens the page of Shotgun in the editor area. |
| Shotgun: Open Project Folder... | Opens the folder of a project in this window. |
| Shotgun: Open Recent Project... | Opens a recent project with a task of Shotgun in this window. |
| Shotgun: Show Log | Shows the log of Shotgun. |
| Shotgun: Open Brief | Opens the brief of the active task. |
| Shotgun: Close Question | Closes a question of Claude about the brief. |
| Shotgun: Answer Question | Gives your answer to a question of the survey. An empty answer removes the answer. |
| Shotgun: Check the Hooks Again | Gets the facts of DataFlow for the hooks of the survey again, at their lines now. |
| Shotgun: Set Risk Level | Sets your level for a step of the plan, or sets the level of the rules again. In stage 5, only for a step that Claude did not start. |
| Shotgun: Check the Levels Again | Gets the facts of DataFlow and the levels of the rules for the steps of the plan again. |
| Shotgun: Mark a Change | Puts your mark on a change of the receipt of the current step, with a note for Claude. |
| Shotgun: I Want a Frame | Gives the current step of level 4 to Claude as a frame. Then tell Claude "Give me a frame for step N." |
| Shotgun: Go to the Next Hole | Selects the next open hole of the frame. |
| Shotgun: Go to the Hole Before | Selects the open hole before the cursor. |
| Shotgun: Show the Next Hint | Shows the next hint of the hole at the cursor. The last hint puts the answer of Claude into the hole. |
| Shotgun: Set the Voice of the Callouts | Sets the voice: quiet, normal or talkative. |
| Shotgun: Not a Problem | Closes a callout with your reason. The ledger keeps the reason. |
| Shotgun: Resolve a Question on a Line | Resolves a question that Claude answered at a line. |
| Shotgun: Hand a Loose End to Claude | Makes a loose end the next step of the plan for Claude, with risk level 2. |
| Shotgun: Close a Loose End | Closes a loose end with your reason. The ledger keeps the reason. |
| Shotgun: Show the Ledger | Shows the ledger page of the task. |
| Shotgun: Copy the Ledger for a Pull Request | Puts your decisions and the lines of each writer into the clipboard as Markdown. |
| Shotgun: Pass the Gate | Records the gate of the stage, for example "The brief is ready". |
| Shotgun: Pause | Stops the guard for work outside of the task. The ledger records the pause. |
| Shotgun: Continue | Starts the guard again. |
| Shotgun: Connect to Claude Code | Adds the plugin of Shotgun to Claude Code. |
| Shotgun: Disconnect from Claude Code | Removes the plugin of Shotgun from Claude Code. |

| Key | Function |
| --- | --- |
| Tab | In a frame with an open hole: goes to the next open hole, and selects its marker. |
| Shift+Tab | In a frame with an open hole: goes to the open hole before the cursor. |

## Settings

| Setting | Function |
| --- | --- |
| `shotgun.voice` | The voice of the callouts: `quiet`, `normal` or `talkative`. Default: `normal`. |
| `shotgun.pauseSeconds` | The time in seconds with no edit that makes a pause. Callouts come only at a pause. Default: 2. |

## Files

| File | Content |
| --- | --- |
| `.shotgun/active.json` | The active task, and the pause of the guard. |
| `.shotgun/<task>/task.json` | The title of the task, its stage and its gates. |
| `.shotgun/<task>/brief.md` | The brief, with the 5 parts. |
| `.shotgun/<task>/questions.json` | The questions of Claude about the brief. |
| `.shotgun/<task>/survey.json` | The survey of Claude: the tasks, the hooks, the facts and the questions. |
| `.shotgun/<task>/engine.json` | The facts of DataFlow for each hook of the survey. |
| `.shotgun/<task>/answers.json` | Your answers to the questions of the survey. |
| `.shotgun/<task>/order.json` | Your order of the tasks: the sequence, your texts, your new tasks, the tasks for later, and the surveys of Claude for the changed tasks. |
| `.shotgun/<task>/plan.json` | The steps of the plan of Claude, with their open decisions. |
| `.shotgun/<task>/risk.json` | The facts of DataFlow and the level of the heat for each step. |
| `.shotgun/<task>/levels.json` | Your levels, your notes, your answers to the open decisions, and your decisions for the steps. |
| `.shotgun/<task>/build.json` | The state of each step of the build, its scope and its base. Also the receipt with the notes of Claude and your marks, and the holes of a frame with their hints. |
| `.shotgun/<task>/lines.json` | The writer of each changed line, with a hash of each line of the file. |
| `.shotgun/<task>/callouts.json` | The facts of DataFlow at the start of each step, the callouts with your reasons and the words of Claude, and the answers on lines. |
| `.shotgun/<task>/loose.json` | The loose ends of the steps, with their state, your reasons and the steps of Claude for them. |
| `.shotgun/<task>/message.json` | The last check of Claude of your commit message. |
| `.shotgun/<task>/review.json` | The base commit of the task, your effort and focus, and the rounds and the issues of the review, with your reasons. |
| `.shotgun/<task>/decisions.jsonl` | The ledger: 1 line for each decision of the user and for each deny of the guard. |
| `~/.shotgun/claude` | The plugin of Shotgun for Claude Code, in a local marketplace. |
| `.claude/settings.local.json` | The local settings of Claude Code in the project. The connection turns the plugin of Shotgun on there. |

You decide if git keeps the folder `.shotgun`.
