# Context for LLM code review: effect on real findings and false positives

Research date: 2026-11-17. The design target is a review skill that an AI coding agent runs over a C and C++ task diff. The skill has facts from a Clang-based static analysis engine. The facts are threads, races, a risk score for each function, the call graph and the code that a change reaches.

Markers on each finding:

- [read]: I read the relevant part of the primary source.
- [abstract]: I saw only the abstract, or text of the primary source that search results quote.
- [unconfirmed]: I saw the claim only in a secondary source, or the sources do not agree.

Source classes on each finding:

- Academic: a paper or preprint by researchers who do not sell the review tool.
- Industrial: a paper by the company that uses the tool internally.
- Vendor: a blog or a page by a company that sells the tool. All vendor numbers are self-reported. Nobody checked them independently.

Abbreviations: LLM (large language model). PR (pull request). SAST (static application security testing). RAG (retrieval-augmented generation). F1 (the harmonic mean of precision and recall). AUC (area under the curve). KBI (key bug inclusion). FAR (false alarm rate). QE (quality estimation). CWE (Common Weakness Enumeration). AST (abstract syntax tree).

## 1. Diff only compared with more context: what do full files, repository retrieval and the call graph add?

### Takeaway

Context from program analysis gave the largest measured gains. Data-flow slices raised KBI from 23.70% to 37.04% and 39.26% on industrial C++ code. Lexical and embedding retrieval of repository code gave no consistent gain. Precision stayed low in all settings without a separate verification step.

### Cited Findings

#### Code context: enclosing function, data-flow slices, files and repository

