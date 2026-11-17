# Architectures and effort levels for LLM-based agentic code review

These notes give measured evidence on pipeline designs for automated code review with large language models (LLMs). The design target is a review skill for Claude Code. The skill reviews the full diff of a C and C++ task before a commit. The user selects the effort level and the focus areas. The notes are current to November 2026.

Each cited item starts with a tag for the type of source:

- [Independent study]: an academic study. The authors do not sell the measured tool.
- [Industry paper]: a peer-reviewed paper by a company on its own deployed tool.
- [Vendor claim]: a statement by a company on its own product. No outside party checked it.
- [Vendor documentation]: product documentation. It describes the design. It gives no accuracy data, unless the item says so.
- [Vendor-run benchmark]: a benchmark that a tool vendor built and runs. The tool of the vendor is on the board.
- [Independent benchmark]: a benchmark by a party that states that it sells no review tool.
- [Third-party test]: a blog test by a party that does not sell the tool. The sample is small, and nobody reviewed the method.
- [Unconfirmed]: I saw the claim only in a search summary, an abstract or a secondary source. I did not read it in the full primary text.
- [Older]: the first version of the source is from 2023 or earlier.

The notes use these terms with 1 definition each:

- Issue: a problem that a reviewer reports. Sources also call it a finding.
- Review comment: the output unit that some sources count. A review comment usually holds 1 issue.
- Candidate issue: an issue before the verification pass.
- Finder pass: 1 LLM pass or 1 agent that makes candidate issues.
- Verification pass: a later LLM pass that keeps or removes candidate issues. Sources call it a validator, a filter, a critic or a judge.
- Metric judge: an LLM that scores the output of a tool for a benchmark. It is not a part of the review pipeline.

Do not compare absolute numbers across benchmarks. GPT-5 family reviewers have precision 3.19% to 5.10% on CR-Bench, but Codex configurations have 83.71% to 90.2% on ReviewBench. The benchmarks define ground truth differently.

## 1. Single pass compared with multi-agent review: measured precision, recall and false-positive rate

### Takeaway

No controlled study changes only the number of agents in a code review pipeline. More finder passes and self-critique loops raise recall and issue volume, and they lower precision or SNR. Precision rose when a verification pass came after the finders, or when an agent reported far fewer issues at a large recall cost.

### Cited Findings

#### Academic benchmarks

