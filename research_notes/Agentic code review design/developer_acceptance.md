# Developer acceptance of automated and AI code review comments

These notes collect evidence about the properties of review comments and review tools that make developers act on a comment. Status: November 2026.

Labels in these notes:

- [IND]: an independent study. The authors do not sell the tool. The tool can be a research prototype of the authors.
- [BUILDER]: a peer-reviewed report from the team that built the tool. The data comes from real use, but the authors evaluate their own tool.
- [CO-BLOG]: a company blog about an internal tool. There is no peer review.
- [VENDOR]: a claim from a company about a product that it sells. There is no peer review, and usually there is no public method.
- [UNCONFIRMED]: I did not find the statement in the primary text. The bullet gives the reason.

Terms in these notes:

- A pull request is a PR. A large language model is an LLM. An integrated development environment is an IDE.
- "Action rate" is the general term for the share of comments that developers act on. Each study uses its own metric and its own name. Each bullet gives the name and the definition of the metric.
- An "effective false positive" is a finding that developers do not act on. Google introduced this term.
- "Nits" are trivial comments about small details.
- The metrics are not equal. Do not compare the values directly. The studies use these 6 types of metric:
  - Labels that developers set: Beko.
  - Code changes near the comment: Atlassian and ByteDance.
  - A second run of the reviewer on the final code: Uber.
  - An LLM judge: Cursor and the GitHub Actions study.
  - Fixes that the author applied: Google and Meta.
  - Comments that a reviewer accepted for publication: Mozilla and Ubisoft.

## 1. How do false-positive rates and noise affect trust and the action rate? Is there a known threshold where developers stop reading?

### Takeaway

Developers judge a tool by the share of findings that they do not act on, not by technical correctness. Static analysis teams at Google set a budget of less than 10% non-action for findings in code review. Coverity reports that users ignore a tool above about 30% false positives, and a Microsoft survey shows that most developers reject 20%. The first few wrong reports can end trust. LLM reviewers in independent field studies get much lower action rates, and each team that reports good rates added strong filters after generation. Placement in the workflow can matter as much as precision: Infer went from almost 0% to more than 70% fixes with the same analysis.

### Cited Findings

#### Static analysis: budgets, thresholds and the loss of trust