- [read] ICML 2025 paper, industrial C++ data. Lu et al. compared 4 context levels for LLM review of C++ merge requests. The data comes from fault reports of a short-video recommendation service in 4 repositories. Source: [Towards Practical Defect-Focused Automated Code Review](https://arxiv.org/html/2505.17928v2)
- [read] The 4 levels are the original diff, the parent function, Left Flow and Full Flow. Left Flow follows the left-hand values of the change. Full Flow also follows right-hand values and adds the signatures of called functions. Source: [Lu et al.](https://arxiv.org/html/2505.17928v2)
- [read] The slices come from AST analysis of data dependencies and control dependencies. Source: [Lu et al.](https://arxiv.org/html/2505.17928v2)
- [read] KBI is the share of known key bugs that the review comments catch. With LLaMA3.1-405B (AWQ-Int4), 1 reviewer and all comments kept, KBI was 23.70% for the original diff. Source: [Lu et al., Table 3](https://arxiv.org/html/2505.17928v2)
- [read] In the same setting, KBI was 31.85% for the parent function, 37.04% for Left Flow and 39.26% for Full Flow. The single-reviewer values are averages of 3 runs. Source: [Lu et al., Table 3](https://arxiv.org/html/2505.17928v2)
- [read] With only the top 5 comments kept, KBI was 14.81% for the original diff and for the parent function. KBI was 25.93% for Left Flow and for Full Flow. Source: [Lu et al., Table 3](https://arxiv.org/html/2505.17928v2)
- [read] The false alarm rate stayed high. With all comments kept, FAR1 was 94.36% for Left Flow and 94.48% for Full Flow. With the top 5 comments, FAR1 was 90.15% and 90.43%. Source: [Lu et al., Table 7](https://arxiv.org/html/2505.17928v2)
- [read] With 3 reviewers, a meta-reviewer and a validator, the combined index CPI1 was 10.46 for the original diff and 10.81 for the parent function. CPI1 was 22.07 for Left Flow and 20.97 for Full Flow. I did not capture the CPI1 formula. Source: [Lu et al., Table 3](https://arxiv.org/html/2505.17928v2)
- [read] The authors give this reason why Left Flow beat Full Flow: "the large language model's reduced capability when provided with longer contexts, which can cause distraction." Source: [Lu et al.](https://arxiv.org/html/2505.17928v2)
- [read] Each slice level found some bugs that the other levels did not find. Source: [Lu et al., Figure 4](https://arxiv.org/html/2505.17928v2)
- [read] Earlier fine-tuned review models scored almost zero on this data. KBI was 0.00 for DISCOREV, 2.22 for CCT5 and 2.22 for LLaMA-Reviewer. Source: [Lu et al., Table 2](https://arxiv.org/html/2505.17928v2)
- [abstract] The authors claim a 2x gain over standard LLMs and a 10x gain over earlier baselines. Source: [Lu et al., arXiv abstract](https://arxiv.org/abs/2505.17928v2)
- [read] Academic benchmark. AACR-Bench has 200 PRs, 1,505 review comments, 50 repositories and 10 languages, with C and C++. Over 80 engineers reviewed the comments. Source: [AACR-Bench](https://arxiv.org/html/2601.19494v2)
- [read] AACR-Bench tags each comment with the context that it needs. Diff level: 754 comments, about 50.1%. File level: 518, about 34.4%. Repository level: 233, about 15.5%. Source: [AACR-Bench, Table 1](https://arxiv.org/html/2601.19494v2)
- [read] The authors say that their annotation gives a "285% increase in issue coverage" over the original PR comments. Source: [AACR-Bench](https://arxiv.org/html/2601.19494v2)
- [read] Lexical retrieval did not help consistently. For Claude-4.5-Sonnet, F1 was 14.46% with no context and 9.98% with BM25 retrieval, "a 31% decrease." Embedding retrieval gave 13.48%. Source: [AACR-Bench, Table 3](https://arxiv.org/html/2601.19494v2)
- [read] BM25 retrieval increased F1 for 2 models. DeepSeek-V3.2 went from 9.71% to 15.59%. GPT-5.2 went from 12.19% to 14.64%. Source: [AACR-Bench, Table 3](https://arxiv.org/html/2601.19494v2)
- [read] BM25 retrieval decreased F1 for Qwen-480B-Coder from 14.00% to 11.69%. Source: [AACR-Bench, Table 3](https://arxiv.org/html/2601.19494v2)
- [read] Without an agent, recall decreased as the needed context became wider. Claude-4.5-Sonnet with no context had recall 45.76% on diff-level comments, 40.54% on file-level and 38.63% on repository-level comments. Source: [AACR-Bench, Table 4](https://arxiv.org/html/2601.19494v2)
- [read] Qwen-480B-Coder with no context had recall 33.82% on diff-level, 22.59% on file-level and 17.60% on repository-level comments. Source: [AACR-Bench, Table 4](https://arxiv.org/html/2601.19494v2)
- [read] Precision was low in all settings without an agent: 5.10% to 11.30%. Source: [AACR-Bench, Table 3](https://arxiv.org/html/2601.19494v2)
- [read] C was at the bottom of the language ranking. The paper puts C++ in the group of languages where context "paradoxically introduced noise." I found no C++ value. Source: [AACR-Bench](https://arxiv.org/html/2601.19494v2)
- [read] Academic benchmark. The paper also reports a ByteDance deployment. ContextCRBench has 67,910 entries from 90 repositories in 9 languages, with C and C++. The evaluation used 1,080 entries and 8 models. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] In ContextCRBench, code context is the full function or class before and after the change. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] For QE, closed-source models went from F1 36.08 with the diff only to 51.76 with code before and after. Open-source models went from 40.55 to 49.84. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] Code context made defect localization worse. Pass@1 with code before and after decreased by 2.68% for closed-source models and by 6.83% for open-source models. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] The paper prints relative gains of 43.47% and 63.79% for closed-source models with code after, and with code before and after. These percentages do not agree with the absolute values. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] Industrial (ByteDance). BitsAI-CR expands each diff hunk to complete function boundaries with tree-sitter. The expansion has a cap of 4 times the diff size. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [abstract] Research lab (Microsoft Research), crash repair, not review. Code Researcher searches the code and the commit history of the Linux kernel. Source: [Code Researcher](https://arxiv.org/abs/2506.11060)
- [abstract] With GPT-4o, Code Researcher resolved 48% of the kBenchSyz crashes. SWE-agent resolved 31.5% and Agentless resolved 31%. Source: [Code Researcher](https://arxiv.org/abs/2506.11060)
- [abstract] Code Researcher resolved 54% with a budget of 10 trajectories, and 67% with Gemini 2.5 Flash. Source: [Code Researcher](https://arxiv.org/abs/2506.11060)
- [unconfirmed] Secondary summaries give 58% for Code Researcher against 37.5% for SWE-agent. They also give about 10 files explored per trajectory against 1.33 for SWE-agent. These values do not agree with the abstract. Source: [Emergent Mind summary](https://www.emergentmind.com/papers/2506.11060)

#### Commit history and past reviews

- [read] Vendor (Atlassian blog, 2026-06-08). The RovoDev Code Reviewer added context from a similar past PR. The retrieval starts from the Jira issue that the PR links to. Source: [Improving code reviewer with PR context](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [read] The metric is the code resolution rate: the share of generated comments that the author resolved with a code change. Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [read] In an online test with external customers, the control had a resolution rate of 31.92% in 7,777 runs. The past diff gave 36.86%. The past diff and its review comments gave 41.90% in 875 runs. Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [read] In 34 internal runs that got similar-issue context, the rate went from 45.9% to 59.3%. Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [read] Most offline differences were not significant. Offline precision went from 0.0592 to 0.0827 with both context types. Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [read] Context from other repositories "either had no effect or actively degraded review quality." Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [abstract] Industrial (Atlassian, ICSE SEIP 2026). In a deployment of 1 year, 38.70% of RovoDev comments led to code resolution. Human comments had 44.45%. Source: [RovoDev Code Reviewer](https://arxiv.org/html/2601.01129v1)
- [abstract] The deployment covered more than 1,900 repositories and more than 54,000 comments. Source: [RovoDev Code Reviewer](https://arxiv.org/html/2601.01129v1)
- [read] Academic, patch correctness, not review. In LLM4PatchCorrect, retrieved similar patches with correctness labels gave the largest gain. AUC went from 41.8 to 77.2. Accuracy went from 75.4% to 84.0%. Source: [LLM4PatchCorrect, Table VII](https://arxiv.org/html/2303.00202v3)
- [read] LLM4PatchCorrect uses StarCoder-7B. The data is 1,179 Defects4J patches. Source: [LLM4PatchCorrect](https://arxiv.org/html/2303.00202v3)
- [abstract] Vendor (Greptile). Greptile stored embeddings of past comments for each team, with the reactions of the developers. Within 2 weeks, the address rate went from 19% to "55+%." Source: [make llms shut up](https://greptile.com/blog/make-llms-shut-up)
- [abstract] The address rate is the percentage of Greptile comments that developers address before the merge. Source: [make llms shut up](https://greptile.com/blog/make-llms-shut-up)
- [read] Vendor (CodeRabbit). CodeRabbit puts the titles, descriptions and commit ranges of past PRs into the review context. It gives no numbers for this context. Source: [CodeRabbit context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)

#### Project rules

- [read] Industrial (ByteDance, FSE 2025). BitsAI-CR uses a taxonomy of 219 review rules for 5 languages. On 1,397 offline cases, the model with the taxonomy had 57.03% precision. Without the taxonomy, it had 16.83%. Source: [BitsAI-CR, Table 2](https://arxiv.org/html/2501.15134v1)
- [read] With the ReviewFilter verification model, precision was 65.59% with the taxonomy and 30.92% without it. An LLM judged the offline cases. Source: [BitsAI-CR, Table 2](https://arxiv.org/html/2501.15134v1)
- [read] Online precision rose from 35.6% to a peak of 75%. Manual labels on samples of online comments gave this precision. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [read] The team removes rules by their measured precision and Outdated Rate. The Outdated Rate for Go was 26.7%. The human rate at ByteDance is 35% to 46%. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [read] The paper gives 3 different ReviewFilter results: 54.50% to 67.12% in the text, 57.03% to 65.59% in Table 2, and 60% to 75% in Section 5. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [abstract] Industrial (Google, AIware 2024). AutoCommenter learns best practices from past review comments for C++, Java, Python and Go. Source: [AutoCommenter](https://arxiv.org/abs/2405.13565)
- [unconfirmed] Secondary summaries say that AutoCommenter posted about 330 distinct best-practice URLs. They say that it covered 68% of the practices that human reviewers often cite. Another summary gives 66%. Source: [Moonlight review](https://www.themoonlight.io/review/ai-assisted-assessment-of-coding-practices-in-modern-code-review)
- [read] Vendor (OpenAI). Custom task instructions or AGENTS.md files can steer the balance of precision and recall. The post gives no numbers. Source: [A Practical Approach to Verifying Code at Scale](https://alignment.openai.com/scaling-code-verification/)
- [read] Vendor (CodeRabbit). CodeRabbit imports rule files from Cursor, Copilot, Cline and Windsurf. It also applies path-based instructions. It gives no numbers. Source: [CodeRabbit context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)

### Inferences

- The "code that a change reaches" and the call graph of the Clang engine are close to the Left Flow and Full Flow slices. Lu et al. is the best evidence for such context: +56% and +66% relative KBI over the diff. I calculated these values from Table 3.
- Context from program analysis did better than lexical or embedding retrieval in these studies. Thus, the skill should give slices from the engine, not search results from the repository.
- More context increased recall, but it did not correct precision. FAR1 stayed at 75% or more in Lu et al. Thus, the skill needs a separate precision step. Questions 2 and 6 give the evidence.
- C and C++ are among the hardest languages in AACR-Bench, and context added noise for C++. Thus, a limit on the context size is more important for C and C++.
- In RovoDev, the review comments of a similar past PR added 5 points over its diff alone: 41.90% against 36.86%. In LLM4PatchCorrect, labeled similar patches gave the largest gain of all context types.
- Thus, the outcomes of past reviews seem more useful than raw past code. No study measured the past commits of the changed functions as review context.
- A curated rule set gave a 3.4x precision gain in BitsAI-CR, from 16.83% to 57.03%. Project rules can increase precision by a large quantity.

### Gaps

- No study measured the callers of changed functions as a separate context type. Full Flow adds the signatures of called functions, not the callers.
- No study measured a risk score for each function, thread facts or race facts as review context.
- I did not find the number of merge requests in Lu et al. The number is in Appendix K, which I did not read.
- No study gave a number for commit history alone in code review. The Code Researcher abstract gives no number for its commit-search ablation.
- I found no C++ values in AACR-Bench or ContextCRBench.

## 2. Static analysis output as input to the LLM: does it increase precision or recall, or does it anchor the model?

### Takeaway

The result depends on the use. In the Tencent study, LLM triage of each warning with precise context removed 84% to 98% of false positives. It also dropped 12% to 35% of the true bugs. When a general reviewer got a raw analyzer report as extra input, precision fell from 9.22% to 2.79% and recall did not change.

### Cited Findings

#### General LLM reviewer with analyzer output

- [read] Academic (FSE 2026). SWR-Bench has 1,000 Python PRs from 12 projects: 500 PRs with changes to review and 500 clean PRs. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)
- [read] Hybrid-Review is the LLM-Review tool plus a static analysis report. Mean precision was 2.79% for Hybrid-Review and 9.22% for LLM-Review. Source: [SWR-Bench, Table III](https://arxiv.org/html/2509.01494v1)
- [read] Mean recall was 20.04% with the report and 20.39% without it. Mean F1 fell from 12.49% to 4.87%. Source: [SWR-Bench, Table III](https://arxiv.org/html/2509.01494v1)
- [read] On functional issues only, Hybrid-Review had an F1 of 14.43%. I did not capture the functional F1 of LLM-Review. Source: [SWR-Bench, Table III](https://arxiv.org/html/2509.01494v1)
- [abstract] Academic. Jaoua et al. combined static analyzers and fine-tuned LLMs at 3 points: data preparation, RAG at inference, and concatenation of outputs. Source: [Combining LLMs with Static Analyzers for Code Review Generation](https://arxiv.org/abs/2502.06633)
- [abstract] Jaoua et al. report better relevance, completeness and quality of review comments than either part alone. The abstract gives no numbers. Source: [Jaoua et al.](https://arxiv.org/abs/2502.06633)
- [abstract] Academic. Thornton (2026) tested misleading code comments on 100 samples, 8 models and 9,366 trials. The effects were small and not significant (McNemar exact p > 0.21). Source: [LLM Code Reviewers Are Harder to Fool Than You Think](https://arxiv.org/abs/2602.16741)
- [abstract] In the same study, a cross-check with static analysis was the best defense. It reached 96.9% detection and recovered 47% of the baseline misses. Source: [Thornton](https://arxiv.org/abs/2602.16741)
- [abstract] The misses were mostly race conditions, timing side channels and complex authorization logic. Source: [Thornton](https://arxiv.org/abs/2602.16741)

#### LLM triage of static analyzer warnings

- [read] Industrial (Fudan University and Tencent, ICSE SEIP 2026), C and C++. The study used 433 warnings from the BkCheck analyzer: 328 false positives and 105 true positives. The paper calls them alarms. Source: [Reducing False Positives in Static Bug Detection with LLMs](https://arxiv.org/html/2601.18844v1)
- [read] The bug types are null pointer dereference (136), divide by zero (158) and out-of-bounds access (139). Source: [Tencent study, Table 1](https://arxiv.org/html/2601.18844v1)
- [read] Basic prompts removed 26% to 52% of the false positives. Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] LLM4SA adds code around the sink, with callers, callees and hundreds of lines. It removed 84% to 96% of the false positives. Its recall of true bugs was 0.65 to 0.86. Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] LLM4PFA adds static path constraints and agent steps. It removed 94% to 98% of the false positives. Its recall was 0.75 to 0.88. Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] The paper says that "recall remains below the enterprise-expected threshold of 90%." Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] LLM4PFA precision, recall and F1 for each model: GPT-4o 0.93, 0.75, 0.83. Claude-Opus-4 0.83, 0.88, 0.85. Qwen-3-Coder 0.93, 0.79, 0.86. DeepSeek-R1 0.84, 0.86, 0.85. Source: [Tencent study, Table 2](https://arxiv.org/html/2601.18844v1)
- [read] The time for each warning was 2.1 s to 109.5 s. The cost for each warning was $0.0011 to $0.12. A manual inspection takes 10 to 20 minutes for each warning. Source: [Tencent study, Table 4](https://arxiv.org/html/2601.18844v1)
- [read] LLM4PFA took 12.6 s and $0.020 for each warning with GPT-4o, and 16.7 s and $0.120 with Claude-Opus-4. Source: [Tencent study, Table 4](https://arxiv.org/html/2601.18844v1)
- [read] The LLM cannot find bugs that the analyzer did not report. The authors used a majority vote over 3 runs because the outputs vary. Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] Learning-based detectors did badly on this data. For example, Devign had an accuracy of 0.44. Source: [Tencent study, Table 3](https://arxiv.org/html/2601.18844v1)
- [read] Academic (TKDD 2024), C and C++. LLM4SA by Wen et al. inspected 9,547 warnings from the Juliet benchmark and from 11 real-world C and C++ projects. It had 81.13% precision and 94.64% recall. Source: [Automatically Inspecting Thousands of Static Bug Warnings with LLM](https://doi.org/10.1145/3653718)
- [read] LLM4SA extracts code snippets with a program dependence traversal that each warning guides. Its questions add domain knowledge and representative cases. Source: [Wen et al.](https://doi.org/10.1145/3653718)
- [abstract] Academic. LLM4FPM uses line-level slices over an extended code property graph, called eCPG-Slicer. A file reference graph (FARF) finds the relevant files in linear time. Source: [LLM4FPM](https://arxiv.org/abs/2411.03079v2)
- [abstract] LLM4FPM reported an F1 above 99% on Juliet and a label accuracy of 86% on D2A. It needed 4.7 s for each warning. Source: [LLM4FPM](https://arxiv.org/abs/2411.03079v2)
- [unconfirmed] A secondary summary says that LLM4FPM decreased false positives by more than 85% in real-world projects. Source: [Moonlight review of LLM4FPM](https://www.themoonlight.io/review/utilizing-precise-and-complete-code-context-to-guide-llm-in-automatic-false-positive-mitigation)
- [abstract] Academic, Linux kernel C. BugLens checks the taint warnings of the Suture analyzer with an LLM. Precision went from 0.10 for the raw warnings and 0.50 for semi-automated refinement to 0.72. Source: [The Hitchhiker's Guide to Program Analysis, Part II](https://arxiv.org/abs/2504.11711v3)
- [abstract] BugLens found 4 vulnerabilities that nobody had reported before. Source: [BugLens](https://arxiv.org/abs/2504.11711v3)
- [abstract] Academic (OOPSLA 2024), Linux kernel C. LLift checks use-before-initialization cases that UBITect could not decide. The arXiv version reports 50% precision and 100% recall. Source: [LLift](https://arxiv.org/abs/2308.00245v3)
- [unconfirmed] The denominators for the LLift precision and recall are not clear to me. The arXiv text reports 13 new bugs. The OOPSLA version reports 4 bugs that the Linux community confirmed. Source: [LLift, OOPSLA version](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf)
- [abstract] Academic (ICLR 2025), Java. IRIS uses an LLM to infer taint specifications for CodeQL. On CWE-Bench-Java with 120 vulnerabilities, CodeQL found 27 and IRIS with GPT-4 found 55. Source: [IRIS](https://arxiv.org/html/2405.17238v3)
- [abstract] IRIS had an average false discovery rate of 84.82%, which is 5.21 points lower than CodeQL. arXiv version 1 reported 69 detections, and the ICLR version reports 55. Source: [IRIS](https://arxiv.org/html/2405.17238v3)
- [abstract] Academic, Java. ZeroFalse gives the LLM the analyzer output with flow traces and CWE knowledge. The best models reached F1 0.912 on the OWASP Java Benchmark and 0.955 on OpenVuln. Source: [ZeroFalse](https://arxiv.org/abs/2510.02534)
- [abstract] ZeroFalse tested 10 LLMs. The abstract says: "CWE-specialized prompting consistently outperforms generic prompts." Reasoning models gave the best balance of precision and recall. Source: [ZeroFalse](https://arxiv.org/abs/2510.02534)
- [abstract] Academic (ICML 2025). RepoAudit has a validator that checks data-flow facts and path conditions to discard false positives. It found 40 true bugs in 15 projects at 78.43% precision. Source: [RepoAudit](https://proceedings.mlr.press/v267/guo25n.html)

#### Concurrency

- [abstract] Academic (2023). Chen et al. built DRB-ML from DataRaceBench. LLMs "still cannot compete with traditional data race detection tools" when the task needs the variable pairs of a race. The abstract gives no numbers. Source: [Data Race Detection Using Large Language Models](https://arxiv.org/abs/2308.07505)

#### Vendor claims

- [read] Vendor (CodeRabbit). CodeRabbit runs "40+ Linters/SAST tools" and validates the linter results "to cut down on the noise." It gives no numbers. Source: [CodeRabbit context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)
- [read] Vendor (Cursor). The early Bugbot pipeline removed some categories, for example compiler warnings and documentation errors. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [unconfirmed] An InfoWorld article reports that LLM triage raised Semgrep precision from 35.7% to 89.5%. It reports that false positives went from 225 to 20. I did not read the article. Source: [InfoWorld article, via scour.ing](https://scour.ing/p/https://www.infoworld.com/article/4093079/how-pairing-sast-with-ai-dramatically-reduces-false-positives-in-code-security.html)

### Inferences

- A raw analyzer report in the review prompt adds false positives. SWR-Bench gives the clearest evidence. It is 1 benchmark with Python code, and my notes do not name its analyzer.
- Triage of 1 precise warning with precise context works well. The best results came from slices, program dependence traversal and path constraints, not from full files.
- Triage drops true bugs: recall was 0.65 to 0.88 in the Tencent study. Thus, the skill should show each engine race fact that the LLM rejects, with the reason. The skill should not delete it silently.
- LLMs alone are weak on races, from Chen et al. and Thornton. Thus, the engine should find the races. The LLM should explain the effect and check the feasibility.
- I found no study that measures anchoring directly. The SWR-Bench result agrees with an anchoring effect. It also agrees with simple noise from many low-value warnings.

### Gaps

- No study measured if analyzer facts decrease the recall on other bug classes. That is the direct test of anchoring.
- No study gave sanitizer results, for example from ThreadSanitizer or AddressSanitizer, to an LLM reviewer.
- I did not identify the analyzer of Hybrid-Review in SWR-Bench.
- I did not read SastBench, a benchmark for agentic SAST triage. Source: [SastBench](https://arxiv.org/html/2601.02941v1)
- I did not read ALIBI. ALIBI tests adversarial comments against LLM detectors of C and C++ null pointer bugs, and it can disagree with Thornton. Source: [ALIBI](https://arxiv.org/pdf/2607.24964)

## 3. Task specification or intent of the change: does a review against the spec find more bugs?

### Takeaway

Text that states the intent, as an issue and a PR description, gave the largest measured gain in 1 benchmark. It helped QE much more than code context did. It helped defect localization a little, and it hurt open-source models. No study measured if a review against the spec finds requirements that the change does not implement.

### Cited Findings

- [read] Academic benchmark (ContextCRBench). Closed-source average QE F1 was 36.08 with the diff only and 57.66 with the issue. It was 62.12 with the PR description, 64.37 with both, and 64.74 with text and code. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] Open-source average QE F1 for the same settings: 40.55, 44.06, 53.97, 53.86 and 54.85. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] QE F1 for each model, diff only against the issue plus the PR description: GPT-4o 30.03 to 64.61, Claude 3.5 Sonnet 59.54 to 65.63, Qwen2.5-Coder-32B 21.51 to 36.98. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] Defect localization Pass@1 with the issue and the PR description: closed-source 16.41 to 18.54, an increase of 12.98%. Open-source 20.05 to 19.61, a decrease of 2.19%. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] Review comment generation, ROUGE-1 with the issue and the PR description: an increase of 5.73% for closed-source and 8.50% for open-source models. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] Issue text can hurt 1 model. Codestral QE F1 fell from 53.68 to 50.39 with the issue. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] In the dataset, the issue describes the bug and the PR description describes the fix. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] ByteDance used the benchmark as the reward signal for a review tool that improves itself. On 25 reserved repositories, the average score went from 23.75 to 38.47, an increase of 61.98%. This result does not isolate the spec context. Source: [ContextCRBench, Table 8](https://arxiv.org/html/2511.07017v1)
- [read] Academic. In SWR-Bench, LLM-Review gets the PR title, the PR description and the diff. The paper has no ablation of the description. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)
- [read] Vendor (Atlassian). RovoDev uses the linked Jira issue to find similar past PRs. Jira links were "less reliable" in internal repositories. Only 270 of about 3,000 internal runs had a linked issue. Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [read] Vendor (CodeRabbit). CodeRabbit checks linked Jira, Linear and GitHub issues against the changes of the PR. It gives no numbers. Source: [CodeRabbit context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)

### Inferences

- In ContextCRBench, the PR description often states the fix. Thus, a part of the gain can come from text that points to the answer. A task spec that does not name the defect can give a smaller gain.
- For the skill, the task spec is a cheap input with positive evidence. The skill can use it to find the hunks that need attention and to check the scope of the change.
- A check for requirements that the change does not implement has no measured evidence. If the skill adds this check, the team must measure it.
- The spec for an agent diff often comes from the same agent session. Thus, the reviewer can share the same wrong reading of the task. No study measured this risk.

### Gaps

- No study measured the detection of requirements that the change does not implement.
- No study measured a review against acceptance criteria or a design document.
- No study compared a spec from the code author with an independent spec.
- I did not capture the exact definition of the QE task in ContextCRBench.

## 4. Tests and test results as context

### Takeaway

The evidence is weak. I found no code review study with an ablation of test context. In patch correctness, the nearest task, test information added less than 1 accuracy point, but similar labeled patches added 8.6 points. OpenAI reports that code execution together with repository access gave a better reviewer, but it gives no number.

### Cited Findings

- [read] Academic (IEEE TSE 2024), patch correctness. LLM4PatchCorrect with StarCoder-7B on Defects4J. The LLM alone had accuracy 75.4, F1 83.1 and AUC 41.8. Source: [LLM4PatchCorrect, Table VII](https://arxiv.org/html/2303.00202v3)
- [read] The rows for bug information and test information gave 75.7, 83.5, 45.8 and 76.0, 83.7, 43.3. The bug information includes descriptions and execution traces. The test information includes failing test cases and coverage. Source: [LLM4PatchCorrect, Table VII](https://arxiv.org/html/2303.00202v3)
- [unconfirmed] The extracted table did not label these 2 rows clearly. The text says that bug information gives "up to 9.6%" relative gain, which fits the AUC of 45.8. Source: [LLM4PatchCorrect](https://arxiv.org/html/2303.00202v3)
- [read] Retrieved labeled patches gave 84.0, 86.3 and 77.2. The full model gave 84.4, 86.5 and 80.4. Source: [LLM4PatchCorrect, Table VII](https://arxiv.org/html/2303.00202v3)
- [read] Vendor (OpenAI, 2025-12-01). OpenAI gave a GPT-5 reviewer repository access and code execution. The post says that it "results in a stronger reviewer, catching more critical issues and raising fewer false alarms." Source: [A Practical Approach to Verifying Code at Scale](https://alignment.openai.com/scaling-code-verification/)
- [read] The post tests the 2 features together and gives no numbers for them. It says that a review of the diff only gives "the fastest review time" but "often misses important context about the whole codebase." Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [read] In the OpenAI deployment, authors changed the code for 52.7% of the reviewer comments. The system reviews "more than 100k external PRs per day," as of October 2025. Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [read] Academic. SWR-Agent can execute code snippets and explore the codebase. Its mean F1 of 12.61% was almost equal to the 12.49% of single-turn LLM-Review. Source: [SWR-Bench, Table III](https://arxiv.org/html/2509.01494v1)
- [read] Vendor (CodeRabbit). CodeRabbit runs verification scripts in a sandbox to check suggestions. It gives no numbers. Source: [CodeRabbit context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)
- [unconfirmed] A secondary explainer says that Codex review can write and run code or tests to check if a suspected issue occurs. Source: [teamday explainer](https://teamday.pages.dev/ai/openai-codex-code-review-feature)

### Inferences

- Test text in the prompt gives a small gain. Execution that checks 1 specific suspected bug is more promising, but only vendor reports support it.
- For C and C++ races, a test run under ThreadSanitizer can confirm a race fact from the engine. No study measured this with an LLM reviewer.
- A patch that passes the tests can still be wrong. This overfit problem is the main subject of LLM4PatchCorrect. Thus, a test pass is not proof for the reviewer. Source: [LLM4PatchCorrect](https://arxiv.org/html/2303.00202v3)

### Gaps

- No ablation of test code, test results or coverage as code review context.
- No study of sanitizer output as context for an LLM reviewer.

## 5. Too much context: does long or irrelevant context lower the review quality, and how do systems select context?

### Takeaway

Yes. In code review studies, wider context lowered the results in several settings. Systems select context with program slices, function expansion with a cap, code graphs, retrieval of similar past changes and agent tool calls.

### Cited Findings

#### Evidence that more context can hurt

- [read] ICML 2025 paper, industrial C++. Full Flow had more context than Left Flow but a lower CPI1: 20.97 against 22.07. The authors explain it as distraction from longer context. Source: [Lu et al., Table 3](https://arxiv.org/html/2505.17928v2)
- [read] The paper also says that "excessively long inputs degrade LLM performance." Source: [Lu et al.](https://arxiv.org/html/2505.17928v2)
- [read] Academic benchmark. BM25 retrieval decreased the F1 of Claude-4.5-Sonnet by 31%, from 14.46% to 9.98%. Recall without an agent decreased from diff-level to repository-level comments. Source: [AACR-Bench, Tables 3 and 4](https://arxiv.org/html/2601.19494v2)
- [read] Academic benchmark. Text and code context decreased the defect localization Pass@1 of open-source models by 7.98%. Code before and after alone decreased it by 6.83%. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- [read] Industrial (Tencent), C and C++. In failed triage cases, the functions were 95.6 lines longer than the dataset average. They had 21 more conditional statements. The paper says that "LLMs struggle with extended context reasoning." Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] The Tencent authors note that the strong results can partly come from the fact that "most warnings involve only short code fragments." Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] Vendor (Atlassian). Context from other repositories "either had no effect or actively degraded review quality." Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [read] Vendor (Cursor). Many changes, with context management changes among them, "surprisingly, regressed our metrics." Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [abstract] Academic (ICSE 2026), code generation, not review. Retrieved similar code "often introduces noise, degrading results by up to 15%." Code in the same context and API information helped. Source: [What to Retrieve for Effective Retrieval-Augmented Code Generation?](https://arxiv.org/abs/2503.20589v1)
- [unconfirmed] Vendor research (Chroma, 2025-07-14), general LLMs, not code. The report tested 18 LLMs. Performance became less reliable as the input became longer, also on simple tasks. Source: [Context Rot](https://trychroma.com/research/context-rot)
- [unconfirmed] In the same report, more distractors gave lower performance. Lower semantic similarity between the question and the answer gave a faster decrease. I took these details from secondary summaries. Source: [Context Rot](https://trychroma.com/research/context-rot)
- [read] Vendor (Anthropic, 2025-09-29). Recall of information decreases as the context grows. The post says that this effect occurs in all models, but some models degrade more gently than others. Source: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [read] The Anthropic principle is "the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome." Source: [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [unconfirmed] Vendor (Graphite, January 2024). An early Graphite post says that retrieval over the codebase decreased errors but did not correct the signal-to-noise problem. I saw only a search summary. Source: [Graphite blog](https://graphite.com/blog/problems-with-ai-code-review)

#### How systems select context

- [read] Program slices. Lu et al. build the parent function, Left Flow and Full Flow slices from the AST, with data and control dependencies. Source: [Lu et al.](https://arxiv.org/html/2505.17928v2)
- [read] Program dependence traversal. LLM4SA extracts the snippets that each warning guides. Source: [Wen et al.](https://doi.org/10.1145/3653718)
- [abstract] Line-level slices. LLM4FPM slices on an extended code property graph and finds the relevant files with a file reference graph. Source: [LLM4FPM](https://arxiv.org/abs/2411.03079v2)
- [read] Path constraints. LLM4PFA adds the static path constraints of each warning. Source: [Tencent study](https://arxiv.org/html/2601.18844v1)
- [read] Function expansion with a cap. BitsAI-CR expands hunks to function boundaries, with a cap of 4 times the diff size. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [read] Code graph. CodeRabbit rebuilds a code graph for each review and pulls in type and symbol definitions. Source: [CodeRabbit context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)
- [read] Ratio. CodeRabbit packs "a 1:1 ratio of code-to-context" in its prompts. It gives no measurement of this ratio. Source: [CodeRabbit context engineering](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)
- [abstract] Code graph. Greptile builds a graph of the full repository. Its agent queries the graph for function dependencies and function usage. Source: [Greptile docs](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context)
- [read] Similar past changes. RovoDev retrieves similar past PRs through the linked Jira issue. Source: [Atlassian blog](https://www.atlassian.com/blog/development/improving-code-reviewer-with-pr-context)
- [abstract] Feedback memory. Greptile stores embeddings of past comments with the reactions of each team. Source: [make llms shut up](https://greptile.com/blog/make-llms-shut-up)
- [read] Just-in-time retrieval. Agents keep light identifiers, for example file paths, and load data at runtime with tools. Claude Code puts CLAUDE.md files into context at the start and uses glob and grep later. Source: [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [read] Sub-agents. Each sub-agent works in a clean context window and returns "a condensed, distilled summary of its work (often 1,000-2,000 tokens)." Source: [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [read] Dynamic context. Cursor moved information from static context to dynamic context, so that the model pulls in what it needs at runtime. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [read] Depth that scales with the change. Claude Code Review uses more agents and a deeper read for large or complex PRs, and a light pass for trivial changes. Source: [Code Review for Claude Code](https://claude.com/blog/code-review)

### Inferences

- For C and C++, the skill should select context by analysis relevance, not by text similarity. AACR-Bench and Lu et al. support this.
- A budget relative to the diff size is common: 4 times in BitsAI-CR and 1:1 at CodeRabbit. No study measured the best ratio.
- A compact first packet plus tools for more context fits the evidence and the Anthropic guidance.
- Long functions with many branches are where LLM triage fails. The skill can mark such functions for a human, or split them into paths before the review.

### Gaps

- No study measured the best context size for code review in tokens.
- No study compared code-graph selection with program slicing for code review.
- I did not read the primary Chroma report.

## 6. Agentic exploration compared with a fixed context window

### Takeaway

Controlled comparisons do not show a clear F1 gain from agents. In AACR-Bench, an agent had higher precision but much lower recall, and F1 increased only for Claude-4.5-Sonnet. In SWR-Bench, the agent tied with single-turn review. Vendors report that agentic designs gave their largest gains, but they publish no controlled baseline.

### Cited Findings

#### Academic

- [read] AACR-Bench, agent setting with Claude Code. Claude-4.5-Sonnet had precision 39.90%, recall 10.10% and F1 16.12%. With no context, it had 8.70%, 42.86% and 14.46%. Source: [AACR-Bench, Table 3](https://arxiv.org/html/2601.19494v2)
- [read] Agent F1 against no-context F1 for the other models: GPT-5.2 4.59% against 12.19%. DeepSeek-V3.2 6.67% against 9.71%. GLM-4.7 6.69% against 16.03%. Qwen-480B-Coder 6.82% against 14.00%. Source: [AACR-Bench, Table 3](https://arxiv.org/html/2601.19494v2)
- [read] Agents posted 0.08 to 0.15 comments for each PR on average. Without context, the models posted 0.86 to 2.35. Source: [AACR-Bench, Table 3](https://arxiv.org/html/2601.19494v2)
- [read] For most models, agent recall on file-level or repository-level comments was higher than on diff-level comments. Claude-4.5-Sonnet: 11.95% on diff-level, 16.84% on file-level and 13.77% on repository-level comments. Source: [AACR-Bench, Table 4](https://arxiv.org/html/2601.19494v2)
- [read] DeepSeek-V3.2 agent recall: 4.28%, 4.64% and 8.00%. Qwen-480B-Coder: 4.49%, 5.24% and 5.94%. GLM-4.7 was the exception: 6.50%, 5.95% and 4.40%. Source: [AACR-Bench, Table 4](https://arxiv.org/html/2601.19494v2)
- [read] With the agent, Claude-4.5-Sonnet F1 on C went from 0.106 to 0.189. On Go, it went from 0.120 to 0.218. On Java, it went from 0.142 to 0.241. Source: [AACR-Bench](https://arxiv.org/html/2601.19494v2)
- [abstract] The AACR-Bench authors conclude that "general-purpose LLM capabilities do not directly translate to proficiency in Agent-based ACR tasks." Source: [AACR-Bench abstract](https://arxiv.org/abs/2601.19494v1)
- [read] SWR-Bench. SWR-Agent, which uses tools, had a mean F1 of 12.61%. Single-turn LLM-Review had 12.49%. CR-Agent, 2 agents with a debate, had 9.22%. Source: [SWR-Bench, Table III](https://arxiv.org/html/2509.01494v1)
- [read] PR-Review, from the PR-Agent project, had the best mean F1: 18.73%, with precision 15.39% and recall 24.06%. The authors say that agent-based approaches "did not yield standout results in their current form." Source: [SWR-Bench, Table III](https://arxiv.org/html/2509.01494v1)
- [read] Multi-review aggregation runs the tool several times and merges the reports with 1 more LLM call. With 10 runs of Gemini-2.5-Flash, F1 went from 15.25% to 21.91%, an increase of 43.67%. Source: [SWR-Bench, Table IV](https://arxiv.org/html/2509.01494v1)
- [read] In the same setting, recall went to 30.44%, an increase of 118.83%. I did not find the precision for this setting. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)
- [read] SWR-Bench is Python only. The functional changes are 31.8% of the benchmark. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)
- [abstract] RepoAudit explores the repository on demand with Claude 3.5 Sonnet. It needed 0.44 hours and $2.54 for each project. It reported 185 new issues, and developers confirmed or fixed 174. Source: [RepoAudit](https://proceedings.mlr.press/v267/guo25n.html)
- [unconfirmed] I did not confirm the languages of the RepoAudit projects. The bug types are memory-corruption bugs, which suggests C and C++. Source: [RepoAudit, arXiv](https://arxiv.org/html/2501.18160v3)

#### Vendor claims

- [read] Vendor (Cursor, 2026-01-15). The Bugbot resolution rate rose from 52% to "over 70%" across 40 major experiments. Bugs flagged for each run rose from 0.4 to 0.7. Resolved bugs for each PR rose from about 0.2 to about 0.5. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [read] An LLM decides at merge time which flagged bugs the author fixed. The team checked examples with the PR authors. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [read] The early pipeline ran 8 parallel passes with a random diff order. It kept bugs that more than 1 pass found, then used a validator model and a dedupe step. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [read] The switch to an agent loop gave the largest gains. The agent was "too cautious," so the team changed the prompts to make the agent flag suspicious patterns more aggressively. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [read] Tool design had an "outsized impact" on the results. The post gives no numbers for the agent switch alone. Bugbot reviews "more than two million PRs per month." Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- [read] Vendor (Greptile, 2025-11-26). Version 3 replaced a fixed pipeline with an agent loop. Its tools include codebase search and learned rules. Source: [Greptile v3](https://www.greptile.com/blog/greptile-v3-agentic-code-review)
- [read] From version 2 to version 3, the upvote to downvote ratio went from 1.44 to 5.13. The action rate went from 34.75% to 59.24%. The post does not define the action rate. Source: [Greptile v3](https://www.greptile.com/blog/greptile-v3-agentic-code-review)
- [read] Version 3 uses about 3 times more context tokens than version 2. The post claims 75% lower inference cost for self-hosted customers because of cache hits. Source: [Greptile v3](https://www.greptile.com/blog/greptile-v3-agentic-code-review)
- [read] Vendor (OpenAI). "Precision is more important for usability than recall." The team accepted "modestly reduced recall in exchange for high signal quality and developer trust." Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [read] OpenAI says that the verifier catches a large share of known high-severity issues "even at a small fraction of the generator's token spend." Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [read] Vendor (Anthropic, 2026-03-09). Claude Code Review sends a team of agents in parallel, then a verification step filters false positives. It ranks the bugs by severity. Source: [Code Review for Claude Code](https://claude.com/blog/code-review)
- [read] At Anthropic, PRs with substantive review comments went from 16% to 54%. On PRs with more than 1,000 changed lines, 84% got findings, with 7.5 issues on average. Source: [Code Review for Claude Code](https://claude.com/blog/code-review)
- [read] On PRs with fewer than 50 changed lines, 31% got findings, with 0.5 issues on average. Engineers marked less than 1% of findings as incorrect. Source: [Code Review for Claude Code](https://claude.com/blog/code-review)
- [read] A review takes about 20 minutes and costs $15 to $25 on average. Source: [Code Review for Claude Code](https://claude.com/blog/code-review)
- [unconfirmed] VentureBeat quotes Anthropic: "marked incorrect" means that an engineer resolved the comment without a fix. Source: [VentureBeat](https://venturebeat.com/ai/anthropic-rolls-out-code-review-for-claude-code-as-it-sues-over-pentagon)
- [unconfirmed] Vendor (Qodo). The Qodo benchmark injects 580 defects into 100 merged PRs from 8 repositories in 7 languages. An LLM judge scores the comments. I saw only search text. Source: [Qodo benchmark](https://qodo.ai/ai-code-review-benchmark/)
- [unconfirmed] Qodo material says that Qodo leads Claude Code Review by 12 F1 points, with the same precision and higher recall. Source: [Qodo benchmark](https://qodo.ai/ai-code-review-benchmark/)
- [unconfirmed] Qodo material argues that a step after generation can tune precision, but the depth of codebase understanding limits recall. Source: [Qodo benchmark](https://qodo.ai/ai-code-review-benchmark/)

### Inferences

- An agent changes the balance of precision and recall more than it changes F1. The prompt sets this balance: Cursor had to make the prompts more aggressive.
- Agents help most when the needed context is outside the diff. In AACR-Bench, about 15.5% of real review comments need repository context.
- A hybrid design fits the evidence. The skill can give a fixed packet of engine facts first, then let the agent call tools for callers, slices and history. No study tested this hybrid for code review.
- Several passes with aggregation increase recall, and a verifier then increases precision. Cursor's early design and Claude Code Review use both.
- A verifier has a recall cost. In Lu et al., the validator moved FAR1 from 87.81% to 75.37%, but KBI fell from 31.11% to 20.00%.
- The risk score of the engine can set the depth of the review for each function. Claude Code Review scales depth with the PR size, but no study measured depth by risk.

### Gaps

- No controlled study compared agentic and fixed context for C or C++ code review with static analysis facts.
- AACR-Bench used a general agent (Claude Code), not an agent tuned for review.
- The vendor claims have no public baselines, and most vendor metrics come from developer reactions, not from ground truth.
- A search summary gave more vendor numbers, but I could not identify their source pages. Qodo 2.0 had F1 60.1% and recall 56.7%. An Augment test gave Claude Code recall 51% and precision 23%. Martian put CodeRabbit first with F1 51.2%.
- I may have missed sources from mid-2026 to November 2026. The newest sources that I read are from June 2026.