- [Independent study] SWR-Bench has 1,000 GitHub pull requests (PRs) from 12 Python projects: 500 PRs with changes to review and 500 clean PRs. The best F1 was 19.38%, from PR-Review with Gemini-2.5-Pro, at precision 16.65% and recall 23.18%. Source: [SWR-Bench, arXiv 2509.01494, FSE 2026](https://arxiv.org/html/2509.01494v1)
- [Independent study] SWR-Bench gives the mean F1 of each tool: PR-Review 18.73%, SWR-Agent 12.61%, LLM-Reviewer 12.49%, CR-Agent 9.22% and Hybrid-Review 4.87%. CR-Agent is multi-agent, SWR-Agent is an agent, and LLM-Reviewer is a single pass. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)
- [Unconfirmed] A search summary describes PR-Review, the best tool in SWR-Bench, as a prompt-engineered method, not an agent. Source: [SWR-Bench PDF](https://arxiv.org/pdf/2509.01494)
- [Independent study] SWR-Bench names false positives as the main limit. 4 tools had precision below 10%. Hybrid-Review had a mean precision of 2.79%. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)
- [Independent study] AACR-Bench has 200 PRs, 1,505 reference review comments, 50 repositories and 10 languages, with C and C++. 80 engineers with 2 or more years of experience labeled the comments. Source: [AACR-Bench, arXiv 2601.19494](https://www.alphaxiv.org/abs/2601.19494)

| AACR-Bench model and mode | Precision | Recall | F1 | Review comments for each patch |
|---|---|---|---|---|
| Claude-4.5-Sonnet, agent | 39.90% | 10.10% | 16.12 | 0.089 |
| Claude-4.5-Sonnet, no context | 8.70% | 42.86% | 14.46 | 1.72 |
| GPT-5.2, agent | 9.90% | 2.99% | 4.59 | not given |
| GPT-5.2, no context | 7.00% | 47.11% | 12.19 | not given |

Source: [AACR-Bench](https://www.alphaxiv.org/abs/2601.19494). The authors conclude that agents give higher precision but lower recall. They also conclude that the effect depends strongly on the model.

- [Independent study] CR-Bench has 174 manually checked bug instances from SWE-Bench, all in Python projects. It compares a single-shot reviewer with a Reflexion agent. The Reflexion agent adds a self-critique loop to find missed bugs. Claude-Sonnet-4.5 is the metric judge. Source: [CR-Bench, arXiv 2603.11078](https://arxiv.org/html/2603.11078)

| CR-Bench reviewer | Model | Recall | Precision | F1 | Usefulness | SNR |
|---|---|---|---|---|---|---|
| Single-shot | GPT-5.2 | 27.01% | 3.56% | 6.30% | 83.63% | 5.11 |
| Single-shot | GPT-5-mini | 18.39% | 3.51% | 5.90% | 74.29% | 2.89 |
| Reflexion | GPT-5.2 | 32.76% | 5.10% | 8.83% | 66.10% | 1.95 |
| Reflexion | GPT-5-mini | 27.59% | 3.19% | 5.72% | 47.72% | 0.91 |

Source: [CR-Bench](https://arxiv.org/html/2603.11078). Usefulness is the share of review comments that are bug hits or valid suggestions. SNR is the signal-to-noise ratio. The table values agree with SNR = usefulness ÷ (1 − usefulness). This relation is my calculation.

- [Independent study] c-CRAB changes 234 human review comments on 184 PRs into executable tests. An agent, Claude Code with Sonnet-4.6, changes each patch from the review comments of 1 tool. Then the tests give the score. Source: [c-CRAB, arXiv 2603.23448](https://arxiv.org/html/2603.23448v3)

| c-CRAB reviewer | Review comments | Test pass rate |
|---|---|---|
| Claude Code | 1,336 | 32.1% |
| Devin | 1,344 | 24.8% |
| PR-Agent | 524 | 23.1% |
| Codex | 324 | 20.1% |
| Union of the 4 tools | not given | 41.5% |

Source: [c-CRAB](https://arxiv.org/html/2603.23448v3). On a sample of 92 review comments, 2 annotators found 77 comments, or 84%, useful.

- [Unconfirmed] Hydra-Reviewer is a multi-agent comment generator in the FSE 2026 journal-first track. It got BLEU 8.20, against 7.85 for DeepSeek-V3. It used about $0.018 and 62.63 s for each code change. I saw only the abstract. Source: [Hydra-Reviewer](https://conf.researchr.org/details/fse-2026/fse-2026-journal-first/40/Hydra-Reviewer-A-holistic-multi-agent-system-for-automatic-code-review-comment-gener)

#### Production systems

- [Vendor claim] Cursor Bugbot first ran 8 parallel finder passes, each with a random diff order. It put similar bugs into 1 bucket. A majority vote removed bugs that only 1 pass found. A "validator model" and a dedupe step against earlier runs came after. Source: [Cursor, Building a better Bugbot, 15 January 2026](https://cursor.com/blog/building-bugbot)
- [Vendor claim] Cursor then moved Bugbot to "a fully agentic design". The post says that this change gave "the largest gains". Source: [Cursor](https://cursor.com/blog/building-bugbot)
- [Vendor claim] Over 40 major experiments, the Bugbot resolution rate went from 52% to over 70%. Bugs flagged for each run went from 0.4 to 0.7. Resolved bugs for each PR went from about 0.2 to about 0.5. Bugbot reviews more than 2 million PRs each month. Source: [Cursor](https://cursor.com/blog/building-bugbot)
- [Vendor claim] Cursor writes that "many changes, surprisingly, regressed our metrics". The changes were to models, prompts, iteration counts, validators, context management, filters and agentic designs. The post gives no cost, latency or token data. Source: [Cursor](https://cursor.com/blog/building-bugbot)
- [Vendor claim] The agentic Bugbot needed aggressive prompts, because the agent was "too cautious". Earlier versions used restrained prompts to limit false positives. Source: [Cursor](https://cursor.com/blog/building-bugbot)
- [Vendor-run benchmark] Cursor measures the resolution rate with a metric judge at merge time, on public repositories only. Source: [Cursor, Bugbot learning, 8 April 2026](https://cursor.com/blog/bugbot-learning)

| Product, April 2026 | Resolution rate | PRs analyzed |
|---|---|---|
| Cursor Bugbot | 78.13% | 50,310 |
| Greptile | 63.49% | 11,419 |
| CodeRabbit | 48.96% | 33,487 |
| GitHub Copilot | 46.69% | 24,336 |
| Codex | 45.07% | 19,384 |
| Gemini Code Assist | 30.93% | 21,031 |

Source: [Cursor](https://cursor.com/blog/bugbot-learning)

- [Unconfirmed] A Cursor post of 26 February 2026 gives a resolution rate of 76%. I saw this number only in a search summary. Source: [Cursor, Bugbot Autofix](https://cursor.com/blog/bugbot-autofix)
- [Vendor claim] Anthropic Code Review (9 March 2026) sends a team of agents to each PR. The agents look for bugs in parallel. A verification step removes false positives, and a last step ranks bugs by severity. Source: [Anthropic, Bringing Code Review to Claude Code](https://claude.com/blog/code-review)
- [Vendor claim] At Anthropic, the share of PRs with substantive review comments went from 16% to 54%. On PRs with more than 1,000 changed lines, 84% get issues, with 7.5 issues on average. On PRs with less than 50 changed lines, 31% get issues, with 0.5 issues on average. Source: [Anthropic](https://claude.com/blog/code-review)
- [Vendor claim] Engineers marked "less than 1%" of the issues as incorrect. Source: [Anthropic](https://claude.com/blog/code-review)
- [Vendor documentation] The managed Code Review has 4 stages: Find, Verify, Rank and Post. In Find, "several agents examine the diff and the surrounding code in parallel". Source: [Claude Code docs, Code Review](https://code.claude.com/docs/en/code-review)
- [Vendor documentation] The official code-review plugin for Claude Code starts 4 finder agents in parallel. 2 Sonnet agents check CLAUDE.md compliance. 1 Opus agent looks for obvious bugs in the diff alone, without more context. 1 Opus agent looks for security problems and incorrect logic in the changed code. Source: [code-review command file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Vendor documentation] After the finders, the plugin starts 1 verification subagent for each candidate issue. It drops each issue that its subagent did not confirm. Source: [code-review command file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Vendor-run benchmark] GitHub ReviewBench has 219 public PRs from 187 repositories in 19 languages. Claude Sonnet 5 is the metric judge. Senior engineers relabeled the ground truth, and they agreed with it 96.6% of the time. Source: [GitHub blog, ReviewBench, 5 October 2026](https://github.blog/news-insights/research/reviewbench-an-open-benchmark-for-ai-code-review/)
- [Vendor-run benchmark] On the ReviewBench board of 29 October 2026, the 2 best systems by F1 were agent harnesses. intent-review-agent had F1 62.6%, precision 81.77% and recall 50.68%. Laude RevEngine with claude-opus-5.5 had F1 59.6%, precision 83.58% and recall 46.28%. Source: [benchmarklist.com copy of the ReviewBench board](https://benchmarklist.com/benchmarks/review_bench/)
- [Vendor-run benchmark] On the same board, grounded precision for all 38 configurations was 77.84% to 90.2%. Grounded recall was 5.65% to 50.68%. Cursor had precision 87.67% and recall 9.57%. The board lists no Anthropic product. Source: [benchmarklist.com](https://benchmarklist.com/benchmarks/review_bench/)

#### General multi-agent evidence, not code review

- [Unconfirmed] "Why Do Multi-Agent LLM Systems Fail?" (NeurIPS 2025) reports that multi-agent gains over single-agent setups are often minimal on popular benchmarks. It gives 14 failure modes from 1,642 traces of 7 frameworks. I read only the abstract and summaries. Source: [MAST, arXiv 2503.13657](https://arxiv.org/abs/2503.13657)
- [Vendor claim] The research system of Anthropic had an Opus 4 lead agent and Sonnet 4 subagents. It "outperformed single-agent Claude Opus 4 by 90.2%" on an internal research evaluation. Source: [Anthropic, How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Vendor claim] In the same post, multi-agent systems used about 15 times the tokens of a chat. Anthropic writes that "most coding tasks involve fewer truly parallelizable tasks than research". Source: [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Unconfirmed] [Vendor claim] Reviewate claims about 40% recall and 25% precision for a single pass. It claims 65.7% recall and 57.3% precision for its multi-agent pipeline. I saw only a search snippet, and the method is not documented. Source: [Reviewate](https://reviewate-website.pages.dev/blog/multi-agent-code-review-architecture)

#### Notes on benchmark reliability

- [Independent benchmark] Martian Code Review Bench has an offline set of 50 PRs from 5 projects, with 173 golden review comments. The categories include concurrency. With 3 metric judges, Claude Opus 4.5, GPT-5.2 and Claude Sonnet 4.5, the top 5 tools stayed the same. Source: [Martian repository](https://github.com/withmartian/code-review-benchmark)
- [Independent benchmark] The online part of Martian uses a precision proxy: the share of bot suggestions that match a later developer fix. Source: [Martian repository](https://github.com/withmartian/code-review-benchmark)
- [Unconfirmed] Vendors cite different Martian results from different snapshots and metrics. Greptile cites F1 60.8%, at precision 76.2% and recall 50.6%, on 30 July 2026. Qodo cites F1 64.3%. Unblocked cites F2 66.2. Source: [Greptile](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark); [Qodo](https://www.qodo.ai/blog/qodo-ranked-1-ai-code-review-tool-in-martians-code-review-benchmark); [Unblocked](https://getunblocked.com/benchmarks/code-review/)
- [Unconfirmed] At the ReviewBench launch on 1 October 2026, Copilot code review Balanced had grounded F1 40.1%. On 29 October 2026, it had 34.9%. Source: [BenchLM](https://benchlm.ai/md/benchmarks/reviewbench.md); [benchmarklist.com](https://benchmarklist.com/benchmarks/review_bench/)

### Inferences

- "Multi-agent" is not 1 variable. The data show 3 separate levers: more candidate generation, a verification pass, and tool access for context. More candidates raise recall and volume. A verification pass raises precision and lowers recall. Tool access helps some models and hurts others.
- 2 academic tests found no gain from agent loops alone. In CR-Bench, Reflexion cut SNR from 5.11 to 1.95. In SWR-Bench, the multi-agent CR-Agent had a lower F1 than the single-pass LLM-Reviewer. Anthropic Code Review and the first Bugbot design both put a verification pass after parallel finders.
- In AACR-Bench, the agent mode of Claude raised precision from 8.70% to 39.90%, but it made about 19 times fewer review comments. Its recall fell from 42.86% to 10.10%.
- On ReviewBench, precision changes by about 12 points across 38 configurations, but recall changes by about 45 points. For systems that already filter, more depth mostly buys recall.
- The "less than 1%" value of Anthropic is not a precision value. Engineers do not mark each incorrect issue, so the true error rate can be higher.
- In c-CRAB, the 2 tools with the most review comments had the 2 highest pass rates. Claude Code and Devin wrote about 4 times as many comments as Codex. A tool can get more recall from more output, and not from better review quality.
- On 1 diff, this design has the best support: parallel finders, 1 verification pass for each candidate issue, dedupe and a severity rank. Anthropic Code Review, the first Bugbot design and the Defect-focused ACR paper use this shape.

### Gaps

- I found no controlled ablation that keeps the model, token budget and prompts constant and changes only single-agent against multi-agent review.
- I found no comparison of single-agent and multi-agent review on C or C++ code.
- Anthropic publishes no precision or recall for its own pipelines on a public ground truth. Cursor publishes only its resolution rate.

## 2. Specialised reviewers for each concern compared with 1 generalist reviewer

### Takeaway

The evidence for specialists is moderate, and most of it comes from security and comment-category tasks. In 1 industry paper, specialist prompts raised recall by 19.38 points at the same precision. No study measured concurrency, logic or test specialists, and no study held the token budget constant.

### Cited Findings

- [Industry paper] iCodeReviewer (Huawei and partners, October 2025) uses "prompt experts". Each expert is a prompt pipeline for 1 security issue type. A route step activates the experts that match the features of the code. Source: [iCodeReviewer, arXiv 2510.12186](https://arxiv.org/html/2510.12186v1)
- [Industry paper] The iCodeReviewer dataset has 682 programs: 345 with real security issues and 337 benign programs. 360 programs are C and C++, 181 are Java, 101 are Python and 40 are Shell. The model is Qwen-2.5 72B. Source: [iCodeReviewer](https://arxiv.org/html/2510.12186v1)

| iCodeReviewer configuration | Precision | Recall | F1 |
|---|---|---|---|
| Full system | 75.48 | 62.68 | 63.98 |
| Without prompt experts | 75.26 | 43.30 | 47.17 |
| Best baseline: DeepSeek R1 with instructions | 67.19 | 47.29 | 48.43 |
| Qwen 2.5 with instructions | 73.58 | 41.31 | 45.59 |

Source: [iCodeReviewer](https://arxiv.org/html/2510.12186v1)

- [Industry paper] In the table, the experts added 19.38 points of recall at almost the same precision. This is my calculation. The paper did not measure the route step alone. Source: [iCodeReviewer](https://arxiv.org/html/2510.12186v1)
- [Industry paper] M-Score, the share of comments that mislead, was 40.30 for iCodeReviewer, against 59.94 and 72.73 for 2 baselines. Lower is better. Source: [iCodeReviewer](https://arxiv.org/html/2510.12186v1)
- [Industry paper] In 1 week on production line 1, the acceptance rate was up to 84% for C and C++ and 71% for Java. These rates were 71.43% and 82.05% higher than the rates of the earlier tool. On line 2, the rate improved by about 36.84%. Source: [iCodeReviewer](https://arxiv.org/html/2510.12186v1)
- [Independent study] RevAgent uses 5 category agents: Refactoring, Bugfix, Testing, Logging and Documentation. 1 critic agent selects 1 comment from the 5 candidates. Source: [RevAgent, arXiv 2511.00517](https://arxiv.org/html/2511.00517v1)

| RevAgent base model | Category accuracy, 5 specialists | Category accuracy, 1 unified agent |
|---|---|---|
| Llama-3-8B | 56.52% | 42.64% |
| Deepseek-Coder-6.7B | 67.13% | 60.32% |
| Qwen2.5-Coder-7B | 63.02% | 59.95% |
| Qwen2.5-Coder-14B | 54.13% | 47.83% |

Source: [RevAgent](https://arxiv.org/html/2511.00517v1). BLEU changed little, for example from 7.82 to 8.51 for Llama-3-8B. The paper gives no precision or recall.

- [Vendor claim] Qodo "Extended" adds agents for logic errors, best-practice violations, edge cases and cross-file dependencies. It merges their output through verification and dedupe. Qodo says that this improves recall with no loss of precision. Extended is a research system, not a product. Source: [Qodo, 12 March 2026](https://www.qodo.ai/blog/qodo-outperforms-claude-in-code-review-benchmark)
- [Vendor-run benchmark] On the benchmark of Qodo, Qodo Default had precision 79% and recall 60%. Qodo says that it leads Claude Code Review by 12 F1 points at equal precision. Source: [Qodo](https://www.qodo.ai/blog/qodo-outperforms-claude-in-code-review-benchmark)
- [Vendor-run benchmark] The Qodo benchmark has 100 PRs with 580 injected issues, in 8 repositories and 7 languages, with C. An LLM injected 1 to 3 functional bugs into each PR, and it also injected rule violations. Source: [Qodo benchmark method, 4 February 2026](https://qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review)
- [Industry paper] In BitsAI-CR, the effect of the verification pass was different for each concern. Source: [BitsAI-CR, arXiv 2501.15134](https://arxiv.org/html/2501.15134v1)

| BitsAI-CR dimension | Precision before | Precision after | Recall before | Recall after |
|---|---|---|---|---|
| Code defect | 53.88% | 68.92% | 43.71% | 33.77% |
| Security vulnerability | 58.82% | 61.29% | 47.62% | 45.24% |
| Maintainability and readability | 58.12% | 63.60% | 46.74% | 43.34% |
| Performance issue | 72.00% | 72.00% | 45.00% | 45.00% |

Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)

- [Vendor documentation] The Anthropic plugin splits its finders by concern and by evidence source. 2 agents check CLAUDE.md rules. 1 agent checks the diff alone for bugs. 1 agent checks security and logic. Source: [code-review command file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Vendor documentation] The README version of the same plugin names a 4th agent for git blame and history. Source: [code-review README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md)
- [Unconfirmed] "Debate or Vote" (NeurIPS 2025) found slightly larger gains from heterogeneous personas on some tasks, for example MMLU Professional Medicine. Source: [arXiv 2508.17536](https://arxiv.org/abs/2508.17536)

### Inferences

- Specialists help most where a concern has a list of known defect types, for example the CWE types in security. In C and C++, memory safety, undefined behavior, concurrency and resource leaks have such lists. No source measured specialists for these concerns.
- Specialists add candidate volume. They need a shared verification pass and a dedupe step, as in Qodo Extended and the critic of RevAgent.
- In BitsAI-CR, the verification pass cut recall most for code defects: 9.94 points. A threshold for each concern can be better than 1 global threshold.
- The gains from specialists can come from more total tokens and more diverse samples, and not from the specialization. No source controls for this.
- In the target skill, the user selects focus areas. A specialist finder for each selected focus area agrees with the route design of iCodeReviewer.

### Gaps

- No study measured specialists for concurrency, logic or tests.
- No study compared N specialist passes with N generalist samples at the same token budget.
- No study measured the route step alone, against all specialists on all diffs.

## 3. Verification, self-critique and judge passes that filter candidate issues

### Takeaway

In the measured cases, a verification pass cost 5.7 to 11.1 points of recall. In return, precision rose 8.6 points in BitsAI-CR, and the false alarm rate fell 12.4 points in the Defect-focused ACR paper. The effect was different for each concern. A self-critique loop that searches for missed bugs did the opposite: recall went up, and SNR went down. LLM self-scores of severity failed in 1 production report.

### Cited Findings

#### Verification passes with numbers

- [Industry paper] BitsAI-CR (ByteDance, FSE 2025) has 2 stages. RuleChecker finds candidate issues against a taxonomy of 219 rules. ReviewFilter is the verification pass. Both are fine-tuned models. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [Industry paper] On 1,397 offline cases, ReviewFilter raised precision from 57.03% to 65.59%. It lowered recall from 45.50% to 39.77%. The paper text also gives 54.50% to 67.12%, which does not agree with its Table 2. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [Industry paper] BitsAI-CR compared 3 output formats for ReviewFilter on 400 more samples. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)

| ReviewFilter format | Precision | Recall | Share removed | Time for each sample |
|---|---|---|---|---|
| Direct Conclusion | 63.27% | 77.50% | 38.75% | 1.7 s |
| Reasoning-First | 65.80% | 81.80% | 30.00% | 31.0 s |
| Conclusion-First | 77.09% | 69.00% | 55.25% | 1.7 s |

Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1). The team selected Conclusion-First.

- [Industry paper] Online, ReviewFilter precision went from 35.6% to a peak of 75%. RuleChecker precision went from 27.9% to 62.6%. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [Independent study] "Towards Practical Defect-Focused Automated Code Review" (ICML 2025) uses industrial C++ merge requests from fault reports. Its Validator re-scores each review comment for nitpick, fake problem and criticality, on a scale of 1 to 7. Source: [Defect-focused ACR, arXiv 2505.17928](https://arxiv.org/html/2505.17928v2)
- [Independent study] In that paper, KBI is key bug inclusion: the share of key bugs that the review comments include. FAR1 and FAR2 are 2 variants of the false alarm rate. CPI1 and CPI2 are summary scores of the paper. Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)

| Defect-focused ACR, Left Flow slice, LLaMA3.1-405B | Without Validator | With Validator |
|---|---|---|
| KBI, higher is better | 31.11 | 20.00 |
| FAR1, lower is better | 87.81 | 75.37 |
| CPI1, higher is better | 17.51 | 22.07 |
| FAR2, lower is better | 67.98 | 43.52 |
| CPI2, higher is better | 31.56 | 29.54 |

Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)

- [Independent study] A coarse filter in the same paper discards a review comment if its nitpick score or fake-problem score is 4 or less. It then keeps the top N comments by criticality. Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)

| Defect-focused ACR, 1 reviewer, Left Flow slice | KBI | FAR1 |
|---|---|---|
| All comments | 37.04 | 94.36 |
| After the coarse filter | 33.33 | 92.03 |
| Top-10 | 32.59 | 91.13 |
| Top-5 | 25.93 | 90.15 |
| Top-3 | 17.78 | 90.00 |

Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)

- [Industry paper] RovoDev Code Reviewer (Atlassian, ICSE-SEIP 2026) uses "quality-checked" comment generation without fine-tuning. In 1 year of use, 38.70% of its review comments led to a code change. PR cycle time went down by 30.8%. Human-written comments went down by 35.6%. Source: [RovoDev, arXiv 2601.01129](https://arxiv.org/abs/2601.01129)
- [Unconfirmed] Secondary summaries say that the verification pass of RovoDev is an LLM-as-a-judge check of factual correctness, with gpt-4o-mini. They say that poorly aligned comments fell from 22% to 7%. These numbers are not in the abstract. Source: [alphaXiv overview](https://www.alphaxiv.org/overview/2601.01129v2); [ZenML LLMOps database](https://www.zenml.io/llmops-database/ai-driven-code-review-agent-reduces-pr-cycle-time-by-308)
- [Independent study] ZeroFalse gives static-analysis alarms, flow traces and CWE-specific context to an LLM for a verdict. The best models got F1 0.912 on the OWASP Java Benchmark and 0.955 on OpenVuln. Precision and recall stayed above 90%. Source: [ZeroFalse, arXiv 2510.02534](https://arxiv.org/abs/2510.02534)
- [Independent study] ZeroFalse reports that reasoning models give "the most reliable precision-recall balance". Source: [ZeroFalse](https://arxiv.org/abs/2510.02534)
- [Unconfirmed] A June 2025 study tuned LLMs to remove static-analysis false positives with no loss of true positives. The best LLM removed 33.85% of the false positives. Source: [arXiv 2506.16899](https://arxiv.org/abs/2506.16899)
- [Vendor claim] Datadog found that prompts tuned to keep true positives let more false positives through. Prompts tuned to remove false positives lost real issues. Datadog gives no numbers. Source: [Datadog, 28 October 2025](https://www.datadoghq.com/blog/using-llms-to-filter-out-false-positives/)

#### LLM self-judgment and self-critique

- [Vendor claim] Greptile (18 December 2024) had the LLM rate each review comment from 1 to 10. It dropped comments with a score under 7. Greptile writes that "the LLMs judgment of its own output was nearly random". The extra call also made the bot "extremely slow". Source: [Greptile, Make LLMs shut up](https://greptile.com/blog/make-llms-shut-up)
- [Vendor claim] The baseline comments of Greptile were about 19% good, 2% incorrect and 79% nits. Prompts could not cut nits without fewer critical comments. Few-shot examples "made the bot even worse". Source: [Greptile](https://greptile.com/blog/make-llms-shut-up)
- [Vendor claim] Greptile then stored embeddings of earlier comments for each team. It blocked a new comment if the comment was similar to at least 3 downvoted comments. In 2 weeks, the address rate went from about 19% to "55+%". Source: [Greptile](https://greptile.com/blog/make-llms-shut-up)
- [Independent study] In CR-Bench, the Reflexion self-critique loop raised GPT-5.2 recall from 27.01% to 32.76%. SNR fell from 5.11 to 1.95. Usefulness fell from 83.63% to 66.10%. Source: [CR-Bench](https://arxiv.org/html/2603.11078)
- [Independent study] [Older] Huang et al. (ICLR 2024, first version October 2023) state that LLMs "struggle to self-correct their responses without external feedback". At times, performance went down after self-correction. I read only the abstract. Source: [arXiv 2310.01798](https://arxiv.org/abs/2310.01798)
- [Independent study] CriticGPT (OpenAI, 2024) uses Force Sampling Beam Search (FSBS) to set how many issues a critique includes. Longer critiques catch more bugs, but they also contain more hallucinated bugs and nitpicks. Source: [LLM Critics Help Catch LLM Bugs, arXiv 2407.00215](https://arxiv.org/html/2407.00215v1)
- [Independent study] Teams of a human and CriticGPT went past the model-only Pareto frontier for this trade-off. Raters preferred CriticGPT critiques to human critiques in 62.8% of cases, on code with LLM errors that occurred naturally. Source: [CriticGPT](https://arxiv.org/html/2407.00215v1)

#### Verifier budget and model

- [Vendor claim] OpenAI (1 December 2025) writes: "Precision is more important for usability than recall." The team accepted "modestly reduced recall in exchange for high signal quality and developer trust". Source: [OpenAI, A Practical Approach to Verifying Code at Scale](https://alignment.openai.com/scaling-code-verification/)
- [Vendor claim] In a budget sweep on known bugs, the OpenAI verifier caught "a large share" of high-severity issues. It needed only "a small fraction of the generator's token spend". More budget "mostly improves calibration and reduces false alarms". The text gives no curve values. Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [Vendor claim] Authors changed their code for 52.7% of the OpenAI review comments. Over 80% of the reactions were positive. In October 2025, the system reviewed "more than 100k external PRs per day". Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [Vendor documentation] The Anthropic plugin uses Opus to check bug and logic issues and Sonnet to check CLAUDE.md issues. Each verification subagent checks 1 issue. Source: [code-review command file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Unconfirmed] [Vendor claim] The Claude Security product page states: "Claude re-examines each result to prove or disprove it, filters false positives, and assigns severity and confidence ratings". Secondary coverage says that Anthropic published no false-positive rate. Source: [Claude Security](https://anthropic.com/product/security)

### Inferences

- A verification pass works when it gets something that the finder did not have. Examples are more code context, a data-flow slice, a rule text or an execution result. Self-critique with the same context added noise in CR-Bench.
- Expect a strict verification pass to cost about 6 to 11 points of recall. A low effort level can use a strict pass. A high effort level can keep rejected candidates in a separate list of uncertain issues.
- Conclusion-First verdicts are cheap and favor precision. Reasoning-First verdicts favor recall. In BitsAI-CR, they took about 18 times longer for each sample: 31.0 s against 1.7 s.
- Team feedback was a stronger noise filter than LLM self-judgment in the data of Greptile. A local skill can use a project file of rejected issue types in the same way.
- In the target design, the same agent wrote the code under review. Run the review in a fresh context, because self-correction without external feedback is weak. Claude Code runs /code-review as a background subagent with its own context window. Source: [Claude Code docs, /code-review](https://code.claude.com/docs/en/code-review-local)

### Gaps

- Anthropic and Cursor publish no precision or recall before and after their verification passes.
- No study compared a verifier from a different model family with a verifier from the same model.
- No study measured the recall cost of a verification pass on C or C++ concurrency bugs.

## 4. Confidence scores and thresholds

### Takeaway

All studies that I found show poor calibration of verbalized LLM confidence for code tasks. Production systems that use a threshold apply it to a separate re-score with a rubric. Other systems use agreement between passes or team feedback. The thresholds in use, 80 of 100, 7 of 10 and 4 of 7, have no published calibration data.

### Cited Findings

- [Independent study] Spiess et al. (arXiv February 2024, ICSE 2025) studied confidence for generated code. They found that "the levels of alignment between the intrinsic confidence ... and correctness is poor". Source: [Calibration and Correctness of Language Models for Code, arXiv 2402.02047](https://arxiv.org/abs/2402.02047)
- [Independent study] In the same study, rescaling, for example Platt scaling, generally improved calibration. But rescaling needs correctness data first. Reflective methods were "rather inconsistent". The models were GPT-3.5, Codex and CodeGen2-16B. Source: [Spiess et al.](https://arxiv.org/abs/2402.02047)
- [Unconfirmed] A 2026 study of security calibration in code LLMs reports severe miscalibration of verbalized confidence. Expected calibration error (ECE) was 0.456 to 0.481 for GPT-4o-mini and 0.408 to 0.421 for Qwen3-Coder-Next. Gemini-2.0-Flash had 0.247 to 0.263. Source: [arXiv 2606.31159](https://arxiv.org/pdf/2606.31159)
- [Unconfirmed] The same study reports an ECE of about 0.80 for token probabilities. It found that the temperature had little effect on calibration. I saw only a search summary, and I could not confirm the venue. Source: [arXiv 2606.31159](https://arxiv.org/pdf/2606.31159)
- [Unconfirmed] [Older] Xiong et al. (ICLR 2024, first version 2023) found an average ECE above 0.377 for the verbalized confidence of GPT-3, GPT-3.5 and Vicuna. Source: [arXiv 2306.13063](https://arxiv.org/pdf/2306.13063)
- [Vendor claim] The self-score of Greptile, from 1 to 10 with a cut at 7, was "nearly random". Source: [Greptile](https://greptile.com/blog/make-llms-shut-up)
- [Vendor documentation] The README of the Anthropic code-review plugin describes 1 independent scorer for each issue, on a scale from 0 to 100. The command filters "any issues with a score less than 80". Source: [code-review README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md)

| Score | Rubric text in the README |
|---|---|
| 0 | "Not confident, false positive" |
| 25 | "Somewhat confident, might be real" |
| 50 | "Moderately confident, real but minor" |
| 75 | "Highly confident, real and important" |
| 100 | "Absolutely certain, definitely real" |

Source: [code-review README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md)

- [Vendor documentation] The current command file of the same plugin has no numeric scale. It uses 1 verification subagent for each issue. It states: "If you are not certain an issue is real, do not flag it." Thus, the README and the command file describe 2 different versions. Source: [code-review command file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Independent study] The Defect-focused ACR paper scores nitpick and fake problem on a scale of 1 to 7. It discards a review comment if either score is 4 or less. It gives no number for the final Validator threshold. Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)
- [Vendor documentation] Claude Code /code-review: "At low, the review reports the findings it's most confident in, so you see fewer false positives. From medium through max, the review broadens coverage." Source: [Claude Code docs, /code-review](https://code.claude.com/docs/en/code-review-local)
- [Vendor documentation] Anthropic Code Review ranks issues by 3 severity levels: Important, Nit and Pre-existing. It shows no confidence value. An issue can have a "Why this was flagged" section that tells how Claude checked the problem. Source: [Claude Code docs, Read and request reviews on a pull request](https://code.claude.com/docs/en/code-review-pull-requests)
- [Vendor claim] OpenAI uses a utility rule. An issue is worth a report when P(correct) × C_saved is more than the human check cost plus P(incorrect) × C_false_alarm. Purely stylistic comments can have negative utility. Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [Vendor claim] The first Bugbot used agreement between passes as the signal. A majority vote removed bugs that only 1 of 8 passes found. Source: [Cursor](https://cursor.com/blog/building-bugbot)
- [Independent study] In SWR-Bench, only 27 correctly found change-points were the same across 5 runs of the same LLM. Only 36 were the same across different LLMs. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)

### Inferences

- Do not use a verbalized confidence number as the only gate. Use 3 separate signals: the verdict and evidence of the verification pass, the agreement across finder passes, and the severity.
- If the skill shows a confidence value, calibrate it on labeled issues from the repositories of the user. Spiess et al. show that rescaling helps when labeled data exist.
- The threshold of 80 in the plugin README is a convention. I found no published calibration curve for it.
- Agreement between runs was low in SWR-Bench. Thus, a majority-vote gate removes many true issues. At high effort levels, use agreement as a confidence signal, not as a gate.
- Keep severity and confidence as 2 fields. Anthropic Code Review ranks by severity, and Claude Security reports both values.

### Gaps

- No vendor published a calibration curve for the confidence of review issues.
- No study measured whether reasoning models give better calibrated confidence for review issues.

## 5. Votes, ensembles, self-consistency and many samples

### Takeaway

More samples raise recall, but each further sample adds less. In 1 study, an LLM aggregator over 10 samples raised F1 by 43.67%, mostly through recall. A majority vote raises precision but removes true issues that only 1 pass finds, and agreement between passes is low. Ensembles of different tools or models also raised coverage. No source compared them with repeats of 1 model at the same cost.

### Cited Findings

- [Independent study] SWR-Bench ran PR-Review n times, with n = 0, 1, 3, 5 and 10. It merged the reports with 1 more LLM call. The aggregator LLM removes points that are not valid and merges the other points. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)

| SWR-Bench Self-Agg, n = 10 | F1 after | F1 change | Recall after |
|---|---|---|---|
| Gemini-2.5-Flash | 21.91% | +43.67%, from 15.25% | 30.44%, +118.83% |
| Qwen-2.5-7B | 14.67% | +26.13% | not given |
| Qwen-2.5-32B | 16.41% | +19.25% | not given |

Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1). The paper gives no values for the change in precision. It states that precision still needs improvement.

- [Independent study] In the Defect-focused ACR paper, a meta-reviewer keeps review comments that more than 1 reviewer flags. With 3 reviewers instead of 1, KBI went from 26.67 to 31.11. FAR1 went from 83.26 to 87.81, and CPI1 fell from 20.57 to 17.51. Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)
- [Vendor claim] The first Bugbot ran 8 passes with random diff order and a majority vote. Cursor later replaced this design with an agent. Cursor gives no numbers for the vote stage alone. Source: [Cursor](https://cursor.com/blog/building-bugbot)
- [Vendor-run benchmark] GitHub did an online A/B test of a multi-model ensemble for the Copilot Lite tier. The addressed rate went up 8.0%, recall went up 13.6%, and comment volume went up 61%. Cost for each review went down 8.0%. Source: [GitHub blog, ReviewBench](https://github.blog/news-insights/research/reviewbench-an-open-benchmark-for-ai-code-review/)
- [Vendor-run benchmark] In the same test, critical comments went up 262% online. ReviewBench predicted 227%. Source: [GitHub blog](https://github.blog/news-insights/research/reviewbench-an-open-benchmark-for-ai-code-review/)
- [Independent study] In c-CRAB, the union of 4 tools passed 41.5% of the tests. The best single tool passed 32.1%. Source: [c-CRAB](https://arxiv.org/html/2603.23448v3)
- [Unconfirmed] Large Language Monkeys (2024) found that coverage grows nearly log-linearly with the number of samples. On SWE-bench Lite, coverage went from 15.9% with 1 sample to 56% with 250 samples. This is a code generation task, not a review task. Source: [arXiv 2407.21787](https://arxiv.org/abs/2407.21787)
- [Unconfirmed] Chen et al. (NeurIPS 2024) found that the accuracy of a vote system can first go up and then go down as the number of LLM calls increases. More calls help on easy queries and hurt on hard queries. Source: [Are More LLM Calls All You Need?, arXiv 2403.02419](https://arxiv.org/abs/2403.02419)
- [Unconfirmed] "Debate or Vote" (NeurIPS 2025) found that majority vote gives most of the gain of multi-agent debate on 7 NLP benchmarks. For Qwen2.5-7B, mean accuracy was about 0.72 for 1 agent, 0.67 for centralized debate and 0.77 for majority vote. Source: [arXiv 2508.17536](https://arxiv.org/abs/2508.17536)

### Inferences

- For review, "union, then verify" keeps more true issues than "vote, then report". Agreement across runs is low, so a vote gate removes many real issues.
- A vote is a cheap precision signal at low and medium effort levels. At high effort levels, take the union of the passes and send each candidate issue to the verification pass.
- Sample coverage becomes precision only through a good verifier. Large Language Monkeys measured coverage, not the accuracy of a selected answer.
- The data show 4 low-cost sources of diversity: diff order (Cursor), context slice (Defect-focused ACR), focus prompt (iCodeReviewer) and model (GitHub ensemble). The evidence does not rank these sources.
- Debate between agents adds little over a vote. Spend tokens on more finder samples or on verification, not on debate rounds.
- In a Claude Code skill, model diversity is limited to Claude models. Diversity of prompt, focus and diff order is available with no extra setup.

### Gaps

- No study gives the precision effect of a majority vote alone on code review issues.
- No study measured more than 10 samples for code review. The best sample count for review is unknown.

## 6. More depth: agents, passes, reasoning tokens, context, cost and latency

### Takeaway

Recall rises with the effort level and then flattens. Precision stays almost constant across levels in ReviewBench, the only benchmark with data for each effort level. Targeted context helps, but similarity-retrieved context can hurt. At the top levels, cost rises much faster than recall. In 1 third-party test, max cost more than 50 times as much as xhigh, with no recall gain on a small diff.

### Cited Findings

#### Effort level and reasoning tokens

- [Vendor-run benchmark] ReviewBench lists Codex at 6 effort levels. The table gives grounded recall and grounded precision from the board of 29 October 2026. Source: [benchmarklist.com copy of the ReviewBench board](https://benchmarklist.com/benchmarks/review_bench/)

| Codex model and metric | Low | Medium | High | xHigh | Max | Ultra |
|---|---|---|---|---|---|---|
| GPT-5.6 Sol, recall | 9.74% | 13.71% | 15.8% | 17.69% | 18.46% | 17.86% |
| GPT-5.6 Sol, precision | 90.2% | 88.55% | 89.04% | 88.77% | 85.99% | 85.9% |
| GPT-5.6 Terra, recall | 5.65% | 6.51% | 9.15% | 11.13% | 14.51% | 14.57% |
| GPT-5.6 Terra, precision | 88.5% | 87.64% | 88.04% | 90.14% | 90.19% | 89.98% |
| GPT-5.4, recall | 7.62% | 9.48% | 11.89% | 12.41% | not listed | not listed |
| GPT-5.4, precision | 88.74% | 87.99% | 87.99% | 88.74% | not listed | not listed |
| GPT-5.5, recall | 5.75% | 7.65% | 8.87% | 10.52% | not listed | not listed |
| GPT-5.5, precision | 83.75% | 83.71% | 85.67% | 88.59% | not listed | not listed |

Source: [benchmarklist.com](https://benchmarklist.com/benchmarks/review_bench/)

- [Vendor-run benchmark] Copilot code review had recall 22.98% at Lite, 21.77% at Balanced and 27.99% at Max. Its precision was 87.37%, 88.19% and 87.81%. Source: [benchmarklist.com](https://benchmarklist.com/benchmarks/review_bench/)
- [Vendor-run benchmark] Model choice changed recall as much as the effort level did. At xHigh, GPT-5.6 Sol had recall 17.69%, and GPT-5.5 had 10.52%. Source: [benchmarklist.com](https://benchmarklist.com/benchmarks/review_bench/)
- [Third-party test] bestagent.dev ran Claude Code /code-review at 5 effort levels, with Opus 5.5 and Claude Code 2.1.310, on 25 October 2026. The change had 222 lines in 8 Python files, with 12 planted bugs and 4 decoy lines. Source: [bestagent.dev](https://bestagent.dev/claude-code-review-effort-levels-tested-2026)

| /code-review level | Runs | Planted bugs found in each run | Cost for each run | Time for each run |
|---|---|---|---|---|
| low | 3 | 5, 4 and 12 | $0.06 to $0.07 | 9 to 12 s |
| medium | 3 | 12 each | $0.13 to $0.14 | 26 to 32 s |
| high | 3 | 12 each | $0.14 to $0.17 | 31 to 42 s |
| xhigh | 2 | 12 each | $0.32 to $0.36 | 91 to 103 s |
| max | 1 | 12 | $18.73 | 24 min |

Source: [bestagent.dev](https://bestagent.dev/claude-code-review-effort-levels-tested-2026)

- [Third-party test] At max, the review used 30 agents: 9 finders, 19 verifiers and 1 sweep. Medium with --max-findings all found all 12 bugs for $0.15. Source: [bestagent.dev](https://bestagent.dev/claude-code-review-effort-levels-tested-2026)
- [Third-party test] On the fixed version of the change, the review still reported issues. It reported 1 at low, 10 at medium, 8 at high, 15 at xhigh and 15 at max. Most were suggestions, not real defects. On the fixed change, max cost $22.64 and took about 38 minutes. Source: [bestagent.dev](https://bestagent.dev/claude-code-review-effort-levels-tested-2026)
- [Third-party test] The authors state that the runs are too few to separate random variation from real differences between levels. They did tests on only 1 synthetic Python change. Source: [bestagent.dev](https://bestagent.dev/claude-code-review-effort-levels-tested-2026)
- [Unconfirmed] A search summary of the same test reports issue caps of 4 at low, 10 at medium and high, and 15 at xhigh and max. Source: [bestagent.dev](https://bestagent.dev/claude-code-review-effort-levels-tested-2026)
- [Vendor documentation] /code-review reports up to 32 issues when it uses the findings tool. The --max-findings flag changes this limit. Source: [Claude Code docs, /code-review](https://code.claude.com/docs/en/code-review-local)
- [Vendor documentation] In ultrareview, "a larger fleet of reviewer agents explores the change in parallel". A review typically takes 5 to 15 minutes and costs $5 to $25. A branch review accepts up to 500 changed files and 8,000 changed lines by default. Source: [Claude Code docs, ultrareview](https://code.claude.com/docs/en/ultrareview)
- [Vendor claim] Anthropic Code Review gives large or complex changes more agents and a deeper read. Trivial changes get a "lightweight pass". A review takes about 20 minutes and costs $15 to $25 on average. Source: [Anthropic](https://claude.com/blog/code-review)
- [Vendor documentation] The cost of Code Review scales with the review level, the change size, the code complexity and "how many candidate issues need verification". The review levels are Quick, Standard and Deep. Source: [Claude Code docs, Code Review costs](https://code.claude.com/docs/en/code-review-costs)
- [Vendor claim] OpenAI found that recall dropped faster at a lower thinking budget on Codex-generated code than on human-written code. Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [Vendor claim] Codex review commented on 36% of the PRs that Codex cloud generated. Authors changed code for 46% of those comments, against 53% on human PRs. Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [Unconfirmed] OpenAI states that GPT-5-Codex review comments were less likely to be incorrect or unimportant than GPT-5 comments. Secondary coverage gives 4.4% incorrect against 13.7%, and 52% high-impact against 39%. Source: [OpenAI, Introducing upgrades to Codex](https://openai.com/index/introducing-upgrades-to-codex/); [The New Stack](https://thenewstack.io/openai-launches-a-new-gpt-5-model-for-its-codex-coding-agent/)
- [Independent study] In SWR-Bench, reasoning models such as Gemini-2.5-Pro and DeepSeek-R1 generally did better. Standard Qwen-2.5 models had a peak F1 of 13.76, and Qwen-2.5-R1-14B got 15.95. Claude-4-Opus and Claude-4-Sonnet did worse than Claude-3.7-Sonnet. Source: [SWR-Bench](https://arxiv.org/html/2509.01494v1)
- [Vendor claim] For the research system of Anthropic on BrowseComp, "token usage by itself explains 80% of the variance". Token usage, tool calls and model choice together explained 95%. Source: [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Vendor claim] The research prompts of Anthropic scale effort with the task. They give "1 agent with 3-10 tool calls" for simple facts and "2-4 subagents with 10-15 calls each" for comparisons. They give "more than 10 subagents" for complex research. Source: [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)

#### Context

- [Independent study] In the Defect-focused ACR paper on C++, the context slice changed KBI for 1 reviewer. KBI was 23.70 for the original diff, 31.85 for the parent function, 37.04 for Left Flow and 39.26 for Full Flow. Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)
- [Independent study] In AACR-Bench without an agent, Claude recall fell as the context grew: 45.76% for the diff, 40.54% for the file and 38.63% for the repository. Source: [AACR-Bench](https://www.alphaxiv.org/abs/2601.19494)
- [Independent study] In AACR-Bench, BM25 top-3 retrieval cut Claude F1 from 14.46 to 9.98, or 31%. The same retrieval raised DeepSeek-V3.2 F1 from 9.71 to 15.59. Source: [AACR-Bench](https://www.alphaxiv.org/abs/2601.19494)
- [Independent study] Agents reversed the trend in AACR-Bench. DeepSeek-V3.2 agent recall went from 4.28% at the diff level to 8.00% at the repository level. Source: [AACR-Bench](https://www.alphaxiv.org/abs/2601.19494)
- [Independent study] For each language, GPT-5.2 without context got F1 0.309 on C# and 0.085 on C. The Claude agent got 0.247 on Python and 0.081 on TypeScript. Source: [AACR-Bench](https://www.alphaxiv.org/abs/2601.19494)
- [Unconfirmed] ContextCRBench, an FSE 2026 industry paper, found that textual context gave larger gains than code context alone, over 8 LLMs. Textual context is the issue and PR descriptions. The dataset has 67,910 entries from 90 repositories in 9 languages. Source: [arXiv 2511.07017](https://arxiv.org/abs/2511.07017)
- [Vendor claim] OpenAI found that repository-wide tools and code execution gave a reviewer "catching more critical issues and raising fewer false alarms". The exact rates are only in charts. Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [Vendor claim] Cursor moved context to dynamic discovery at runtime. Small changes in tool design had "an outsized impact on outcomes". Source: [Cursor](https://cursor.com/blog/building-bugbot)

### Inferences

- Recall gains get smaller at the top levels. For GPT-5.6 Sol, the steps from Low to Ultra changed recall by +3.97, +2.09, +1.89, +0.77 and -0.60 points. For Terra, the flat step came only at Ultra.
- Precision stays almost constant across effort levels on ReviewBench. Thus, the effort level is mainly a control for recall and cost. Precision comes from the verification design.
- In the third-party test, max cost more than 50 times as much as xhigh, with no recall gain on a 222-line change. A gain from max probably needs large diffs with many interactions. No source measured this.
- Give finders targeted slices and tool access: callers, callees, data flow and headers. Do not paste similarity-retrieved code, because AACR-Bench shows a 31% F1 loss for 1 model.
- For C++, data-flow slices raised key-bug recall by 66% in the Defect-focused ACR paper, from 23.70 to 39.26.
- Scale the number of finders with the diff size, as Anthropic Code Review does.
- The OpenAI result on Codex-generated code is important here, because Claude Code reviews its own output. A low thinking budget can lose more recall on code that an AI wrote.

#### Inferred effort ladder for the C and C++ pre-commit skill

No source measured this ladder as a whole. Each row combines the findings above.

| Level | Finder passes | Context | Verification pass | Report rule | Main evidence |
|---|---|---|---|---|---|
| low | 1 generalist pass | Diff and changed functions | Strict Conclusion-First verdict, or none | Only issues with a concrete failure scenario; about 4 issues | /code-review low reports the "most confident" issues; Conclusion-First precision 77.09% in BitsAI-CR |
| medium | 1 agent pass with tools | Callers, callees and headers on demand | 1 verdict for each issue | About 10 issues | Medium found 12 of 12 bugs at about 2 times the low cost; Sol recall +41% from Low to Medium |
| high | 2 to 3 passes with a different diff order or focus | Data-flow slices | 1 verifier for each issue, in a fresh context | Union, dedupe and rank; about 10 to 15 issues | 3 reviewers raised KBI by 4.44 points; SWR-Bench aggregation |
| xhigh | 1 specialist pass for each focus area that the user selects | Slices and project rules | Reasoning-First verifier; keep a list of uncertain issues | About 15 issues | Prompt experts +19.38 recall in iCodeReviewer; Reasoning-First recall 81.80% in BitsAI-CR |
| max | Many finders, 1 verifier for each candidate, 1 final sweep | Full tool access; a build and sanitizers if available | Reproduction by execution where possible | All verified issues | Max used 30 agents in the third-party test; ultrareview reproduces each issue |

### Gaps

- No study changed only the reasoning token budget of Claude models for code review.
- ReviewBench grounded precision is 77.84% to 90.2% for all listed systems. I do not know if this metric separates systems well on precision.
- Most ReviewBench configurations have no published cost for each review.
- I found no latency or cost data for the Defect-focused ACR method or for SWR-Bench aggregation.

## 7. A concrete failure scenario or reproduction for each issue

### Takeaway

No controlled study changed only the need for a failure scenario. Indirect evidence supports it: verification passes that check for a "fake problem", use data-flow evidence or run code reduced false alarms. A reproduction is strong evidence only if a check shows that it reaches the flagged code: in PoC-Gym, about 44% of runtime-successful exploits were invalid.

### Cited Findings

- [Vendor documentation] Ultrareview: "every reported finding is independently reproduced and verified, so the results focus on real bugs rather than style suggestions". Anthropic gives no precision number. Source: [Claude Code docs, ultrareview](https://code.claude.com/docs/en/ultrareview)
- [Vendor documentation] The managed Code Review "works from reading the diff and the surrounding code, without building or running your code". Source: [Claude Code docs, Code Review](https://code.claude.com/docs/en/code-review)
- [Vendor documentation] The plugin flags a bug only where "The code will definitely produce wrong results regardless of inputs". It also flags code that "will fail to compile or parse". Its diff-only bug agent does not flag issues that need outside context to confirm. Source: [code-review command file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Vendor claim] OpenAI calls repository-wide tools and code execution necessary for its reviewer. With them, the reviewer caught more critical issues and raised fewer false alarms. Source: [OpenAI](https://alignment.openai.com/scaling-code-verification/)
- [Independent study] The Validator of the Defect-focused ACR paper scores each review comment for "fake problem". With the Validator, FAR2 went from 67.98 to 43.52. Source: [Defect-focused ACR](https://arxiv.org/html/2505.17928v2)
- [Industry paper] In BitsAI-CR, Reasoning-First verdicts removed fewer review comments than Conclusion-First verdicts: 30.00% against 55.25%. Precision was 65.80% against 77.09%, and recall was 81.80% against 69.00%. Source: [BitsAI-CR](https://arxiv.org/html/2501.15134v1)
- [Independent study] The error analysis of AACR-Bench traced incorrect review comments to "unverified speculation" and to context noise. In 1 example, an agent comment on a str.find() check was fabricated. Source: [AACR-Bench](https://www.alphaxiv.org/abs/2601.19494)
- [Independent study] PoC-Gym ran LLM-generated exploits for 20 Java CVEs in 338 runs. 116 candidates passed the runtime check. Only 65 also passed a later check against the true vulnerable location. Source: [PoC-Gym, arXiv 2602.04165](https://arxiv.org/abs/2602.04165)
- [Independent study] By my calculation, 51 of 116 runtime-successful exploits, or about 44%, were invalid. Across all 338 runs, 65 exploits, or about 19%, were valid. Source: [PoC-Gym](https://arxiv.org/abs/2602.04165)
- [Unconfirmed] A Substack summary of the same work gives 71.5% invalid "successful" exploits. This value does not agree with the counts in the abstract. Source: [it4sec Substack](https://it4sec.substack.com/p/hacking-using-ai-written-exploits)
- [Independent study] ZeroFalse adds flow traces and CWE context to each verdict and gets F1 0.912 and 0.955. Source: [ZeroFalse](https://arxiv.org/abs/2510.02534)
- [Unconfirmed] AdaTaint pairs LLM suggestions with symbolic validation. It reports 43.7% fewer false positives on average and 11.2% more recall than CodeQL, Joern and LLM-only baselines. Source: [arXiv 2511.04023](https://arxiv.org/abs/2511.04023)
- [Independent study] c-CRAB shows that human review comments can become executable tests: 234 tests from 184 PRs. On 50 instances, 2 authors agreed 84% of the time that a test captured the human concern. Source: [c-CRAB](https://arxiv.org/html/2603.23448v3)
- [Independent study] In c-CRAB, 17.9% of the tests were behavioral and 82.1% were structural. Source: [c-CRAB](https://arxiv.org/html/2603.23448v3)
- [Vendor documentation] An issue from Anthropic Code Review can have a "Why this was flagged" section. It tells why Claude flagged the issue and how Claude checked the problem. Source: [Claude Code docs, Read and request reviews on a pull request](https://code.claude.com/docs/en/code-review-pull-requests)

### Inferences

- Make each issue state a trigger: the input or state, the path through the changed code and the wrong result. A verification pass can then check the scenario against the code, as the "fake problem" score does.
- For C and C++, a compiled reproducer is the strongest evidence where a build exists. Examples are a unit test or a run with AddressSanitizer, UndefinedBehaviorSanitizer or ThreadSanitizer. No source measured this for code review.
- Do not accept "it ran" as proof. Make sure that the reproducer reaches the flagged line, because PoC-Gym found many false successes.
- Keep the verdict short: a Conclusion-First verdict and the scenario. In BitsAI-CR, a long explanation before the verdict let more false issues through.
- Concurrency bugs are hard to reproduce. For them, a written thread interleave is probably the practical limit. No source measured this.

### Gaps

- No A/B test compares the same pipeline with and without the need for a failure scenario.
- Anthropic gives no precision numbers for the reproduction step of ultrareview.
- No source measured sanitizer-backed verification of review issues in C or C++.