- [BUILDER] Google defines an effective false positive as an issue where developers take no positive action after they see it. A correct finding that the developer does not understand also counts. An incorrect finding that the developer fixes anyway for readability does not count. Source: [Sadowski et al., CACM 2018, "Lessons from Building Static Analysis Tools at Google"](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Google lets code review checks have up to 10% effective false positives. Developers must feel that a check points to a real issue at least 90% of the time. Compiler checks must have no effective false positives, because they stop the build. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] A footnote in the same paper says that the first author first chose the 10% value somewhat arbitrarily. The authors add that the value seems to be a good point for developer satisfaction. It also agrees with the cutoff of similar systems at other companies. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Tricorder measures a "not-useful rate" for each analyzer. The rate is the NOT USEFUL clicks divided by the sum of NOT USEFUL, PLEASE FIX and APPLY FIX clicks. A rate of about 10% puts the analyzer on probation. Above 25%, the team can turn the analyzer off immediately. Source: [Sadowski et al., ICSE 2015, "Tricorder: Building a Program Analysis Ecosystem"](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
  - Note: the comparison sign before "10%" is lost in the text of the Tricorder PDF. The CACM 2018 paper says that Google disables an analyzer when the ratio goes above 10%, until the authors improve it. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] In 2014, the weekly not-useful rate for all Tricorder analyzers was typically about 5%. Without the analyzers on probation, it was under 4%. The most successful analyzers had a not-useful rate of 0% to 3%. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] In 2014, Tricorder reported about 93,000 findings each day. Each day, reviewers clicked PLEASE FIX on about 716 findings and NOT USEFUL on 48 findings. An average changelist had 2 PLEASE FIX clicks and no NOT USEFUL click. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] Clicks are an imperfect signal. Developers can ignore a finding and not click NOT USEFUL. By analyzer, only 10% to 60% of NOT USEFUL clicks led to a bug report against the analyzer. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] In January 2018, Tricorder analyzed about 50,000 code review changes each day. Reviewers clicked "Please fix" more than 5,000 times each day. Authors applied automated fixes about 3,000 times each day. Analyzers received "Not useful" clicks 250 times each day. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Google stopped its first integration of FindBugs into code review in 2011. Effective false positives made developers lose confidence in the tool. Settings for each user gave an inconsistent view of the results. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] In the Google FindBugs Fixit of May 2009, engineers reviewed 3,954 warnings, 42% of 9,473. They filed bug reports for 44% of the reviewed warnings, 1,746 warnings. They fixed only 16%, 640 warnings. The authors conclude that many true findings were not important enough to fix. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] The founders of Coverity write that more than 30% false positives easily cause problems. People then ignore the tool, and true bugs get lost among the false ones. Coverity sells this tool. Source: [Bessey et al., CACM 2010, "A Few Billion Lines of Code Later"](https://6826.csail.mit.edu/2019/papers/coverity.pdf)
- [BUILDER] Coverity aims for less than 20% false positives on its "stable" checkers. When it must choose, it prefers fewer false positives to more bugs. Source: [Bessey et al., CACM 2010](https://6826.csail.mit.edu/2019/papers/coverity.pdf)
- [BUILDER] Coverity describes a cycle of trust. Low trust makes users label complex true bugs as false positives, and this lowers the trust more. The first reports have a very large effect. If about the first 3 reports are false positives, users reject the tool. One obviously stupid false positive makes users think that the tool is stupid. Source: [Bessey et al., CACM 2010](https://6826.csail.mit.edu/2019/papers/coverity.pdf)
- [BUILDER] At Facebook, the Infer team estimated its false positive rate at less than 20%. In a nightly batch mode, developers acted on almost none of 20 to 30 assigned issues. At diff time, in code review, the fix rate went above 70% with the same analysis and the same false positive rate. The "fix rate" is the share of reported issues that developers resolved. Source: [Distefano et al., CACM 2019, "Scaling Static Analyses at Facebook"](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] Facebook does not measure the false positive rate, because human judgment of all reports on a codebase that changes quickly takes too much time. It tracks the action rate and the missed bugs that it observes. At publication, the action rate of Zoncolan was above 80%. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [IND] In a survey of 375 developers at Microsoft, 90% accept a false positive rate up to 5%. 47% accept a rate up to 15%. Only 24% accept a rate as high as 20%. This is a Microsoft Research survey, and it does not evaluate a tool. Source: [Christakis and Bird, ASE 2016, "What Developers Want and Need from Program Analysis"](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [IND] In the same survey, the largest pain point of program analyzers is wrong checks that are on by default. The figure lists "Bad warning messages" second and "Too many false positives" third. Developers care much more about false positives than about missed issues. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [IND] 55% of the developers in the survey prefer false positives when they can quickly identify them. Developers accept more false positives for critical code. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [IND] In 5 open source projects, developers fixed 27.4% to 49.5% of Coverity alerts. The median was 36.7%. The median time to fix was 96 days. Source: [Imtiaz, Murphy and Williams, ISSRE 2019](https://www.microsoft.com/en-us/research/?p=690690)
- [BUILDER] At Tencent, 328 of 433 static analysis alarms in one codebase were false positives, about 76%. A hybrid of LLM and static analysis removed 94% to 98% of the false positives with high recall. Source: [Du et al., arXiv 2601.18844, ICSE-SEIP 2026](https://arxiv.org/abs/2601.18844). [UNCONFIRMED in the full text: the values come from the abstract, through search results.]

#### LLM code review: noise, trust and filters

- [IND] At Mozilla and Ubisoft, reviewers accepted 8.1% and 7.2% of the comments from RevMate, an LLM review assistant. Reviewers rejected 28.0% and 19.1% of the evaluated comments as "Trivial". They rejected 31.8% and 8.0% as "Incorrect". The authors built RevMate as a research prototype. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] 20 of 37 RevMate participants said that the relevance must improve. They described comments as superficial, obvious, generic, vague or sometimes wrong. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] A study of 16 AI review actions on GitHub analyzed 22,326 comments in 178 repositories. For the 4 tools in the analysis of code changes, only 0.9% to 19.2% of all comments were valid and addressed. 60% of valid human comments led to code changes. A 2-stage LLM pipeline classified validity and code changes, and the authors checked samples by hand. Source: [Sun et al., arXiv 2508.18771, "Does AI Code Review Lead to Code Changes?"](https://arxiv.org/html/2508.18771v2)
- [IND] In manually labeled samples of the same study, 26% to 36% of AI comments were valid and addressed, against 80% of human comments. The authors say that these samples are not representative. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [IND] In 278,790 review conversations from 300 GitHub projects, developers adopted 16.6% of the code suggestions from AI agents. They adopted 56.5% of the code suggestions from human reviewers. In a sample of 383 AI suggestions that developers did not adopt, 28.7% had incorrect code and 24.0% got a different fix. Source: [arXiv 2603.15911, "Human-AI Synergy in Agentic Code Review"](https://arxiv.org/html/2603.15911v1)
- [IND] A study of CodeRabbit reviews analyzed 31,073 pairs of review and developer feedback from 10,191 PRs in 239 repositories. Developers accepted 36.4%, discussed 7.3% and rejected 56.3%. The main reasons for rejection were invalid suggestions: false positives, redundant comments and comments out of scope. Source: [arXiv 2607.03316, "Is Agentic Code Review Helpful?"](https://arxiv.org/abs/2607.03316)
  - [UNCONFIRMED] A secondary blog says that 43.3% of the rejected comments were false positives. A search summary says that invalid suggestions were 58.0% of rejections, and that "accepted" includes code changes, new PRs and new issue tickets. I did not find these statements in the abstract.
- [BUILDER] ByteDance's BitsAI-CR has a second stage, ReviewFilter, that checks each comment from the first stage. In the selected configuration, ReviewFilter rejected 55.25% of the first-stage comments as wrong. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [BUILDER] The BitsAI-CR authors put precision before recall. They write that developers ignore comments when there are many, and that wrong comments early in use damage trust. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [BUILDER] In a BitsAI-CR survey of 137 users, 74.5% said that the comments had value. 12.4% said that comments were correct but not necessary. 10.9% said that comments were incorrect, 1.5% irrelevant and 0.7% hard to understand. User retention fell from 61.64% in week 2 to about 48% in week 8. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [BUILDER] At Kuaishou, developers told the authors that one false positive can damage trust. About 50 expert reviewers gave the highest priority to the catch of critical bugs. They called the false alarm rate a very sensitive metric. Source: [Lu et al., ICML 2025, "Towards Practical Defect-Focused Automated Code Review"](https://arxiv.org/html/2505.17928v2)
- [BUILDER] In the Kuaishou offline benchmark, a validator stage lowered the false alarm rate FAR1 from 87.81 to 75.37. It also lowered the key bug inclusion from 31.11% to 20.00%. A filter for false positives thus also removes true findings. Source: [Lu et al., ICML 2025](https://arxiv.org/html/2505.17928v2)
- [BUILDER] Google's AutoCommenter posts comments about best practices. Its useful ratio from developer feedback stopped at about 54%. A study with raters gave 60%. The team needed 80% for wide deployment. Source: [Vijayvergiya et al., arXiv 2405.13565, "AI-Assisted Assessment of Coding Practices in Modern Code Review"](https://arxiv.org/html/2405.13565v1)
- [BUILDER] The AutoCommenter team suppressed 17 best practice links that raters found not actionable, and later 5 more. The useful ratio went from 54% to 66% for developers and from 60% to 74% for raters. The lessons section says that a simple suppression mechanism raised user acceptance to over 80%. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [CO-BLOG] Uber reports that developers ignore the tool when it gives false positives. Low-quality comments damage trust quickly. Uber released uReview to 1 team or 1 assistant at a time. It watched precision dashboards and the counts of false positives that users reported. Source: [Uber, uReview blog, 2025](https://www.uber.com/us/en/blog/ureview/)
- [VENDOR] Atlassian writes that LLM comments without a filter can be very noisy, nitpicky or factually wrong. Its ModernBERT ranker learned from about 53,000 comments with a label for code resolution. The code resolution rate went to about 40% to 45%, near a human benchmark of about 45%. Atlassian sells Rovo Dev. Source: [Atlassian blog, comment quality classifier](https://www.atlassian.com/blog/how-we-build/ml-classifier-improving-quality)
- [BUILDER] In the RovoDev paper, the actionability filter raised the alignment with human comments, by location only, by 20 points. The filter for factual correctness had a minimal effect. Source: [RovoDev Code Reviewer, arXiv 2601.01129, ICSE-SEIP 2026](https://arxiv.org/html/2601.01129v2)
- [IND] Interviews with 21 practitioners about bots on PRs found noise to be the central problem. Noise included too much text, too many bot actions, and tasks that nobody requested. Source: [Wessel et al., "Don't Disturb Me", arXiv 2103.13950](https://arxiv.org/abs/2103.13950). [The values come from the abstract. I did not read the full text.]
- [IND] At Beko, practitioners said that the bot sometimes reports mistakes that are not mistakes. They also said that it suggests changes outside the scope of the task. Source: [Cihan et al., ICSE-SEIP 2025, "Automated Code Review In Practice"](https://arxiv.org/html/2412.18531v2)

#### Measurement: explicit feedback is rare

- [BUILDER] Developers gave explicit feedback on about 10% of AutoCommenter comments in code review and on about 2% of its diagnostics in the IDE. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] At Atlassian, users rarely clicked thumbs up or thumbs down on RovoDev comments. Source: [RovoDev Code Reviewer, arXiv 2601.01129](https://arxiv.org/html/2601.01129v2)
- [BUILDER] At Google, most applied ML edits had no thumbs up click. The authors use the applied edit as the strong positive signal. Source: [Frömmgen et al., ICSE-SEIP 2024, "Resolving Code Review Comments with Machine Learning"](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [VENDOR] In an Atlassian experiment, the feedback rate on comments went from 4% to 8.8% when the comments had more context. Source: [Atlassian blog, PR context](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)

#### Vendor claims about noise

- [VENDOR] Greptile audited its own comments. About 19% were good, 2% were incorrect and 79% were nits. Changes to the prompt could not remove nits without the removal of critical comments. An LLM judge that rated comments from 1 to 10 was nearly random. Source: [Greptile blog, "Make LLMs shut up"](https://greptile.com/blog/make-llms-shut-up)
- [VENDOR] Greptile then blocked each new comment that was similar to at least 3 comments that the team had downvoted. The address rate went from 19% to more than 55% within 2 weeks. The "address rate" is the share of comments that developers fixed before the merge. Source: [Greptile blog](https://greptile.com/blog/make-llms-shut-up)
- [VENDOR] GitHub writes that silence is better than noise. Copilot code review posts no comment in 29% of reviews. Source: [GitHub blog, March 2026, "60 million Copilot code reviews and counting"](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [VENDOR] A Graphite speaker said that less than 4% of Diamond comments got a downvote. He gave no sample size, no time window and no method. Source: [AI Engineer talk page, Graphite](https://ai.engineer/talks/don-t-get-one-shotted-use-ai-to-test-review-merge-and-deploy-code-tomas-reimers-graphite)
- [VENDOR] The first Bugbot version from Cursor ran 8 parallel passes and kept only bugs that more than 1 pass found. A validator model then removed false positives. Source: [Cursor blog, "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)

### Inferences

- Inference: Set the false positive budget as a budget of non-action, not of technical errors. A target of 10% or less non-action has the strongest support for comments in code review. Google, Coverity and the Microsoft survey agree on this order of size.
- Inference: Above 20% non-action, most developers in the Microsoft survey do not accept a tool. Above 30%, the Coverity experience predicts that users ignore the tool. These are the clearest thresholds in the literature.
- Inference: Correct comments with low value also count against the budget. Nits were 79% of the Greptile comments before its filter. "Trivial" or "not necessary" was a frequent reason for rejection at Mozilla, Ubisoft and ByteDance.
- Inference: The first comments that a team sees decide its trust. Start with the checks that have the highest precision, and add scope later. Coverity, BitsAI-CR, Uber and the staged AutoCommenter rollout support this.
- Inference: Developers seldom give explicit feedback. Measure the action rate with implicit signals: a code change at the comment location, a second run on the final code, or an applied fix.
- Inference: Keep a switch to turn off each category or rule. Turn it off when its non-action rate goes above the budget. Tricorder probation, AutoCommenter link suppression, Uber category suppression and BitsAI-CR rule removal use this mechanism.
- Inference: The independent studies of LLM reviewers in open source and at Mozilla and Ubisoft show action rates of 0.9% to 36.4%. These values are far below the 90% that the Google budget implies. Thus an LLM reviewer must post fewer comments and filter more strictly than a static analyzer.
- Inference: Every filter for false positives also removes some true findings, as the Kuaishou validator showed. The budget is a trade-off with recall, so decide it for each severity level.
- Inference: Precision alone is not sufficient. Infer had the same false positive rate in both modes, but developers acted only in the diff time mode.

### Gaps

- No study measures a threshold for LLM comments above which developers ignore the comments. The known thresholds come from static analysis and from a survey.
- The comparison sign before "10%" is lost in the text of the Tricorder PDF. The CACM 2018 text gives "above 10%".
- Microsoft did not publish an acceptance rate or a false positive rate for its internal AI reviewer.
- I found no Tencent study with acceptance rates for LLM review comments. The Tencent study in these notes is about false positives of static analysis.

## 2. Does a limit on the number of comments per review raise the action rate? What limits did studies or tools use?

### Takeaway

No study varies a fixed maximum number of comments and measures the effect on the action rate. The deployments with good action rates post few comments. Atlassian posts about 2 comments for each PR, and Cursor flags 0.4 to 0.7 bugs in each run. They get there with filters, deduplication, scope rules and suppression of categories, not with a hard maximum. One offline ablation at Kuaishou shows that a smaller cut after a sort by severity lost key bugs but did not lower false alarms much.

### Cited Findings

#### Scope rules that reduce volume

- [BUILDER] By default, Tricorder shows the results of most analyses only on changed lines. Developers can choose to see results on unchanged lines. Most of the 93,000 daily findings in 2014 were not shown, because they were on unchanged lines. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] In its default mode, Infer reports only new issues that a diff introduces. A hash of the bug type and the message makes the match robust to moved code and to changed line numbers. The aim is to not show warnings that developers think are old. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] Google's first FindBugs dashboard saw little use. One reason was that the mix of new and old issues distracted developers. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [IND] 72% of developers in the Microsoft survey use, or want, the analysis of a changelist instead of the full codebase. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [BUILDER] With greedy decoding, AutoCommenter flagged 6% of changed files, but 80% of these comments were on unchanged lines. After the team removed them, comments appeared on 1.3% of changed files. With beam search, the rate was 3.9%. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] BitsAI-CR groups similar comments by embedding similarity and keeps 1 comment from each group. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [VENDOR] Cursor Bugbot compares new findings with the findings of earlier runs and removes duplicates. Source: [Cursor blog](https://cursor.com/blog/building-bugbot)
- [IND] At Beko, developers complained that each fix produced a new review. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] For human comments at Microsoft, 83% of comments came in the first 2 iterations of a review. Comments after the first 2 iterations were less likely to be useful. Source: [Bosu, Greiler and Bird, MSR 2015, "Characteristics of Useful Code Reviews"](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)

#### Volumes that studies and tools report

- [BUILDER] Atlassian RovoDev posted an average of 2.1 comments for each PR. Its code resolution rate was 38.70%. The paper states no maximum number of comments. Source: [RovoDev Code Reviewer, arXiv 2601.01129](https://arxiv.org/html/2601.01129v2)
- [VENDOR] In an Atlassian experiment with external customers, the control group got 2.28 comments for each run and a resolution rate of 31.92%. The group with more PR context got 2.11 comments for each run and a resolution rate of 41.90%. Source: [Atlassian blog, PR context](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [IND] At Beko, the bot posted an average of 3.65 comments for each PR. Developers labeled 73.8% of the bot comments on merged PRs as resolved. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] RevMate produced 426 comments on 165 Mozilla patches and 1,218 comments on 422 Ubisoft patches. This is about 2.6 and 2.9 comments for each patch. The division is my calculation. Acceptance was 8.1% and 7.2%. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] In the GitHub Actions study, the tools posted about 7.4 comments for each PR. Tools that review each hunk posted about 10.4 comments for each PR, and tools that review the full PR posted about 1.5. These values are divisions of the counts in the paper. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [IND] In the same study, tools that review each hunk generally had higher addressed rates than tools that review each file, although they posted more comments. Only 1 of 30 sampled comments at PR level was partly addressed. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [VENDOR] GitHub reports about 5.1 comments for each Copilot code review. GitHub says that this volume did not increase the rework in review or lower its quality bar. 29% of reviews have no comment. Source: [GitHub blog, March 2026](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [VENDOR] Cursor reports that the number of bugs flagged in each run went from 0.4 to 0.7. In the same period, the resolution rate went from 52% to more than 70%. Resolved bugs for each PR went from about 0.2 to about 0.5. Source: [Cursor blog](https://cursor.com/blog/building-bugbot)
- [VENDOR] Before its filter, Greptile could post up to 10 comments on a PR with 20 changes. 79% of its comments were nits. Source: [Greptile blog](https://greptile.com/blog/make-llms-shut-up)
- [UNCONFIRMED] A third-party comparison says that Graphite Diamond was the quietest tool, at 0.62 comments for each PR, with the highest precision and the lowest recall. I saw this value only in search results and did not open the page. Source: [SoftwareSeni comparison](https://www.softwareseni.com/how-ai-code-review-tools-compare-on-real-bug-detection-and-noise)

#### Fixed maximums and sorted cuts

- [BUILDER] Kuaishou's system gives each comment 3 scores from 1 to 7: nitpick, fake problem and severity. It discards a comment if the nitpick score or the fake problem score is 4 or less. It sorts the other comments by the severity score and keeps the Top-N. Source: [Lu et al., ICML 2025](https://arxiv.org/html/2505.17928v2)
- [BUILDER] In the Kuaishou offline benchmark with 1 reviewer, Top-10 kept a key bug inclusion (KBI) of 32.59%. Top-5 kept 25.93%, and Top-3 kept 17.78%. The false alarm rate FAR1 changed only from 91.13 to 90.00. The best full configuration used Top-5. Source: [Lu et al., ICML 2025](https://arxiv.org/html/2505.17928v2)
  - Note: the benchmark uses changes from historical crash reports. KBI is the share of the known key bugs that the comments include. FAR1 and FAR2 are 2 false alarm rates that the paper defines. I did not check the exact definitions of FAR1 and FAR2.
- [VENDOR] Qodo PR-Agent limits its "improve" tool to a number of suggestions for each code chunk. The documented default is 3, 4 or 5, by version. A score threshold has a default of 0, and the docs advise a value of not more than 7 or 8. Source: [Qodo docs, improve tool](https://qodo-merge-docs.qodo.ai/tools/improve). [UNCONFIRMED: I saw these values in search results of the docs and did not open the configuration file.]
- [BUILDER] [IND] [CO-BLOG] RovoDev, BitsAI-CR, AutoCommenter, the Ericsson tool, RevMate and Uber uReview state no fixed maximum number of comments for each review. Sources: [RovoDev](https://arxiv.org/html/2601.01129v2), [BitsAI-CR](https://arxiv.org/html/2501.15134v1), [AutoCommenter](https://arxiv.org/html/2405.13565v1), [Ericsson](https://arxiv.org/html/2507.19115v2), [RevMate](https://arxiv.org/html/2411.07091v1), [Uber](https://www.uber.com/us/en/blog/ureview/)

#### Volume and noise as developers see them

- [IND] Wessel et al. list too many bot actions as a source of noise on PRs. Source: [Wessel et al., arXiv 2103.13950](https://arxiv.org/abs/2103.13950). [From the abstract.]
- [IND] For human reviews at Microsoft, the share of useful comments falls as the number of files in the change goes up. The authors recommend smaller changes. Source: [Bosu, Greiler and Bird, MSR 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)
- [IND] In the agentic review study, AI comments had 29.6 tokens for each line of code, against 4.1 for human comments. 85% to 87% of the reviews that an AI agent started ended after the first comment, with no reply. Source: [arXiv 2603.15911](https://arxiv.org/html/2603.15911v1)

### Inferences

- Inference: A fixed maximum alone does not make comments more precise. In the Kuaishou ablation, a smaller Top-N lost key bugs, and the false alarm rate stayed about the same. Precision comes from the filter before the cut.
- Inference: The deployments with the best documented action rates post fewer than about 2.5 comments for each PR on average. Atlassian posts 2.1 comments for each PR, and Cursor flags 0.4 to 0.7 bugs in each run. GitHub also permits a review with no comment.
- Inference: Use a maximum as a guard against bursts, not as the main control. A maximum of about 3 to 5 comments for each PR agrees with the reported volumes, but no study tested a specific value.
- Inference: If the system must cut, sort by severity and confidence first. Keep the other findings available on request, so that the cut does not delete them. No study tested this design.
- Inference: Remove comments on unchanged lines, comments on old issues and duplicates across iterations. Tricorder, Infer, AutoCommenter, Cursor and the Beko complaints give direct support.
- Inference: Expect fewer useful comments on large changes. The human data from Microsoft shows this effect, but no data exists for AI comments.

### Gaps

- No controlled experiment varies the maximum number of AI comments and measures the action rate.
- No study reports the action rate of AI comments as a function of the number of comments on the same PR.

## 3. Which comment properties raise acceptance: specificity, a concrete failure scenario, a suggested fix or patch, the severity, the location, the tone, the length, an explanation of why?

### Takeaway

The best evidence supports 4 properties: a fix that the author can apply, a precise location, a short text and a clear reason. The location must be on changed lines, near the code to change. The message must say why and how to fix. Google removed visible severity levels and showed only important findings. No study isolates the effect of a concrete failure scenario, of severity labels on AI comments, or of the tone of AI comments.

### Cited Findings

#### A suggested fix or patch

- [IND] In the GitHub Actions study, the share of code in the comment was the strongest feature. The addressed rate went from 4.2% for comments with no code to 23.2% for comments where code was more than 52% of the text. For human comments, the same bins went from 71.2% to 89.9%. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [IND] The same study used a random forest model and SHAP, a method that explains model predictions. It reports ρ = 0.89 for the ratio of code to text and ρ = 0.67 for multiline code. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [BUILDER] Google's ML-suggested edits resolved 4.9% of all reviewer comments in version 1 and 7.5% in version 2. Authors applied 45.6% of the edits that they previewed in version 1, and 69.5% in version 2. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [BUILDER] In version 2, the reviewer sees the suggested edit while the reviewer types the comment. Reviewers accepted 63.6% of the predictions and attached them to their comments. Because the reviewer filters the edits, Google lowered the minimum precision from 50% to 40%. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [CO-BLOG] Google's blog reports that authors applied 40% to 50% of the edits that they previewed. A "Show ML-edit" button next to the comment raised the preview rate from about 20% to about 40%. Source: [Google Research blog, 2023](https://research.google/blog/resolving-code-review-comments-with-ml/)
  - Note: the paper gives about 30% for the preview rate after the same change in version 1. The blog and the paper do not agree on this value.
- [BUILDER] At Meta, authors applied 19.75% of the AI fixes for actionable comments with the best fine-tuned model. With GPT-4o, they applied about 10.5% to 10.7%. Authors applied 28.74% of the fixes that they saw. Source: [Maddila et al., arXiv 2507.13499, "AI-Assisted Fixes to Code Review Comments at Scale"](https://arxiv.org/html/2507.13499v1)
- [BUILDER] Meta shows a patch only if it passes the build, lint and test checks, or if a reviewer approves it. Source: [Maddila et al., arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [BUILDER] Google surveyed developers who received a fix patch for code that was already checked in. 57% were happy to receive it, 41% were neutral, and 2% were negative. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Google requires that a code review check gives guidance on how to fix the issue. A compiler check should include a fix that a tool can apply mechanically, when possible. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [IND] "No suggested fixes" is one of the pain points of program analyzers in the Microsoft survey. The figure lists it fifth. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [BUILDER] 11 of 12 interviewed BitsAI-CR experts asked for custom rules and for an apply action with 1 click. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [IND] Incorrect suggested code was the largest reason why developers did not adopt AI suggestions, at 28.7% of a sample of 383. Source: [arXiv 2603.15911](https://arxiv.org/html/2603.15911v1)

#### Location and scope

- [IND] Tools that comment on each hunk generally did better than tools that comment on each file. PR-level comments almost never led to a change. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [BUILDER] Google removed suggested edits that were more than 5 lines away from the comment. This change reduced thumbs down clicks on previewed edits from 8.5% to 6.7%. Google also removed edits that only added a promise to do the work later, because users gave them thumbs down. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [IND] For human comments at Microsoft, a code change within 1 line of the commented text was a strong signal of a useful comment. The signal had 88% precision and 78% recall. Source: [Bosu, Greiler and Bird, MSR 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)
- [BUILDER] The Ericsson tool gives the LLM the method that encloses the changed lines. In a check of 5 changes, it commented only on changed lines. Source: [Ericsson, arXiv 2507.19115, ICSME 2025](https://arxiv.org/html/2507.19115v2)
- [IND] At Beko, developers complained about suggestions for code outside the scope of the task. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)

#### Length and verbosity

- [IND] In the GitHub Actions study, longer text had a negative association with code changes, ρ = −0.24. The authors conclude that concise comments are more likely to lead to changes. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [IND] Of 119 RevMate comments that reviewers accepted, 82 were published without change, and 25 were shortened. 5 were extended, and 7 were changed in other ways. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] AI comments had about 7 times more tokens for each line of code than human comments, 29.6 against 4.1. AI suggestions also had a much lower adoption rate. This is a correlation, not a proven cause. Source: [arXiv 2603.15911](https://arxiv.org/html/2603.15911v1)
- [BUILDER] Ericsson developers said that the reviews were too verbose. The authors write that LLMs typically generate verbose reviews. One prompt asked for about 200 words, and another asked for less than 50 words and no code. Source: [Ericsson, arXiv 2507.19115](https://arxiv.org/html/2507.19115v2)

#### An explanation of why, and the text of the message

- [BUILDER] For 1 Tricorder analyzer, 75% of the bugs filed against it came from users who misunderstood the text of the message. The team fixed them with new message text or a link to more documentation. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] Coverity writes that a misunderstood explanation makes users ignore the error or label it as a false positive. For many years, Coverity did not ship concurrency checkers, because the errors were too hard to explain. Source: [Bessey et al., CACM 2010](https://6826.csail.mit.edu/2019/papers/coverity.pdf)
- [IND] In the Microsoft survey, "Bad warning messages" is second in the list of pain points. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [CO-BLOG] At Uber, comments about best practices scored well, especially with examples or links to internal documentation. Source: [Uber, uReview blog](https://www.uber.com/us/en/blog/ureview/)
- [BUILDER] Each AutoCommenter comment links to a document about the best practice. Raters found that some summaries were absent or did not explain why the guideline applied to the code. The team rewrote the summaries of frequent links by hand. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] Google requires that a code review check is easy for any engineer to understand. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)

#### A concrete failure scenario

- [BUILDER] Zoncolan comments directly on a diff only for categories with very high signal. The comment explains the vulnerability and how an attacker can exploit it. It also gives references to past incidents. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] Kuaishou's filter discards comments that it rates as a likely fake problem. Source: [Lu et al., ICML 2025](https://arxiv.org/html/2505.17928v2)
- [IND] False positives are a main reason why developers rejected CodeRabbit comments. Source: [arXiv 2607.03316](https://arxiv.org/abs/2607.03316)
- I found no study that compares the acceptance of comments with and without a concrete failure scenario.

#### Severity

- [BUILDER] Tricorder removed all priority and severity ratings from its results. It tries to show only results of high priority, and it improves analyzers when users flag results as not important. Google made this change to stop customization for each user, which gave each user a different view. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] Google's Clang team made new checks compiler errors, not warnings, because the team found that Google developers ignored warnings. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Facebook sets the balance of false positives and missed bugs by severity. For security and privacy issues, the tolerance for false positives is higher. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] The Facebook concurrency analysis had a fix rate of about 50%, lower than the general diff analysis. Developers still valued the reports, because concurrency bugs are hard to debug. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] Zoncolan uses a severity scale from 1 to 5, where 3 or more is severe. Categories with high signal go directly to the diff as comments. Other alarms go to a security engineer on call, or to a list for the full codebase. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] Kuaishou uses its severity score only to sort and cut comments. Source: [Lu et al., ICML 2025](https://arxiv.org/html/2505.17928v2)
- [IND] In a controlled experiment, reviewers who started from an LLM review found more low severity issues. They did not find more high severity issues. Source: [Tufano et al., ICSE 2025, "Deep Learning-based Code Reviews: A Paradigm Shift or a Double-Edged Sword?"](https://arxiv.org/html/2411.11401v3)
- [CO-BLOG] Microsoft's AI reviewer gives each suggestion a category, for example exception handling, null check or sensitive data. The blog does not describe a severity scale. Source: [Microsoft blog, July 2025](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/)
- [VENDOR] GitHub says that Copilot code review gives priority to important logic and maintainability issues. It publishes no severity scale. Source: [GitHub blog, March 2026](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)

#### Tone and sentence form

- [IND] For human comments at Microsoft, comments with command verbs were more likely to be useful. Examples are assert, expand, fix, remove and move. Requests with "please", "should" or "may be" were also more likely to be useful. Questions with "why", "which" or "how" were more likely to be not useful. Source: [Bosu, Greiler and Bird, MSR 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)
- [IND] An automatic sentiment tool rated 51% of the comments in the Bosu sample as extremely negative. Only 57% of these comments were useful. About 79% of comments with a neutral or somewhat negative tone were useful. Source: [Bosu, Greiler and Bird, MSR 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)
- I found no study about the tone of AI review comments.

#### Who sees the comment, and when

- [BUILDER] Tricorder shows findings to the author and to the reviewer. The reviewer can click PLEASE FIX and can see if the author ignored a finding. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] At Google, reviewers typically keep their approval until the author addresses all comments, manual and automated. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Google cut the trigger delay to 500 milliseconds and made predictions faster. Reviewer previews then went up 12%, and author acceptance went up 18%. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [BUILDER] When Meta showed AI patches to reviewers, the time in review went up 5.5%, and the active time spent went up 6.7%. When Meta collapsed the patches for reviewers, there was no significant regression. Authors accepted patches at a similar rate in both cases. Source: [Maddila et al., arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [IND] AI comments that a developer triggered manually had an addressed rate of 14.4%, against 9.0% for automatic comments. The overall difference was not significant, but it was significant for 2 tools. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [IND] Authors with 30 or fewer earlier commits addressed 16.1% of AI comments. Authors with 1,013 to 4,316 earlier commits addressed 3.3%. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)

### Inferences

- Inference: Give each comment 1 finding, on a changed line, near the code that must change. Hunk-level location, edits near the comment, and the scope of changed lines all have support.
- Inference: Add a patch that the author can apply when the confidence is high. Check the patch with a build, lint and tests before the tool shows it. A wrong patch is the most frequent reason for non-adoption, so do not show patches with low confidence.
- Inference: Keep the text short. Give a short statement of the problem, a short reason and the fix. Long text has a negative association with action.
- Inference: Include the reason and the effect: what fails, when it fails, and why it matters. Link to the rule or the documentation for best practices. The direct evidence for a failure scenario is weak, but the evidence for clear explanations is strong.
- Inference: Do not show many severity levels. Tricorder removed visible severity and showed only important findings. A design can use severity inside the system to sort and filter, and then show only the top level. A lower level can stay available on request.
- Inference: Write direct statements, not questions. Human data shows that questions are less useful. No data exists for AI comments.
- Inference: Show AI comments and patches first to the author. A step where the reviewer endorses a comment raised action at Google, but extra AI content for reviewers cost review time at Meta.

### Gaps

- No study compares comments with and without a concrete failure scenario.
- No study measures the effect of severity labels on the action rate of AI comments.
- No study measures the effect of tone in AI comments.
- The effects of length and of code share come from observational data, so they are correlations.

## 4. Which categories of comment do developers act on most and least (bugs, style, maintainability, nitpicks)?

### Takeaway

Developers say that security and correctness matter most, and that default style rules annoy them. Human code review produces mostly maintainability changes, at a ratio of about 75 to 25. For LLM comments, the evidence is mixed. At Mozilla and Ubisoft, reviewers accepted refactoring comments more often than functional comments, because many functional comments were wrong. Teams with high action rates suppress nits, style, log tweaks and low-impact performance comments, and they keep correctness, error handling and documented best practices.

### Cited Findings

#### Human code review baselines

- [IND] In 2 open source projects, the changes that review caused had a ratio of 75 to 25 between maintainability problems and functional problems. 7% to 35% of review comments were discarded. 10% to 22% of changes came without an explicit review comment. Source: [Beller et al., MSR 2014, "Modern Code Reviews in Open-Source Projects: Which Problems Do They Fix?"](https://repository.tudelft.nl/record/uuid:8747d363-137b-4a9a-a02a-f8aebd26c674)
- [IND] At Microsoft, developers rated most comments about functional defects as useful. More than 60% of the somewhat useful comments were about evolvability: documentation, visual representation, organization and the solution approach. Most comments that were not useful were reviewer false positives or did not fit a category. Source: [Bosu, Greiler and Bird, MSR 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)
- [IND] A classifier rated 65.5% of 1,496,340 comments from 5 Microsoft projects as useful. The projects were between 64% and 68%. Source: [Bosu, Greiler and Bird, MSR 2015](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bosu2015useful.pdf)

#### What developers say they want

- [IND] In the Microsoft survey, developers ranked security issues as the most important type to detect, then best practices. Style, portability and power consumption were near the bottom of the list. Some default rules, for example Hungarian notation or checks for misspelled words, annoyed developers. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)

#### LLM comments by category

- [IND] At Mozilla and Ubisoft, reviewers accepted refactoring comments from RevMate at 18.2% and 18.6%. They accepted functional comments at 4.8% and 5.2%. Functional comments were 79.2% and 84.8% of all generated comments. The difference is significant, with a large effect size. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] The CodeRabbit study reports that agentic reviews focus more on functional concerns than on evolvability, and that they were more likely to be invalid. Source: [arXiv 2607.03316](https://arxiv.org/abs/2607.03316)
- [IND] In the agentic review study, developers adopted 16.7% of AI defect suggestions and 16.8% of AI code improvement suggestions. AI suggestions about external impact got 6.5%, and AI suggestions about tests got 7.6%. For human reviewers, code improvement got 59.2%, defects 53.7% and knowledge transfer 75.8%. Source: [arXiv 2603.15911](https://arxiv.org/html/2603.15911v1)
- [CO-BLOG] At Uber, developers consistently rated readability nits, small tweaks to log statements, low-impact performance optimizations and style issues as poor. Correctness bugs, absent error handling and best practice violations scored well. Uber suppresses categories with low historic value. Source: [Uber, uReview blog](https://www.uber.com/us/en/blog/ureview/)
- [BUILDER] BitsAI-CR precision by category after the filter: performance issues 72.00%, code defects 68.92%, maintainability 63.60%, security vulnerabilities 61.29%. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [BUILDER] The BitsAI-CR "Outdated Rate" is the share of comments whose flagged lines changed in later commits. By category, it was 41.37% for data format, conversion and comparison errors. It was 27.58% for null pointer exceptions and 18.87% for magic numbers and strings. Null pointer comments were 22.79% of all comments, and magic number comments were 20.62%. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [BUILDER] BitsAI-CR retrains rules with low precision. It can remove rules with high precision but a consistently low Outdated Rate, because correct comments that nobody acts on still count against the system. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [BUILDER] AutoCommenter produced some correct comments with low value, for example about an absent period that human reviewers often let pass. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] For 33 of 50 sampled best practices, 66%, AutoCommenter's authors judged detection to be outside the scope of traditional static analysis. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] Meta generates fixes only for comments that a code change can address. It excludes questions, code pointers, knowledge transfer and general discussion. The fixes worked well for loop conversions, small style changes, renames and replaced function calls. Source: [Maddila et al., arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [BUILDER] Google's acceptance of ML-suggested edits was 9.5% for Java, 7.5% for C++ and 7.1% for Python. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [IND] The SHAP analysis of the GitHub Actions study found positive associations with code changes for 3 topics. These topics are concurrency and locks, user interface and accessibility, and error handling and documentation. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [VENDOR] Before its filter, 79% of Greptile's comments were nits. Source: [Greptile blog](https://greptile.com/blog/make-llms-shut-up)

#### Static analysis categories

- [BUILDER] Google uses compiler errors only for correctness, not for style or best practices. Code review is a good place for less important issues, for example style or simpler code. At compile time, such issues frustrate developers. At review time, developers have a critical mindset and are more receptive to readability and style details. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] The Facebook concurrency analysis had a fix rate of about 50%. The general diff analysis had more than 70%. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)

### Inferences

- Inference: Give the highest priority to correctness, error handling, security, concurrency and resource issues. Developers say that these matter most, and the Uber and BitsAI-CR data support action on them.
- Inference: Leave style and format issues to formatters and linters with automatic fixes. Do not post them as LLM comments. Each team with high action rates removed nits.
- Inference: Refactoring comments can get action when they are short and come with a patch. They also carry a risk of a "trivial" label, so use a strict filter for them.
- Inference: The main limit for LLM functional comments is precision. RevMate and the CodeRabbit study show that LLM functional comments are often wrong. A validator stage for functional findings is necessary.
- Inference: Track the action rate for each category. Turn off categories with low action, even when their precision is high.

### Gaps

- The studies use different category lists. No common taxonomy permits a direct comparison.
- I found little data on the action rates of AI comments about tests, documentation or names. The only values come from small sets in RevMate and in the agentic review study.

## 5. What did industrial studies of LLM code review find? For example at Google, Meta, Microsoft, Ericsson, Beko, Mozilla, Atlassian or Tencent, with acceptance or resolution rates.

### Takeaway

Reported action rates of LLM review comments go from about 1% to more than 80%, but the metrics differ. Independent studies of open source projects found 0.9% to 36.4% action, against 56.5% to 60% for human comments. Company tools with strong filters report rates from 38.70% to more than 80%, by different metrics. Atlassian and Uber compare with human comments at the same company: 38.70% against 44.45%, and 65% against 51%. The effects on speed are mixed. Atlassian and Microsoft report shorter PR cycles, Beko saw longer PR closure times, and a controlled experiment saw no time saved.

### Cited Findings

#### Summary table: company and independent studies

| Organization | Tool | Label | Metric and value | Human baseline | Scale | Source |
|---|---|---|---|---|---|---|
| Google | ML-suggested edits that resolve reviewer comments | [BUILDER] | Share of all reviewer comments that authors resolved with an applied ML edit: 7.5% in version 2; 4.9% in version 1 | None | All Google engineers | [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf) |
| Google | AutoCommenter, for best practices | [BUILDER] | Useful ratio from feedback: 54%, then 66% after link suppression; over 80% in the lessons section. Estimated comment resolution rate: about 40% | None | Tens of thousands of developers | [arXiv 2405.13565](https://arxiv.org/html/2405.13565v1) |
| Meta | MetaMateCR, fixes for reviewer comments | [BUILDER] | ActionableToApplied 19.75%; ShownToApplied 28.74% | GPT-4o: about 10.5% to 10.7% ActionableToApplied | Tens of thousands of comments each week | [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1) |
| Microsoft | Internal AI reviewer for PRs | [CO-BLOG] | Median PR completion time 10% to 20% better in 5,000 repositories. No acceptance rate published | None | Over 90% of PRs; over 600,000 PRs each month | [Microsoft blog](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/) |
| Atlassian | RovoDev Code Reviewer, a product that Atlassian sells | [BUILDER] | Code resolution rate 38.70% | Human comments 44.45% | Over 1,900 repositories; over 54,000 comments; 2.1 comments for each PR | [arXiv 2601.01129](https://arxiv.org/html/2601.01129v2) |
| Beko | CodeReviewBot, based on Qodo PR-Agent and a GPT-4 model | [IND] | Comments labeled Resolved 73.8%; Won't Fix 21.3% | None | 4,335 PRs in 3 projects; 1,568 PRs after adoption | [arXiv 2412.18531](https://arxiv.org/html/2412.18531v2) |
| Mozilla and Ubisoft | RevMate | [IND] | Comments that reviewers accepted for publication: 8.1% and 7.2% | Accepted comments caused chunk revisions at 73.9%, against 73.2% for human comments at Ubisoft | 59 reviewers; 587 patch reviews; about 1,600 comments | [arXiv 2411.07091](https://arxiv.org/html/2411.07091v1) |
| Ericsson | LLM with context from static analysis | [BUILDER] | 4 of 9 developers said that the tool saved time | None | 9 developers for 15 days | [arXiv 2507.19115](https://arxiv.org/html/2507.19115v2) |
| ByteDance | BitsAI-CR | [BUILDER] | Precision 75.0% at peak; Outdated Rate 26.7% for Go | Human Outdated Rate 35% to 46% | Over 12,000 weekly active users | [arXiv 2501.15134](https://arxiv.org/html/2501.15134v1) |
| Kuaishou | Multi-role review with code slices | [BUILDER] | Offline only: KBI 31.11% with FAR1 87.81 in the best configuration | None | No online acceptance data | [arXiv 2505.17928](https://arxiv.org/html/2505.17928v2) |
| Uber | uReview | [CO-BLOG] | Marked useful 75%; addressed in the same changeset 65% | Human comments: 51% addressed as bugs in the same changeset | Over 90% of about 65,000 weekly diffs | [Uber blog](https://www.uber.com/us/en/blog/ureview/) |
| HiThink Research | SGCR | [BUILDER] | Developer adoption rate 42% | Baseline LLM 22% | Not in the abstract | [arXiv 2512.17540](https://arxiv.org/abs/2512.17540) |
| Tencent | LLM filter for static analysis alarms | [BUILDER] | Removed 94% to 98% of false positives. [UNCONFIRMED in the full text] | Manual review takes 10 to 20 minutes for each alarm | 433 alarms | [arXiv 2601.18844](https://arxiv.org/abs/2601.18844) |
| Open source, GitHub | 16 AI review GitHub Actions | [IND] | Valid and addressed: 0.9% to 19.2% for each tool | Valid human comments: 60% | 22,326 comments; 178 repositories | [arXiv 2508.18771](https://arxiv.org/html/2508.18771v2) |
| Open source, GitHub | 16 AI review bots and agents | [IND] | Code suggestions adopted: 16.6% | Human code suggestions: 56.5% | 278,790 conversations; 300 projects | [arXiv 2603.15911](https://arxiv.org/html/2603.15911v1) |
| Open source, GitHub | CodeRabbit | [IND] | Accepted 36.4%; discussed 7.3%; rejected 56.3% | None | 31,073 pairs; 10,191 PRs; 239 repositories | [arXiv 2607.03316](https://arxiv.org/abs/2607.03316) |

#### Google

- [BUILDER] Version 1 of the ML edits: 34.3% of all comments got a confident prediction at a 50% precision target. Authors previewed edits for 10.7% of all comments and applied edits for 4.9%. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [BUILDER] Version 2 of the ML edits: 49.0% of all comments got a prediction at a 40% precision target. Reviewers accepted the prediction for 33.1% of all comments. Authors previewed edits for 10.7% of all comments and applied edits for 7.5%. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [BUILDER] Weekly acceptance after full deployment was 5.4% to 7.5% of all comments. It reached 9.4% in the beta. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [CO-BLOG] Google expected the ML edits to save hundreds of thousands of engineer hours each year. This is a projection, not a measured result. Source: [Google Research blog, 2023](https://research.google/blog/resolving-code-review-comments-with-ml/)
- [BUILDER] AutoCommenter had a staged rollout. It started with about 3,000 volunteers in July 2022. An experiment with about half of all developers followed in July 2023, and general availability in October 2023. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] AutoCommenter estimated its comment resolution rate at about 40%. In an automated check of 6,000 pairs of snapshots, the comment was absent from the final snapshot in 50% of cases. In a manual check of 40 pairs, the author directly resolved 80% of those. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)

#### Meta

- [BUILDER] Offline, the best fine-tuned Llama model produced an exact-match patch 68% of the time, 9 points above GPT-4o. Source: [Maddila et al., arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [BUILDER] In production, ActionableToApplied was 19.75% for the best model, 16.13% for a smaller fine-tuned model, and about 10.5% to 10.7% for GPT-4o. ShownToApplied was 28.74%, 27.55%, and about 19.9% to 21.3%. Source: [Maddila et al., arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [BUILDER] Meta's actionability classifier had a precision of 0.86 and a recall of 0.85. Source: [Maddila et al., arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- Note: the Meta paper is not consistent in some values. For example, it gives the gain over GPT-4o as 9.2 points in one place and 6.6 points in another place.

#### Microsoft

- [CO-BLOG] The AI reviewer joins each new PR as a reviewer and leaves comments like a human reviewer. A suggested code change needs an explicit "apply change" click. Teams can add repository guidelines and custom prompts. Reviewers can talk with the assistant in the PR thread. Source: [Microsoft blog, July 2025](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/)
- [CO-BLOG] The blog gives no acceptance rate, no false positive rate and no number of comments for each PR. Source: [Microsoft blog, July 2025](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/)

#### Atlassian

- [BUILDER] The median PR cycle time fell from 20.73 hours to 14.35 hours, a reduction of 31%. The abstract gives 30.8%. Source: [RovoDev Code Reviewer, arXiv 2601.01129](https://arxiv.org/html/2601.01129v2)
- [BUILDER] Human-written comments for each PR fell from 4.45 to 2.87, a reduction of 35.6%. Source: [RovoDev Code Reviewer, arXiv 2601.01129](https://arxiv.org/html/2601.01129v2)
- [BUILDER] In 7% of PRs, at least 1 RovoDev comment aligned with a human comment. Source: [RovoDev Code Reviewer, arXiv 2601.01129](https://arxiv.org/html/2601.01129v2)
- [BUILDER] The pipeline uses Claude 3.5 Sonnet with zero-shot prompts. A gpt-4o-mini judge checks factual correctness. A ModernBERT classifier checks actionability. The team trained it on more than 50,000 comments with a label that shows if the comment led to a resolution. Source: [RovoDev Code Reviewer, arXiv 2601.01129](https://arxiv.org/html/2601.01129v2)
- [BUILDER] In the ablations, review guidelines, the task definition and the code changes were the most important parts of the prompt. A persona, chain of thought, PR information and Jira information each changed results by only 1 to 3 points. Source: [RovoDev Code Reviewer, arXiv 2601.01129](https://arxiv.org/html/2601.01129v2)
- [VENDOR] An Atlassian blog reports that context from similar Jira issues raised the resolution rate from 45.9% to 59.3% in 34 runs. The sample is small. Source: [Atlassian blog, PR context](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [VENDOR] The same blog reports that context from other repositories added noise, so Atlassian kept retrieval in the same repository. Source: [Atlassian blog, PR context](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)

#### Beko

- [IND] The average PR closure time went from 5 hours 52 minutes to 8 hours 20 minutes. 2 projects got slower, and 1 project got faster. The conclusion of the paper gives different values, 50 and 48 minutes, so the paper is not consistent. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] The resolved share was 55% in 1 project and 90% in another project. The paper does not give the value for the third project. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] Human comments for each PR went from 0.31 to 0.28. The change was not significant overall. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] In a survey of 22 practitioners, 14 saw a minor improvement in code quality. For development speed, 8 saw a minor improvement, 4 saw no effect, 3 saw a minor deterioration and 2 saw a major improvement. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] One practitioner warned that reviewers can skip issues, because they expect the bot to report every issue. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] The bot used about 3,937 tokens for each PR, at a cost of 0.48 US dollars. The paper names the model in different ways: GPT-4 Turbo and GPT-4 32K. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)

#### Mozilla and Ubisoft

- [IND] Reviewers did not publish 14.6% and 20.5% of comments, but they found them useful as tips. Accepted comments plus tips were 23.0% at Mozilla and 28.3% at Ubisoft. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] At Ubisoft, the median time for the evaluation of the generated comments was 42.9 seconds for each patch. 24 of 37 reviewers said that the evaluation slowed their reviews to some degree. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] 23 of 37 reviewers would use such a tool at least sometimes. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] At Ubisoft, accepted generated comments led to line revisions in 62.3% of cases, against 64.3% for human comments. They started discussion threads less often: 23.2% against 33.9%. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)
- [IND] RevMate uses a second LLM pass as a judge. It keeps comments that are applicable, consistent with the code, about likely bugs or readability regressions, and that suggest code changes. It removes descriptive comments and praise. Source: [Olewicki et al., arXiv 2411.07091](https://arxiv.org/html/2411.07091v1)

#### Ericsson

- [BUILDER] In a first survey, 8 experienced developers gave 6 positive, 8 neutral and 10 negative ratings. Source: [Ericsson, arXiv 2507.19115](https://arxiv.org/html/2507.19115v2)
- [BUILDER] In a trial of 15 days with 9 developers, 4 rated the tool effective or highly effective, 2 somewhat effective and 3 not very effective. Source: [Ericsson, arXiv 2507.19115](https://arxiv.org/html/2507.19115v2)
- [BUILDER] 4 developers said that reviews sometimes only explained the code. 2 said that reviews were factually incorrect. 3 said that reviews focused on irrelevant areas. Source: [Ericsson, arXiv 2507.19115](https://arxiv.org/html/2507.19115v2)
- [BUILDER] The authors conclude that simple prompts do not work well, and that changes to the prompt style alone were not sufficient. Source: [Ericsson, arXiv 2507.19115](https://arxiv.org/html/2507.19115v2)

#### ByteDance

- [BUILDER] In 18 weeks, the precision of the first stage rose from 27.9% to 62.6%. The precision after the filter stage rose from 35.6% to a peak of 75%. The paper reports different overall precision values in different sections. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)
- [BUILDER] A rule stays in production only if it keeps an Outdated Rate of about 25% and a precision of about 65% for 14 days. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)

#### Uber

- [CO-BLOG] To find if a comment was addressed, Uber runs uReview 5 times on the final commit. If no run produces a similar comment, the comment counts as addressed. Source: [Uber, uReview blog](https://www.uber.com/us/en/blog/ureview/)
- [CO-BLOG] The best pair of models was Claude 4 Sonnet as the generator and o4-mini-high as the grader. A second prompt grades each comment, and Uber sets the thresholds for each assistant, language and category. Source: [Uber, uReview blog](https://www.uber.com/us/en/blog/ureview/)
- [CO-BLOG] Uber estimates that uReview saves about 1,500 hours each week. The median latency is 4 minutes. Source: [Uber, uReview blog](https://www.uber.com/us/en/blog/ureview/)
- Note: the Uber blog gives about 65,000 diffs each week in one place and 65,000 each month in another place.

#### Controlled experiments and field experiments

- [IND] In the Tufano experiment, 29 developers did 72 reviews in 3 treatments. Reviewers kept about 89% of the issues that the LLM found, by the average of the authors. Source: [Tufano et al., ICSE 2025](https://arxiv.org/html/2411.11401v3)
- [IND] The mean review time was 42 minutes for manual reviews and 56 minutes for reviews that started from an LLM review. The differences in time and in confidence were not significant. Source: [Tufano et al., ICSE 2025](https://arxiv.org/html/2411.11401v3)
- [IND] Reviewers who started from the LLM review focused on the locations that it flagged. Manual reviewers covered 484 distinct lines, and reviewers with the LLM review covered 371. Source: [Tufano et al., ICSE 2025](https://arxiv.org/html/2411.11401v3)
- [IND] The authors conclude that automated reviews can be a useful complement at the end of a manual review. Source: [Tufano et al., ICSE 2025](https://arxiv.org/html/2411.11401v3)
- [IND] At WirelessCar, 10 developers reviewed 2 PRs with 2 prototypes. One prototype gave an LLM review at the start, and the other answered on request. Developers preferred the review at the start for large or unfamiliar PRs. The preference changed with familiarity and risk, and the authors suggest a hybrid. Source: [Aðalsteinsson et al., ESEM 2025, arXiv 2505.16339](https://arxiv.org/abs/2505.16339). [From the abstract, through search. I did not read the full text.]

#### Vendor claims

- [VENDOR] GitHub: Copilot code review passed 60 million reviews and does more than 1 in 5 code reviews on GitHub. It gives actionable feedback in 71% of reviews and averages about 5.1 comments for each review. Source: [GitHub blog, March 2026](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [VENDOR] GitHub: a reasoning model raised positive feedback by 6% and latency by 16%. An agentic architecture raised positive feedback by 8.1%. GitHub gives no false positive rate and no resolution rate. Source: [GitHub blog, March 2026](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [VENDOR] Cursor: the Bugbot resolution rate went from 52% at launch in July 2025 to more than 70% by January 2026. An LLM judge at merge time decides which bugs the author resolved. Bugbot reviews more than 2 million PRs each month. Source: [Cursor blog](https://cursor.com/blog/building-bugbot)
- [UNCONFIRMED] A Cursor guide says that the Bugbot resolution rate reached about 80% by May 2026. A Cursor comparison gives 78.13% for Bugbot, 63.49% for Greptile and 48.96% for CodeRabbit. I saw these values only in search results. Source: [Cursor guide](https://cursor.com/guides/ai-code-review)
- [VENDOR] Graphite: about 52% of Diamond comments led to changes, against about 45% to 50% for human comments. The speaker gave no sample size and no method. Source: [AI Engineer talk page, Graphite](https://ai.engineer/talks/don-t-get-one-shotted-use-ai-to-test-review-merge-and-deploy-code-tomas-reimers-graphite)
- [VENDOR] Greptile: the address rate went from 19% to more than 55% after the embedding filter. Source: [Greptile blog](https://greptile.com/blog/make-llms-shut-up)

### Inferences

- Inference: An LLM reviewer can come near the human action rate only with strong filters after generation, trained or tuned on action outcomes. Atlassian, ByteDance, Uber, Greptile and Cursor all report this pattern.
- Inference: Independent studies of open source tools show much lower rates than company reports. Selection of repositories and differences in metrics can explain part of the gap. Treat company and vendor values as upper bounds.
- Inference: A faster review is not guaranteed. The effect depends on who must read the AI output. Show AI output to the author, and do not give the reviewer extra work.
- Inference: Measure action with a change near the comment, or with a second run on the final code. Explicit feedback is too rare for a reliable metric.
- Inference: Human comments are also not always acted on: 44.45% at Atlassian, 51% at Uber and about 60% in open source. A realistic target for AI comments is a rate near the human rate for the same team, not 100%.

### Gaps

- Tencent: I found no acceptance data for LLM review comments.
- Microsoft: I found no acceptance data.
- Google: I did not find a 2025 or 2026 paper with acceptance data for comments that a Gemini model generates in Google code review.
- Mozilla: I found no production data after the 6-week study.
- There are few randomized experiments. The Meta trial and the Atlassian context experiments are the main examples.

## 6. Do developers who work through review findings in an IDE before commit act differently from PR comments after push?

### Takeaway

I found no study that compares the action rate of the same LLM findings in the IDE before commit and in PR comments after push. The static analysis evidence says that earlier is better when the finding is precise, fast and easy to fix. Feedback in the review is much better than bug lists after the commit. But results that come too early, while the code still changes, frustrate developers. Also, delivery only in the IDE failed at Google, because developers use many editors. Code review adds social mechanisms that the IDE does not have: the reviewer sees ignored findings and can ask for a fix. Developers say that they prefer results in the editor.

### Cited Findings

#### When and where developers want results

- [IND] In the Microsoft survey, the editor is the preferred place for results by a wide margin. The build output is second, code review third, and a browser fourth. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [IND] 25% of developers want analysis at each compile. 24% want it when the change is complete but before the code review request. 10% want it in nightly builds, 8% with unit tests, and 23% at every stage. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [IND] 21% of developers want results in seconds, and 53% will wait multiple minutes. Developers asked for fast and accurate analysis in the editor, and for slow analysis later. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf)
- [IND] Christakis and Bird report that all 20 participants in the interviews of Johnson et al. wanted notification in the IDE or at build time. Source: [Christakis and Bird, ASE 2016](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/07/ase-2016.pdf), which cites Johnson et al., ICSE 2013.
- [IND] 71% of 56 surveyed developers pay attention to different warning categories in different contexts: local programming, code review and continuous integration. But they do not configure the tools differently for each context. Source: [Vassallo et al., EMSE 2020, "How Developers Engage with Static Analysis Tools in Different Contexts"](https://repository.tudelft.nl/record/uuid:e6e1cae0-e546-4a85-9bd4-9ed78a26359c). [From the abstract, through search.]

#### Static analysis experience with the time of delivery

- [BUILDER] At Google, survey participants judged 74% of the issues flagged at compile time as real problems. For issues found in code that was already checked in, the value was 21%. They judged 6% against 0% as critical. The authors explain this with a survivor effect: later stages already caught the important bugs. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Earlier tools at Google showed results too late, after submission, when developers were less likely to fix them. Other tools showed results too early, while developers still experimented with the code in the editor. Editor tools also could not meet the latency needs on a large codebase. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [BUILDER] Most Google developers did not use IDEs, or did not use them for all tasks, so integration only in the IDE was not possible. Google calls a requirement for a specific IDE not acceptable. An IDE can still call the Tricorder service. Sources: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf); [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] Google calls code review the best point to show analysis warnings before the commit. In review, developers prepare their code for others, so they have a critical mindset. Source: [Sadowski et al., CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf)
- [BUILDER] At Facebook, Infer's fix rate at diff time was over 70%, against near 0% for nightly bug lists. Diff time removes the context switch, because developers come to the review with the context of the change in mind. It also makes the reports relevant to the current work. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] The time to deliver the result matters. A bot that runs an hour or more on a diff can be too late. Infer aims for 15 to 20 minutes on a diff. Source: [Distefano et al., CACM 2019](https://6826.csail.mit.edu/2020/papers/facebook-infer-cacm.pdf)
- [BUILDER] Tricorder expects analyses to finish in 5 to 10 minutes. The mean time for a review of more than 1 line is more than 1 hour. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)

#### LLM tools in the IDE and in code review

- [BUILDER] AutoCommenter runs in code review and in the IDE. Developers gave explicit feedback on about 10% of the comments in code review and on 2% of the diagnostics in the IDE. They hovered over about 50% of the IDE diagnostics. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] The IDE needs a latency of less than 1 second, so AutoCommenter uses greedy decoding there. Beam search had a median latency of 2 seconds. Source: [Vijayvergiya et al., arXiv 2405.13565](https://arxiv.org/html/2405.13565v1)
- [BUILDER] Authors applied 76% of Google's ML-suggested edits in the code review tool and 24% in the IDE. Version 1 had 75% and 25%. Source: [Frömmgen et al., ICSE-SEIP 2024](https://storage.googleapis.com/gweb-research2023-media/pubtools/7525.pdf)
- [BUILDER] Meta lets authors accept AI fixes in the review tool or in a VS Code extension. Developers often prefer to copy the patch into their IDE. Source: [Maddila et al., arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [BUILDER] In code review, Tricorder gives peer accountability: the reviewer sees if the author ignored a finding. Source: [Tricorder, ICSE 2015](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf)
- [IND] Reviewers anchor on the locations that an LLM review flags. Source: [Tufano et al., ICSE 2025](https://arxiv.org/html/2411.11401v3)
- [IND] At Beko, a practitioner said that reviewers can trust the bot too much and skip issues. Source: [Cihan et al., ICSE-SEIP 2025](https://arxiv.org/html/2412.18531v2)
- [IND] At WirelessCar, interviews named frequent context switches and false positives as concerns. Source: [Aðalsteinsson et al., ESEM 2025, arXiv 2505.16339](https://arxiv.org/abs/2505.16339). [From the abstract, through search.]
- [IND] In the GitHub Actions study, AI comments that a developer triggered manually had a higher addressed rate than automatic comments, 14.4% against 9.0%. The overall difference was not significant. Source: [Sun et al., arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)

### Inferences

- Inference: Put fast, precise findings with an automatic fix before the commit, as compiler checks do. Put slower and deeper findings at a checkpoint where the change is complete, before or at the review.
- Inference: Do not run an LLM review on each keystroke or each save. Run it when the developer says that the change is ready, which 24% of the surveyed developers want. This avoids the problem of results that come too early.
- Inference: A pass before the commit loses peer accountability, because nobody else sees ignored findings. If accountability matters, record the local decisions, or carry unresolved findings into the PR.
- Inference: A pass before the commit removes findings before the human reviewer sees the PR. In the Tufano experiment, reviewers focused on the locations that the LLM flagged. A pass before the commit can reduce this effect, but no study tested this.
- Inference: Explicit feedback is even rarer in the IDE than in code review. Use implicit signals, for example an edit at the flagged location.
- Inference: Findings on request did at least as well as automatic findings in the GitHub Actions study. This supports a review that the developer starts in the IDE.

### Gaps

- No controlled or observational study compares the same LLM review findings in the IDE before commit and in PR comments after push.
- No study gives the action rate of LLM findings in a review in the IDE before the commit.
- The static analysis evidence about the time of delivery is older than LLM reviewers.
