# Benchmarks and measured results for LLM and agentic code review

Status of the notes: 17 November 2026. The notes use these labels:

- "Independent": the group that made the benchmark does not sell a review tool that the benchmark scores.
- "Third party": the group does not sell a review tool, but it is a company and it says that it is independent.
- "Vendor-run": a company that sells a review tool made or ran the benchmark.
- "Own-tool report": a company gives production data about its own tool.
- "Unconfirmed": I saw the statement only in a search summary or in a secondary source. I did not read it in the primary source.
- "Older result": the result is from before 2024.

Abbreviations: LLM is "large language model". PR is "pull request". ACR is "automated code review". F1 is the harmonic mean of precision and recall. A "finding" is 1 issue that a reviewer reports. SZZ is the Sliwerski-Zimmermann-Zeller algorithm, which finds the commit that caused a bug.

## 1. Which code review benchmarks exist, and what do they measure?

### Takeaway

The benchmarks are in 3 groups. The older academic set (CodeReviewer, 2022) compares 1 generated comment with 1 human comment through BLEU. The newer academic sets (2025 to 2026) score PR-level findings with precision, recall and F1 against curated issue lists, usually with an LLM judge. Industry sets score commercial review tools on 50 to 219 PRs, and Martian adds an online score from developer actions.

### Cited Findings

#### Independent academic benchmarks

**CodeReviewer dataset (Microsoft Research, ESEC/FSE 2022). Older result.**

- The data comes from 1,161 GitHub projects in 9 languages: Python, Java, Go, C++, JavaScript, C, C#, PHP and Ruby. It has 7,933k PRs. Source: [CodeReviewer paper on ar5iv](https://ar5iv.labs.arxiv.org/html/2203.09095)
- The 3 tasks are Quality Estimation, Review Comment Generation and Code Refinement. The test sets have about 31k, 10k and 13k samples. Source: [CodeReviewer paper on ar5iv](https://ar5iv.labs.arxiv.org/html/2203.09095)
- The CodeReviewer model got these scores. Quality Estimation: precision 78.60, recall 65.63, F1 71.53, accuracy 73.89. Review Comment Generation: BLEU-4 5.32. Code Refinement: BLEU 82.61, exact match 30.32. Source: [CodeReviewer paper on ar5iv](https://ar5iv.labs.arxiv.org/html/2203.09095)
- A plain copy of the input code got BLEU 58.75 on Code Refinement. Source: [CodeReviewer paper on ar5iv](https://ar5iv.labs.arxiv.org/html/2203.09095)
- In a human evaluation of 100 samples by 6 programmers, CodeReviewer comments got 3.60 for information and 3.20 for relevance, on a scale of 1 to 5. Source: [CodeReviewer paper on ar5iv](https://ar5iv.labs.arxiv.org/html/2203.09095)

**SWR-Bench (arXiv 2509.01494; v1 1 September 2025, v2 5 June 2026; FSE 2026).**

- The set has 1,000 manually verified GitHub PRs: 500 "Change-PRs" with issues and 500 "Clean-PRs" without issues. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- All PRs are Python. They come from 12 popular PyPI projects that SWE-Bench also uses. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- Gemini-2.5-Pro extracted "change-actions" from the review timeline. The authors kept a PR only if 3 independent runs agreed. Then 2 of 5 human annotators checked each PR, with Cohen's Kappa 66.08. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- The authors used SZZ to remove Clean-PRs that contained bugs that later commits fixed. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- A Change-PR has 1.90 change-actions on average. Functional changes are 31.8% of the final set. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- The metric is precision, recall and F1 at the change-action level. The judge is Gemini-2.5-Flash. A full evaluation costs about $1.57. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- For hit identification, the Kappa is 70.6 to 86.7 across human-human, human-LLM and LLM-LLM pairs. The abstract says "~90% agreement", but the body gives only Kappa values. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2); [SWR-Bench abstract](https://arxiv.org/abs/2509.01494)
- FSE 2026 lists the paper. Source: [FSE 2026 listing](https://conf.researchr.org/details/fse-2026/fse-2026-research-papers/78/SWR-Bench-Assessing-LLM-Performance-in-Real-World-Code-Review-Comment-Generation)

**ContextCRBench (arXiv 2511.07017; November 2025; FSE 2026 Industry track).**

- The set has 67,910 entries from 90 top-starred GitHub repositories. The 9 languages are Python, Java, JavaScript, C, C++, C#, Rust, TypeScript and Go. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- Each entry links 1 line-level review comment to its code change. It adds text context (issue and PR description) and code context (the function or the class). Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- The tasks are hunk-level quality estimation (F1, accuracy, precision), line-level defect localization (pass@1 to pass@10) and comment generation (ROUGE-1, ROUGE-L, edit similarity). Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- The evaluation subset has 1,080 entries. The authors used only data from January 2021 or later, to decrease the overlap with pre-training data. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- The paper is not consistent about the crawl size. The introduction gives "over 2.7 million issues and PRs", but the method section gives 153.7k. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- FSE 2026 lists the paper in the Industry track. Source: [FSE 2026 listing](https://conf.researchr.org/details/fse-2026/fse-2026-industry-papers/33/Benchmarking-LLMs-for-Fine-Grained-Code-Review-with-Enriched-Context-in-Practice)

**CodeReviewQA (arXiv 2503.16167; v2 31 May 2025; University of Melbourne and Singapore Management University).**

- The set has 900 manually curated examples, 100 for each of 9 languages: C, C++, C#, Go, Java, JavaScript, PHP, Python and Ruby. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- The examples come from CodeReview-New (Guo et al., 2024; 9,367 examples). Only 13% of the source examples passed the quality checks. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- The set divides code refinement into 3 multiple-choice probes: change type recognition, change localisation and solution identification. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- The authors tested 72 open LLMs with 3B to 72B parameters. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)

**CRQBench (arXiv 2408.08453; August 2024; Google and Bryn Mawr College).**

- The set has 100 C++ code reasoning questions with answers. The questions come from code review comments. Source: [CRQBench](https://arxiv.org/html/2408.08453v1)
- GPT-4 gave correct, context-grounded answers for 65 of the 100 questions. Source: [CRQBench](https://arxiv.org/html/2408.08453v1)
- Unconfirmed: about 65% of GitHub comments and 80% of Google comments are not code reasoning questions. Source: search summary of [CRQBench](https://arxiv.org/html/2408.08453v1)
- Unconfirmed: the sources do not agree on the mix of question types. 1 summary gives 54 VALUE and 46 EQUIV questions. Another statement says that about 75% are EQUIV. Source: search summaries of [CRQBench](https://arxiv.org/html/2408.08453v1) and [AlphaXiv page](https://alphaxiv.org/benchmarks/google-deepmind/crqbench)

**CodeFuse-CR-Bench (Ant Group; arXiv 2509.14856; v3 23 October 2025).**

- The set has 601 instances from 70 Python projects in 9 PR problem domains. The instances date from 6 November 2016 to 7 July 2025. Source: [CodeFuse-CR-Bench v3](https://arxiv.org/html/2509.14856v3)
- Each instance has repository-level context: PR and issue details, commit history and the full patch. Source: [Hugging Face paper page](https://huggingface.co/papers/2509.14856)
- The metrics are a reward model (Qwen3-8B), an LLM judge (OpenAI o3), location similarity, BLEU-4, and precision, recall and F1 of defect matches. Source: [CodeFuse-CR-Bench v3](https://arxiv.org/html/2509.14856v3)
- Unconfirmed: the code and the data use the name SWE-CARE. Source: search summary of [Hugging Face paper page](https://huggingface.co/papers/2509.14856)

**AACR-Bench (arXiv 2601.19494; v3 30 January 2026; Nanjing University and Alibaba).**

- The set has 200 PRs and 1,505 review comments from 50 repositories. Each of 10 languages has 5 repositories: JavaScript, Python, TypeScript, Java, C#, C++, C, PHP, Go and Rust. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- 391 comments come from the original PR reviews. LLMs and human experts added 1,114 comments. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- 80 senior engineers annotated the comments, with at least 2 annotators for each comment. The paper reports "a 285% increase in issue coverage". Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- Each comment has a label for the context that it needs: the diff, the file or the repository. The judge is Qwen3-235B-A22B-Instruct-2507. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)

**Pull Requests with Bugs (NeurIPS 2025).**

- The set has 60 code review questions from real GitHub code. It isolates multi-hop reasoning. I read only the abstract. Source: [NeurIPS 2025 page](https://neurips.cc/virtual/2025/126737)

**CR-Bench (arXiv 2603.11078; 10 March 2026).**

- The paper gives a dataset and an evaluation pipeline (CR-Evaluator) for review agents. The authors call it a preliminary study. The abstract gives no numbers. Source: [CR-Bench](https://arxiv.org/abs/2603.11078)

#### Third-party benchmark: Martian Code Review Bench

**Martian Code Review Bench (released about late February 2026; MIT license).**

- The README says that the goal is that a company does not "grade its own homework". Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- Martian says that it does not train models and does not sell coding tools. Source: [Greptile page about Martian (vendor page)](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark)
- The offline part has 50 PRs from 5 projects: Sentry (Python), Grafana (Go), Cal.com (TypeScript), Discourse (Ruby) and Keycloak (Java). Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- The offline gold set has 173 human-verified comments. Each comment has a severity (Low to Critical) and a category, for example bug, security, concurrency or style. Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- Offline precision is the number of tool comments that match a golden comment, divided by all tool comments. Offline recall is the number of golden comments found, divided by all golden comments. Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- The judges are Claude Opus 4.5, GPT-5.2 and Claude Sonnet 4.5. The README says that the top 5 tools are the same with all 3 judges. Most tools move 2 rank positions or less. Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- The online part finds merged public PRs that a bot reviewed. LLM steps extract the bot suggestions and the human fixes after the review, and then match them. Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- Online precision is the number of suggestions that match real fixes, divided by all suggestions. Online recall is the number of real fixes that the bot caught, divided by all fixes. Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- A tool needs about 600 to 1,000 reviewed public PRs for the leaderboard. Scores use F-beta with beta from 0.5 to 3.0, and category profiles (Strict, Core, All). Source: [Martian README](https://github.com/withmartian/code-review-benchmark)
- A Kilo Code post of 5 March 2026 says that Martian released the benchmark "last week". The post says that the benchmark tracks over 200,000 real PRs. Kilo Code sells a review tool. Source: [Kilo blog](https://blog.kilo.ai/p/martians-independent-benchmark-tested)

#### Vendor-run benchmarks

**GitHub ReviewBench (GitHub and Microsoft; 5 October 2026).** GitHub sells Copilot code review, and the benchmark scores it.

- The set has 219 public PRs from 187 open-source repositories in 19 languages. GitHub analyzed 103.9 million PRs to match the real distribution. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- Candidate findings come from human reviewers, author follow-up commits, deterministic tools and several frontier LLMs. A true positive must be "true, relevant, and non-trivial". Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- Senior engineers re-labeled all ground-truth findings and agreed with ReviewBench 96.6% of the time. The judge is Claude Sonnet 5. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- "Grounded" precision, recall and F1 use only the gold-set labels. "Augmented" metrics also let the judge assess findings that are not in the gold set. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- RuntimeWire reports that Copilot code review supplied 1,185 of the 2,623 true-positive findings, about 45%. It also reports that the 96.6% check covered only 1,500 findings that already had a true-positive label. Source: [RuntimeWire, 9 October 2026](https://runtimewire.com/article/github-launches-reviewbench-an-open-benchmark-for-ai-code-re-4528d7)

**Other vendor-run benchmarks of bug detection in PRs.**

| Vendor | Date | Data set | What counts as a hit | Headline result | Source |
|---|---|---|---|---|---|
| Greptile | July 2025 | 50 real bug-fix PRs from Sentry, Cal.com, Grafana, Keycloak and Discourse. Each bug went back into a new PR on a clean fork. | A line-level comment that points to the faulty code and explains the impact. False positives do not change the score. | Catch rate: Greptile 82%, Cursor Bugbot 58%, Copilot 54%, CodeRabbit 44%, Graphite 6% | [Greptile](https://www.greptile.com/benchmarks) |
| Augment | 11 December 2025, updated 18 June 2026 | The same 5 repositories and 50 PRs. Augment "expanded and corrected" the golden comments. | A match to a golden comment | F-score: Augment 59% | [Augment](https://www.augmentcode.com/blog/we-benchmarked-7-ai-code-review-tools-on-real-world-prs-here-are-the-results) |
| Qodo | 4 February 2026 | 100 merged PRs with 580 issues that an LLM injected. 7 languages: TypeScript, Python, JavaScript, C, C#, Rust, Swift. | An LLM judge. A hit must describe the issue and give the correct file and line. | F1: Qodo 60.1% | [Qodo](https://qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review) |
| Macroscope | 2025, month unconfirmed | 118 bugs in 45 repositories, 8 languages | Detection of known bugs | Macroscope 48% | [DeepSource summary](https://deepsource.com/blog/ai-code-review-benchmarks) |
| Propel | Not given | The Augment data set | F1 | Propel 64% | [DeepSource summary](https://deepsource.com/blog/ai-code-review-benchmarks) |
| Entelligence | Not given | 67 bugs in the 5 Greptile repositories, 8 tools. A majority vote of 3 LLMs and an in-house review made the ground truth. | F1 | Entelligence 47.2% | [DeepSource summary](https://deepsource.com/blog/ai-code-review-benchmarks) |
| DeepSource | 2026 | 165 real CVEs from the OpenSSF data set. Security only. The judge, Claude Opus 4.5, does not see tool names. | Not given in the part that I read | "82% accuracy" in the page metadata | [DeepSource](https://deepsource.com/blog/ai-code-review-benchmarks) |

- Unconfirmed: a later Qodo data set has 125 PRs with 703 known bugs. Qodo traces bugs that were fixed later back to the PR that caused them. Source: search summary of [Qodo 3.0 page](https://www.qodo.ai/?p=22396)
- Unconfirmed: AIMultiple, an analyst site, reports that CodeRabbit was the most successful tool in 51% of 309 PRs. Source: search summary of [AIMultiple](https://aimultiple.com/ai-code-review-tools)

### Inferences

- The Martian offline set, the Augment set and the Entelligence set use the same 5 repositories as the Greptile set. Thus they probably come from 1 public data set. Augment links an "original public dataset" in the GitHub organization "ai-code-review-evaluation". No source that I read says directly that the sets have the same origin.
- The academic work moved from text similarity against 1 human comment (2022) to issue-level precision and recall with LLM judges (2025 to 2026).
- Each benchmark uses a different ground truth, a different judge and a different metric. Thus numbers from 2 benchmarks are not comparable.

### Gaps

- I did not find a benchmark with the name "c-CRAB".
- I did not find a review benchmark that reuses SWE-bench tasks directly, for example a review of agent patches for SWE-bench issues. SWR-Bench uses only the SWE-Bench repositories.
- I could not read the live leaderboards of Martian (codereview.withmartian.com) and ReviewBench (review-bench.ai). The pages load their data with JavaScript.
- The per-tool numbers of the Qodo benchmark of February 2026 are only in a chart image.

## 2. What precision and recall do the best LLM reviewers reach on real bugs, and how does this change with the model, the agent scaffold and the context?

### Takeaway

On academic sets with real PR ground truth, the best F1 is low: about 19% to 24% on SWR-Bench and about 16% on AACR-Bench. Low precision is the main limit there. A vendor page reports the Martian online score of 30 July 2026. There, the top 5 tools have F1 57.5% to 60.8%. Their precision is 64.9% to 76.2%, and their recall is 48.6% to 51.6%. The scaffold changes the result more than the model: agent loops increase precision and decrease recall, and many runs plus aggregation increase recall.

### Cited Findings

#### SWR-Bench: effect of the scaffold (Table 4; overall scores in %; mean over the tested LLMs)

| Scaffold | Precision | Recall | F1 | False positives per PR |
|---|---|---|---|---|
| PR-Review (PR level, careful prompt design) | 15.39 | 24.06 | 18.73 | 1.26 |
| SWR-Agent (agent in the style of SWE-agent) | 9.11 | 20.93 | 12.61 | 1.98 |
| LLM-Review | 9.22 | 20.39 | 12.49 | 1.90 |
| CR-Agent | 6.23 | 18.10 | 9.22 | 2.58 |
| Hybrid-Review | 2.79 | 20.04 | 4.87 | 6.18 |
| Llama-Reviewer (fine-tuned Llama-7B) | 4.28 | 23.08 | 7.22 | 4.70 |
| Code-Reviewer (fine-tuned CodeT5) | 4.19 | 11.35 | 6.13 | 2.44 |

Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)

- The best single result in Table 4 is PR-Review with Gemini-2.5-Pro: precision 16.65%, recall 23.18%, F1 19.38%. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- On functional changes only, PR-Review has a mean precision of 16.55%, a recall of 43.89% and an F1 of 23.87%. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- The tested LLMs in Table 4 are Gemini-2.5-Pro, Claude-3.7-Sonnet and DeepSeek-R1. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)

#### SWR-Bench: effect of the model in the PR-Review scaffold (Table 8; overall scores in %)

| Model | Precision | Recall | F1 |
|---|---|---|---|
| GPT-5 | 14.69 | 35.93 | 20.85 |
| Gemini-2.5-Pro | 16.65 | 23.18 | 19.38 |
| GPT-4o | 14.13 | 27.78 | 18.73 |
| DeepSeek-R1 | 14.61 | 25.50 | 18.58 |
| Claude-3.7-Sonnet | 14.90 | 23.50 | 18.23 |
| GPT-o3 | 14.05 | 25.58 | 18.13 |
| DeepSeek-V3 | 15.49 | 20.17 | 17.52 |
| Claude-4-Opus | 14.94 | 19.68 | 16.99 |
| Claude-4-Sonnet | 13.84 | 20.76 | 16.61 |
| Qwen-2.5-R1-14B | 13.21 | 20.13 | 15.95 |
| Gemini-2.5-Flash | 16.88 | 13.91 | 15.25 |
| Qwen-2.5-R1-32B | 11.69 | 20.86 | 14.98 |
| Qwen-2.5-32B | 11.43 | 17.28 | 13.76 |
| Qwen-2.5-7B | 8.87 | 16.86 | 11.63 |
| Qwen-2.5-14B | 8.67 | 9.38 | 9.01 |
| Qwen-2.5-R1-7B | 6.83 | 8.33 | 7.51 |

Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)

- On functional changes, GPT-5 has a recall of 65.03% and an F1 of 24.20%. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)

#### SWR-Bench: many runs plus aggregation

- With Gemini-2.5-Flash, 10 runs plus an LLM aggregation step increased F1 from 15.25% to 21.91%, which is +43.67%. Recall increased to 30.44%, which is +118.83%. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- The best aggregated result is Gemini-2.5-Pro with 5 runs: F1 23.84%, which is +23.01% over 1 run. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- Gemini-2.5-Flash with 5 runs got F1 20.48% at $3.68E-03 per PR. 1 run of Gemini-2.5-Pro got F1 19.38% at $5.86E-03 per PR. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- The gain becomes smaller after 5 runs, but the cost increases linearly. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)

#### SWR-Bench: what limits the score

- Recall drops from 38.35% for PRs with 1 change-action to 8.88% for PRs with 5 or more change-actions. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- The authors examined 100 of 1,101 functional false positives of PR-Review with Gemini-2.5-Pro. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- Of these, 48% came from a lack of context comprehension, 17% from oversensitivity to a modification, 16% were vague, and 13% needed domain knowledge. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- The results are not stable. Only 27 change-actions overlapped across 5 runs of the same LLM, and only 36 across different LLMs. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)

#### AACR-Bench: agent compared with prompts and retrieval (Table 3; scores in %)

| Model | Method | Precision | Recall | F1 |
|---|---|---|---|---|
| Claude-4.5-Sonnet | Diff only | 8.70 | 42.86 | 14.46 |
| Claude-4.5-Sonnet | BM25 retrieval, top 3 | 5.80 | 35.75 | 9.98 |
| Claude-4.5-Sonnet | Embedding retrieval, top 3 | 8.00 | 42.86 | 13.48 |
| Claude-4.5-Sonnet | Agent (Claude Code) | 39.90 | 10.10 | 16.12 |
| GPT-5.2 | Diff only | 7.00 | 47.11 | 12.19 |
| GPT-5.2 | Agent (Claude Code) | 9.90 | 2.99 | 4.59 |
| GLM-4.7 | Diff only | 11.30 | 27.57 | 16.03 |
| GLM-4.7 | Agent (Claude Code) | 11.50 | 4.72 | 6.69 |
| DeepSeek-V3.2 | Diff only | 5.60 | 36.54 | 9.71 |
| DeepSeek-V3.2 | BM25 retrieval, top 3 | 10.90 | 27.38 | 15.59 |
| DeepSeek-V3.2 | Agent (Claude Code) | 11.00 | 4.78 | 6.67 |
| Qwen-480B-Coder | Diff only | 9.40 | 27.44 | 14.00 |
| Qwen-480B-Coder | Agent (Claude Code) | 15.30 | 4.39 | 6.82 |

Source: [AACR-Bench](https://arxiv.org/html/2601.19494)

- For the methods without an agent, recall decreases when the issue needs more context. The diff-only recall of Claude-4.5-Sonnet is 45.76% for diff-level issues, 40.54% for file-level issues and 38.63% for repository-level issues. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- The agent shows the opposite trend. The agent recall of Claude-4.5-Sonnet is 11.95%, 16.84% and 13.77% for the same 3 levels. The agent recall of DeepSeek-V3.2 goes from 4.28% (diff) to 8.00% (repository). Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- Unconfirmed: retrieved context decreased the scores for most languages. C, Go and Java were the exceptions. Source: search summary of [AACR-Bench](https://arxiv.org/html/2601.19494)

#### ContextCRBench: text context compared with code context

- In hunk-level quality estimation, the mean F1 of the closed-source models is 36.08 with the diff only. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- The F1 goes to 57.66 with the issue description, 62.12 with the PR description, 51.76 with the code before and after the change, and 64.74 with text and code together. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- For open-source models, the F1 goes from 40.55 (diff only) to 53.86 (issue and PR text) and to 49.84 (code). Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- In defect localization, issue context increased the mean pass@1 of closed-source models by 14.99%. It decreased the mean pass@1 of open-source models by 1.05%. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- The best diff-only scores are F1 59.54 for quality estimation (Claude 3.5 Sonnet), pass@1 24.81 (Qwen2.5-Coder 7B) and pass@10 67.04 (Claude 3.5 Sonnet). Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- ByteDance used ContextCRBench as a reward signal for a self-evolving review tool. In 100 iterations, the mean score went from 0.2375 to 0.3847, a relative gain of 61.98%. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1)

#### CodeFuse-CR-Bench, CodeReviewQA and Pull Requests with Bugs

- On CodeFuse-CR-Bench, Gemini 2.5 Pro has the best comprehensive score: 52.37 with oracle context. GPT-5 has the best model-based score (64.80). Claude-Sonnet-4 has the best rule-based score (33.31). Source: [CodeFuse-CR-Bench v3](https://arxiv.org/html/2509.14856v3)
- BM25 top-1 retrieval gave Gemini 2.5 Pro a score of 52.24, almost the same as oracle context. DeepSeek-v3.1 got 48.13 with BM25 top-1, but only 42.51 with oracle context. Source: [CodeFuse-CR-Bench v3](https://arxiv.org/html/2509.14856v3)
- The CodeFuse-CR-Bench reward model has 75.03% accuracy and 80.64% F1 for the prediction of human preference. Gemini 2.5 Pro has 51.30% accuracy and 61.36% F1 on the same task. Source: [CodeFuse-CR-Bench v3](https://arxiv.org/html/2509.14856v3)
- On CodeReviewQA, the best exact match for automated code refinement is 50.3% (Llama-3.1-70B-Instruct). Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- On CodeReviewQA, change localisation is the most difficult probe. Qwen2.5-72B-Instruct gets 97.1% on easy solution identification, but 64.2% on easy change localisation. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- In "Pull Requests with Bugs", Claude 3.7 and Claude 4 reasoning models were up to 25% better than non-reasoning Llama models. I read only the abstract. Source: [NeurIPS 2025 page](https://neurips.cc/virtual/2025/126737)

#### Martian Code Review Bench: online score (snapshot of 30 July 2026, as a vendor reports it)

| Rank | Tool | F1 | Precision | Recall |
|---|---|---|---|---|
| 1 | Greptile | 60.8% | 76.2% | 50.6% |
| 2 | ChatGPT Codex Connector | 59.4% | 73.3% | 50.0% |
| 3 | Cubic Dev AI | 58.7% | 72.6% | 49.3% |
| 4 | Devin AI Integration | 58.6% | 73.6% | 48.6% |
| 5 | CodeRabbit | 57.5% | 64.9% | 51.6% |

Source: [Greptile page about Martian (vendor page)](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark)

- The leaderboard changes continuously. Different vendors claim first place at different dates and for different metrics. Source: [Qodo](https://www.qodo.ai/blog/qodo-ranked-1-ai-code-review-tool-in-martians-code-review-benchmark); [CodeRabbit newsroom](https://www.coderabbit.ai/newsroom/coderabbit-tops-ai-code-review-benchmark); [Baz](https://baz.co/resources/baz-1-in-precision-in-independent-code-review-bench)
- Unconfirmed: Qodo reports F1 64.3% and first place. Source: search summary of [Qodo](https://www.qodo.ai/blog/qodo-ranked-1-ai-code-review-tool-in-martians-code-review-benchmark)
- Unconfirmed: CodeRabbit reports first place in online F1, from developer behavior across nearly 300,000 PRs. Source: search summary of [CodeRabbit blog](https://www.coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark)
- Unconfirmed: on 6 October 2026, Cubic led the online leaderboard with F1 64.9%. Source: search summary of [The New Stack](https://thenewstack.io/?p=22839357)
- Unconfirmed: in October 2026, Copilot was fourth online and fifth offline on Martian. Source: search summary of [DevX](https://www.devx.com/coding/what-is-reviewbench-ai-code-review-benchmark/)
- Unconfirmed: CodeAnt reports offline precision 52.2% and recall 51.1%. A blog reports offline recall 62.8% and precision 47.0% for Augment. Source: search summaries of [CodeAnt](https://codeant.ai/blogs/ai-code-review-benchmark-results-from-200-000-real-pull-requests) and [Substack](https://shmulc.substack.com/p/stop-vibe-merging)

#### Vendor-run curated sets

Augment benchmark (vendor-run; table values):

| Tool | Precision | Recall | F-score |
|---|---|---|---|
| Augment Code Review | 65% | 55% | 59% |
| Cursor Bugbot | 60% | 41% | 49% |
| Greptile | 45% | 45% | 45% |
| Codex Code Review | 68% | 29% | 41% |
| CodeRabbit | 36% | 43% | 39% |
| Claude Code | 23% | 51% | 31% |
| GitHub Copilot | 20% | 34% | 25% |

Source: [Augment](https://www.augmentcode.com/blog/we-benchmarked-7-ai-code-review-tools-on-real-world-prs-here-are-the-results)

- The chart and the table of the Augment post do not agree for some tools. For example, the chart gives Augment a recall of 57%, and the table gives 55%. Source: [Augment](https://www.augmentcode.com/blog/we-benchmarked-7-ai-code-review-tools-on-real-world-prs-here-are-the-results)
- Unconfirmed, vendor-run by Qodo in March 2026: Qodo Extended has precision 79%, recall 71% and F1 74.7%. Qodo Default has 79%, 60% and 68.2%. Claude Code Review has 79%, 52% and 62.7%. Source: search summary of [dev.to post](https://dev.to/nnennandukwe/we-benchmarked-claudes-code-review-tool-heres-what-the-data-shows-35b9)
- Greptile's own catch rate for Greptile is 82%. On the same 5 repositories, Augment's corrected set gives Greptile an F-score of 45%. Source: [Greptile](https://www.greptile.com/benchmarks); [Augment](https://www.augmentcode.com/blog/we-benchmarked-7-ai-code-review-tools-on-real-world-prs-here-are-the-results)
- Greptile's catch rates by severity for Greptile are 58% (Critical), 100% (High), 89% (Medium) and 87% (Low). The page does not give the number of bugs for each severity. Source: [Greptile](https://www.greptile.com/benchmarks)

#### Own-tool reports about the effect of model, scaffold and context

- OpenAI (1 December 2025): a human evaluation compared GPT-5 with only the diff and the default prompt against GPT-5-Codex with repository access and code execution. Source: [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/)
- OpenAI says that repository access gives more critical issues and fewer false alarms. The values are only in figures. Source: [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/)
- OpenAI says that GPT-5.1-Codex improves both recall and precision over GPT-5, but gives the values only in a figure. OpenAI prefers precision over recall, because false positives decrease the trust of engineers. Source: [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/)
- OpenAI measured recall on known issues from its own code base. Recall was higher on human-written code than on code that Codex generated. Source: [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/)
- Sashiko (Linux kernel): the detection rate went from the low 30s (%) to the low 50s (%) in a couple of months. The causes were model upgrades and changes to the review protocol and to the subsystem prompts. Source: [LKML post, 17 March 2026](https://lkml.iu.edu/2603.2/03802.html)
- Kernel developers said that token cost follows the quantity of context, and that the quantity of context correlates with bugs found. They said that extra context does not make the model worse, but instructions can. Source: [LWN, 25 May 2026](https://lwn.net/Articles/1073583/)
- Unconfirmed: Cursor ran 40 major experiments on Bugbot. The resolution rate went from 52% to over 70%, and the bugs flagged per run went from 0.4 to 0.7. Source: search summary of [Cursor blog](https://cursor.com/blog/building-bugbot)
- GitHub (October 2026) ran an internal A/B test of a new version of Copilot code review. Relative to production, it gave +8.0% addressed rate, +13.6% recall, +61% comment volume and -8.0% cost per review. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- Unconfirmed: on ReviewBench, Copilot code review in the "Balanced" configuration is first with a grounded F1 of 40.1%. Source: search summary of [DevX](https://www.devx.com/coding/what-is-reviewbench-ai-code-review-benchmark/)

### Inferences

- Academic F1 values and vendor F1 values are not comparable. Academic ground truth comes from the human review of the PR, which is incomplete. Thus correct AI findings can count as false positives, and precision looks low.
- In SWR-Bench, the scaffold changes the mean F1 from 4.87 to 18.73. The frontier models in 1 scaffold differ less, with F1 from 16.61 to 20.85. Thus the scaffold design is the first lever.
- An agent loop with tools acts as a precision filter. In AACR-Bench, the precision of Claude-4.5-Sonnet went from 8.70% to 39.90%, but its recall went from 42.86% to 10.10%.
- Only Claude-4.5-Sonnet got a higher F1 with the Claude Code agent in AACR-Bench. The other 4 models got a much lower F1. Thus the agent scaffold and the model must fit together.
- Many runs plus aggregation increase recall, and a verification step increases precision. Anthropic uses parallel agents plus a verification step. For Sashiko, Gushchin suggested many runs plus aggregation.
- Text context (issue and PR description) is cheap and gives a large gain. Naive retrieval of code can decrease the score.
- A realistic recall for the best current reviewers on real bugs is about 50%. Sashiko found 53% of escaped kernel bugs, and the Martian online top tools have recall of 48.6% to 51.6%. These metrics differ, so this value is approximate.
- Reasoning models help in some cases: in SWR-Bench, Qwen-2.5-R1-14B has F1 15.95 and Qwen-2.5-14B has 9.01. But a newer frontier model does not always score higher: Claude-4-Opus has F1 16.99 and Claude-3.7-Sonnet has 18.23.

### Gaps

- No benchmark compares 1 model with diff-only, file, repository and agent context on C++ code.
- OpenAI gives the effect of repository access only in figures.
- Anthropic published no benchmark precision or recall for its multi-agent Code Review product. The third-party values for "Claude Code" (Augment: precision 23%, recall 51%) and "Claude Code Review" (Qodo: precision 79%, recall 52%) are vendor-run. In the part that I read, the Augment post does not say which Claude configuration it used.
- I did not find the Martian leaderboard as of November 2026.

## 3. What are the known problems of these benchmarks?

### Takeaway

Text-similarity metrics such as BLEU do not measure usefulness. Human review comments are noisy and incomplete as ground truth, so they make precision look too low. Vendor benchmarks are small, the vendor designs them, and they usually favor the vendor. Measured contamination of code review sets is near 0%, but static sets from public GitHub stay at risk. LLM reviewers are not deterministic, so 1 run is not a reliable measurement.

### Cited Findings

#### Text-similarity metrics

- The CodeReviewer model got BLEU-4 5.32 for comment generation in 2022 (older result). Source: [CodeReviewer paper on ar5iv](https://ar5iv.labs.arxiv.org/html/2203.09095)
- CRScore (NAACL 2025) says that review is a one-to-many task, so a correct review can differ from the reference. CRScore has a Spearman correlation of 0.5431 with human judgment. Source: [CRScore](https://arxiv.org/html/2409.19801v2)
- Unconfirmed: in the CRScore appendix, the Kendall tau of BLEU against human scores is about -0.002 to 0.007 for Python, Java and JavaScript. Source: search summary of [CRScore PDF](https://arxiv.org/pdf/2409.19801)
- In SWR-Bench, BLEU has a negative agreement with human preference: -35 to -41 on the Kappa scale of the paper. An LLM hit judge gets 52.8 to 62.0, and human-human pairs get 56.3 to 62.6. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- In SWR-Bench, the fine-tuned Code-Reviewer has the highest BLEU (10.25) but an F1 of only 6.13. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- DeepCRCEval scores comments on 9 dimensions with human and LLM evaluators. The LLM evaluators decreased the time by 88.78% and the cost by 90.32%. Source: [DeepCRCEval](https://arxiv.org/pdf/2412.18291v2)
- Unconfirmed: DeepCRCEval found that less than 10% of benchmark comments are of high quality and suitable as references. Source: [AlphaXiv summary](https://www.alphaxiv.org/benchmarks/chinese-academy-of-sciences/deepcrceval)
- CodeReviewQA says that text-match metrics measure only surface token similarity, not comprehension. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)

#### Noisy and incomplete ground truth

- "Too Noisy To Learn" (MSR 2025) reports that 32% of the comments in the test set of a widely used review dataset contain noise. Source: [Too Noisy To Learn](https://arxiv.org/abs/2502.02757v2)
- Its LLM classifier found valid comments with 66% to 85% precision. The cleaned training sets were 25% to 66% smaller. Models trained on them made comments that were 12.4% to 13.0% more similar to valid human comments. Source: [Too Noisy To Learn](https://arxiv.org/abs/2502.02757v2)
- CodeReviewQA kept only 13% of the CodeReview-New examples. The authors say that the source data has "critical quality issues". Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- AACR-Bench reports "a 285% increase in issue coverage" after LLMs and experts added comments to the original reviews. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- SWR-Bench annotators agreed with Cohen's Kappa 66.08. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- Unconfirmed: at Atlassian, only 7% of PRs had generated comments that fully agreed with the human comments. But the resolution rate of the tool was 38.70%. Source: search summary of [RovoDev paper](https://arxiv.org/html/2601.01129v1)
- CR-Bench says that agents designed to find all hidden issues can have a low signal-to-noise ratio. It says that resolution rates alone can hide real progress. Source: [CR-Bench](https://arxiv.org/abs/2603.11078)

#### Contamination

- LessLeak-Bench found 0% leakage for CodeReview-py (2.9k samples), CodeReview-java (2.21k), CodeReviewNew-java (1.21k), CodeReview-c (1.8k) and CodeReviewNew-c (1.05k). Source: [LessLeak-Bench](https://arxiv.org/html/2502.06215)
- CodeReviewNew-py (2.15k samples) had 1 leaked sample (0.05%). Source: [LessLeak-Bench](https://arxiv.org/html/2502.06215)
- Across 83 software engineering benchmarks, the mean leakage is 4.8% for Python, 2.8% for Java and 0.7% for C and C++. QuixBugs (100.0%) and BigCloneBench (55.7%) leak most. Source: [LessLeak-Bench](https://arxiv.org/html/2502.06215)
- CodeReviewQA measured perplexity and 5-gram accuracy (NG5). For Llama-3.1-70B, NG5 is 40.3 on CodeReview-New in the refinement form and 25.1 in the multiple-choice form. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- The CodeReviewQA authors say that the multiple-choice form decreases the effect of contamination. They also say that semantic-level contamination stays a risk. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2)
- ContextCRBench uses data from January 2021 or later. Martian uses fresh PRs online for the same reason. Source: [ContextCRBench](https://arxiv.org/html/2511.07017v1); [Greptile page about Martian](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark)
- Unconfirmed: "The SWE-Bench Illusion" reports that model scores drop to as low as 53% on tasks from repositories that are not in SWE-Bench. Source: search summary of [arXiv 2506.12286](https://arxiv.org/html/2506.12286v2)

#### Vendor self-evaluation and small samples

- DeepSource (itself a vendor, 26 February 2026) says that each vendor that published a benchmark wins its own benchmark. Source: [DeepSource](https://deepsource.com/blog/ai-code-review-benchmarks)
- DeepSource says that in 50-PR sets, a few edge cases can change results by 10 points or more. It says that sets with fewer than 100 entries need skepticism. Source: [DeepSource](https://deepsource.com/blog/ai-code-review-benchmarks)
- DeepSource says that vendors report different metrics (recall, F1, detection rate) and often do not state their partial-match rules. It says that Qodo did not publish its ground truth. Source: [DeepSource](https://deepsource.com/blog/ai-code-review-benchmarks)
- The Greptile metric ignores false positives. Source: [Greptile](https://www.greptile.com/benchmarks)
- Unconfirmed: the Greptile catch rate counts a PR as caught if the tool flagged at least 1 real bug. Tenki scored the same comments again for each bug. Source: search summary of [Tenki](https://tenki.cloud/blog/benchmarking-ai-code-reviewers)
- Unconfirmed: the Macroscope run puts CodeRabbit (46%) above Greptile (24%), with Cursor Bugbot at 42% and Graphite Diamond at 18%. The Martian online score puts Greptile above CodeRabbit. Source: search summary of [SoftwareSeni](https://www.softwareseni.com/how-ai-code-review-tools-compare-on-real-bug-detection-and-noise)
- GitHub ReviewBench grades Copilot partly against its own output: Copilot supplied 1,185 of the 2,623 true positives. Source: [RuntimeWire](https://runtimewire.com/article/github-launches-reviewbench-an-open-benchmark-for-ai-code-re-4528d7)
- Unconfirmed: at launch, the Martian offline results did not agree with real-world use, so Martian made the online score the main metric. Source: search summary of [The New Stack](https://thenewstack.io/?p=22839357)

#### Non-determinism and judge dependence

- In SWR-Bench, only 27 change-actions overlapped across 5 runs of the same LLM. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- A kernel developer sent an 18-patch series 7 or 8 times, because Sashiko reported different problems each time. Source: [LWN](https://lwn.net/Articles/1073583/)
- The Sashiko author says that the output is probabilistic. The same input can give different bugs, or no bugs. Source: [LKML post](https://lkml.iu.edu/2603.2/03802.html)
- GitHub tells submitters to run all 219 PRs 3 times. It says that results are comparable only with the same dataset, judge and matcher version. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- Martian keeps the results for each of its 3 judge models. The top 5 tools do not change between the judges. Source: [Martian README](https://github.com/withmartian/code-review-benchmark)

#### Online metrics have their own bias

- Unconfirmed: Qodo says that "acted-on" comments are only a proxy. The online data has no full count of all bugs, so it cannot give a true recall. Source: search summary of [Qodo glossary](https://www.qodo.ai/glossary/what-is-ai-code-review-benchmarks/)
- Unconfirmed: at Beko, the mean PR closure time increased from 5 hours 52 minutes to 8 hours 20 minutes after the review bot was added. Source: search summary of [Automated Code Review In Practice](https://arxiv.org/abs/2412.18531)
- Anthropic does not define how engineers mark a finding "incorrect". Source: [Claude blog](https://claude.com/blog/code-review)

### Inferences

- Do not use BLEU or ROUGE to select a reviewer. Use an issue-level match with a calibrated judge.
- A gold set from human review comments makes precision look too low. Add a human or judge check of unmatched findings, as the "augmented" metrics of ReviewBench do.
- Small vendor sets of 50 PRs can put tools in contradictory orders. Treat each vendor result as a claim, not as a measurement.
- The production action rates in section 4 range from 7.2% to about 80%. Most of the difference comes from the definition of the metric, not from the quality of the tool.

### Gaps

- Apart from Martian, no independent group reproduces vendor numbers. I could not read the live Martian data.
- I found no study that measures contamination of code review sets for closed models.

## 4. How do teams evaluate a review agent in practice?

### Takeaway

Teams use 4 methods. These are escaped bugs that a later commit fixed, seeded bugs, human evaluation of each comment, and action rates in production. The production rates go from 7.2% to about 80%, but each team uses a different definition. A strong evaluation combines offline recall on known bugs, a false-alarm count on clean PRs, and an online action rate with a human baseline.

### Cited Findings

#### Method 1: historical bugs

- Greptile took 10 bug-fix PRs per repository and found the commit that caused each bug. It put each change back into a new PR on a clean fork for each tool. Source: [Greptile](https://www.greptile.com/benchmarks)
- Greptile ran the tools on hosted cloud plans with default settings and no custom rules. Source: [Greptile](https://www.greptile.com/benchmarks)
- Sashiko used 1,000 recent upstream Linux kernel issues with "Fixes:" tags, without a filter. Human reviewers missed all of these bugs. Sashiko found about 53% with Gemini 3.1 Pro. Source: [LKML post, 17 March 2026](https://lkml.iu.edu/2603.2/03802.html)
- The Sashiko author says that better benchmarks are necessary, especially vetted sets of commits to measure false positives. Source: [LKML post](https://lkml.iu.edu/2603.2/03802.html)
- SWR-Bench adds 500 Clean-PRs, which it cleans with SZZ, so that it can measure false alarms. Source: [SWR-Bench v2](https://arxiv.org/html/2509.01494v2)
- OpenAI measured recall on issues that it found earlier in its own code base, and changed the inference budget of the reviewer. Source: [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/)

#### Method 2: seeded bugs

- Qodo let an LLM inject best-practice violations into merged PRs, plus 1 to 3 logic bugs per PR. The bug types are logic errors, edge cases, race conditions, resource leaks and bad error handling. Source: [Qodo](https://qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review)
- Qodo selected PRs with 3 or more files and 50 to 15,000 changed lines. It removed PRs with reverts or with immediate follow-up fix commits. Source: [Qodo](https://qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review)
- Qodo verified each changed PR 2 times. Each fork had an AGENTS.md file with the rules of the repository. Source: [Qodo](https://qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review)
- DeepSource says that synthetic bugs may not match the real distribution of defects. Source: [DeepSource](https://deepsource.com/blog/ai-code-review-benchmarks)

#### Method 3: human evaluation of comments

- Mozilla and Ubisoft tested RevMate (GPT-4o) with 59 reviewers: 28 at Mozilla and 31 at Ubisoft. The reviewers evaluated about 1.6k generated comments during 587 patch reviews. Source: [RevMate paper](https://arxiv.org/html/2411.07091v1); search summary of [RevMate paper](https://arxiv.org/html/2411.07091v1) for the counts of comments and reviews
- Reviewers accepted 8.1% (Mozilla) and 7.2% (Ubisoft) of the comments. With other useful comments, 23.0% and 28.3% got a positive evaluation. Source: [RevMate paper](https://arxiv.org/html/2411.07091v1)
- Reviewers accepted refactoring comments more often than functional comments: 18.2% against 4.8% at Mozilla, and 18.6% against 5.2% at Ubisoft. Source: [RevMate paper](https://arxiv.org/html/2411.07091v1)
- Functional comments were 79.2% (Mozilla) and 84.8% (Ubisoft) of all comments. The median review time was 42.9 seconds per patch. Source: [RevMate paper](https://arxiv.org/html/2411.07091v1)
- RevMate retrieves code and past review comments. An LLM-as-a-judge prompt removes comments that do not address a valid problem. Source: [RevMate paper](https://arxiv.org/html/2411.07091v1)
- Sashiko: an internal report on 1,500 email threads found about 10% false positives and about 85% true positives. The rest were "gray zone" findings, mostly of low value. Source: [LWN, 25 May 2026](https://lwn.net/Articles/1073583/)
- In the same report, critical and high-severity findings were almost 97% accurate. LWN says that these figures come from a spoken presentation with poor audio. Source: [LWN, 25 May 2026](https://lwn.net/Articles/1073583/)
- Unconfirmed: a Sashiko README figure gives 45.2% detection with less than 20% false positives. Source: search summary of [docs.rs page for sashiko](https://docs.rs/crate/sashiko/0.2.5)
- Unconfirmed: ByteDance BitsAI-CR reports 75.0% precision for generated review comments. Source: search summary of [BitsAI-CR](https://arxiv.org/abs/2501.15134)
- OpenAI used a human evaluation of the rate of incorrect comments, the rate of high-impact comments and the number of comments per PR. Source: [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/)
- Unconfirmed: Google AutoCommenter collects developer feedback through buttons in the tool. It had a staged rollout with an A/B test. Source: search summary of [AutoCommenter](https://arxiv.org/abs/2405.13565)

#### Method 4: action rates in production (own-tool reports, unless the row says otherwise)

| Organization and tool | Metric definition | Tool value | Human baseline | Source |
|---|---|---|---|---|
| Beko, bot based on Qodo PR-Agent (ICSE-SEIP 2025; Beko and academic authors) | Comments with the label "resolved" | 73.8% | Not given | [arXiv 2412.18531](https://arxiv.org/abs/2412.18531), from search summary |
| Atlassian RovoDev (ICSE-SEIP 2026; 1 year, more than 1,900 repositories, more than 54,000 comments) | Commented lines change in a later commit | 38.70% | 44.45% | [arXiv 2601.01129](https://arxiv.org/html/2601.01129v1), from search summary |
| ByteDance BitsAI-CR, Go code (FSE 2025) | "Outdated Rate": flagged code changes later | 26.7% | 35% to 46% | [arXiv 2501.15134](https://arxiv.org/abs/2501.15134), from search summary |
| Mozilla and Ubisoft RevMate (2024; research study) | Reviewer accepts the comment | 8.1% and 7.2% | Not given | [arXiv 2411.07091](https://arxiv.org/html/2411.07091v1) |
| OpenAI Codex reviewer (December 2025) | Comment leads to a code change | 52.7% overall; 53% on human PRs; 46% on Codex PRs | Not given | [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/) |
| Anthropic Claude Code Review (March 2026) | Findings that engineers mark incorrect | Less than 1% | Not given | [Claude blog](https://claude.com/blog/code-review) |
| Cursor Bugbot | Bugs resolved at merge, as an AI judges it | 52% (July 2025), then over 70%, then about 80% (May 2026) | Not given | [Cursor blog](https://cursor.com/blog/building-bugbot), unconfirmed |
| Martian online, top 5 tools (30 July 2026; third party, as a vendor reports it) | Suggestions that match a later fix | 64.9% to 76.2% | Not given | [Greptile page about Martian](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark) |

- OpenAI: the reviewer comments on 36% of the PRs that Codex cloud generated. More than 80% of the reactions to comments are positive. In October 2025, the system reviewed more than 100k external PRs per day. Source: [OpenAI Alignment blog](https://alignment.openai.com/scaling-code-verification/)
- Anthropic: before Code Review, 16% of internal PRs got substantive review comments. With Code Review, 54% get them. Source: [Claude blog](https://claude.com/blog/code-review)
- Anthropic: 84% of PRs with more than 1,000 changed lines get findings, with 7.5 issues on average. 31% of PRs with fewer than 50 lines get findings, with 0.5 issues on average. Source: [Claude blog](https://claude.com/blog/code-review)
- Anthropic: a review costs $15 to $25 on average and takes about 20 minutes. Source: [Claude blog](https://claude.com/blog/code-review)
- Unconfirmed: an Anthropic spokesperson defined "incorrect" as a comment that an engineer resolves without a fix. Source: search summary of press coverage, for example [Help Net Security](https://www.helpnetsecurity.com/2026/03/10/anthropic-claude-code-review/)
- Unconfirmed: Atlassian reports 30.8% faster development cycles and 35.6% fewer human-written review comments. Source: search summary of [Atlassian blog](https://www.atlassian.com/blog/artificial-intelligence/developer-productivity-improved-with-rovo-dev)
- Unconfirmed: at Beko, human comments per PR went from 0.31 to 0.28. Source: search summary of [arXiv 2412.18531](https://arxiv.org/abs/2412.18531)
- Unconfirmed: in Ubisoft data, accepted generated comments led to later patch revisions about as often as human comments, 74% against 73% at chunk level. Source: search summary of [RevMate paper](https://arxiv.org/html/2411.07091v1)
- Unconfirmed: a Cursor table gives resolution rates of 78.13% for Bugbot, 63.49% for Greptile and 48.96% for CodeRabbit. PlanetScale reports that authors address about 80% of Bugbot comments before merge. Source: search summaries of [Cursor guide](https://cursor.com/guides/ai-code-review) and [Cursor PlanetScale post](https://cursor.com/blog/planetscale)
- Sashiko: kernel commit messages mention Sashiko 140 times in about 7 weeks. Attribution is not consistent, so the real number is probably higher. Source: [LWN](https://lwn.net/Articles/1073583/)

#### Guidance from benchmark makers and users

- GitHub recommends grounded recall as the main metric to compare systems, and augmented metrics only as a diagnostic for 1 system. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- GitHub recommends results by severity and by category, and an F-beta weight that agrees with the preference of the team for coverage or for low noise. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- GitHub calls online experiments "the ultimate measure of user impact". ReviewBench predicted +227% critical comments, and the online test showed +262%. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- The GitHub workflow is to run the 25-PR test set first, and then to run all 219 PRs 3 times. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/)
- Kernel maintainers asked for local runs, a channel for direct feedback, annotations for known deferred issues and an explanation of severity. Gushchin suggested that users ignore low-severity reports. Source: [LWN](https://lwn.net/Articles/1073583/)
- DeepSource recommends that the judge must not know which tool made which output. Source: [DeepSource](https://deepsource.com/blog/ai-code-review-benchmarks)

### Inferences

A team can measure its own review skill with this procedure. It combines the methods above:

1. Find bug-fix commits in the history of the team. Use links such as "Fixes:" tags or tracker IDs.
2. Find the commit that caused each bug. Put that change into a new PR on a clean branch, as Greptile and Sashiko did.
3. Add clean PRs that later history does not connect to bugs, as SWR-Bench did with SZZ. Count the false alarms per PR on them.
4. Add seeded bugs only for rare classes, for example race conditions and resource leaks. Do not use seeded bugs alone.
5. Count a hit only for a line-level comment that names the defect and its impact.
6. Let a human or a calibrated LLM judge examine the unmatched findings. Report grounded precision and augmented precision.
7. Run each configuration at least 3 times. Report the mean and the spread.
8. Report recall by severity. Select an F-beta weight before the test.
9. Record the cost and the time for each PR.
10. In production, measure the resolution rate of the tool and of human comments with the same definition, as Atlassian did.

- Use 100 or more cases for each configuration. This value comes from the DeepSource remark about 50-PR sets. It is an inference, not a measured value.

### Gaps

- I found no public, validated evaluation protocol for a small team. The GitHub guidance is the most complete, but GitHub is a vendor.
- I found no study that measures how many cases a team needs for a stable rank order of reviewers.

## 5. Are there results for C or C++ code specifically?

### Takeaway

There are few results. The best C data is Sashiko on the Linux kernel. It found 53% of 1,000 bugs that escaped human review. A later internal report gave about 10% false positives. Academic sets that contain C and C++ mostly give pooled numbers, and AACR-Bench gives a C F1 of 0.085 to 0.189. Most vendor benchmarks contain no C or C++ code.

### Cited Findings

#### Linux kernel (C): Sashiko

- Sashiko found about 53% of the bugs in 1,000 recent upstream issues with "Fixes:" tags. Human reviewers missed all of these bugs. The model was Gemini 3.1 Pro. Source: [LKML post, 17 March 2026](https://lkml.iu.edu/2603.2/03802.html)
- Roman Gushchin wrote the post. Sashiko is written in Rust, mostly with Gemini CLI. It uses open-source prompts from Chris Mason, but with a different protocol. Source: [LKML post](https://lkml.iu.edu/2603.2/03802.html)
- The author tested mostly with Gemini Pro and Flash, and only a little with Claude. Google supplied the compute. Source: [LKML post](https://lkml.iu.edu/2603.2/03802.html)
- The author says that some bugs, for example difficult build failures and performance problems, are very hard to see from code alone. Thus 100% detection is probably not possible. Source: [LKML post](https://lkml.iu.edu/2603.2/03802.html)
- A later internal report on 1,500 email threads gave about 10% false positives and about 85% true positives. Critical and high-severity findings were almost 97% accurate. Source: [LWN, 25 May 2026](https://lwn.net/Articles/1073583/)
- Sashiko reviews the linux-kernel list and 47 or 48 other lists that opted in. Source: [LWN](https://lwn.net/Articles/1073583/)
- A maintainer found 1 valid bug and 1 bad finding. The bad finding came because the hardware specification was not in the context. Source: [LWN](https://lwn.net/Articles/1073583/)
- Chris Mason said that most bugs that LLMs find are not security bugs. Source: [LWN](https://lwn.net/Articles/1073583/)

#### AACR-Bench: C results

- On C, GPT-5.2 diff-only has F1 0.085, and Qwen-480B-Coder diff-only has F1 0.104. The Claude-4.5-Sonnet agent has F1 0.189, from 0.106 without the agent. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- For comparison, the Claude-4.5-Sonnet agent has F1 0.247 on Python, 0.241 on Java, 0.218 on Go and 0.081 on TypeScript. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)
- I did not find C++ values in the part of the paper that I read. Source: [AACR-Bench](https://arxiv.org/html/2601.19494)

#### Security code review on Qt (C++)

- Yu et al. (arXiv 2401.16310, v5) used 534 files: 258 Python files from OpenStack Nova and Neutron, and 276 C and C++ files from Qt Base and Qt Creator. Source: [arXiv 2401.16310v5](https://arxiv.org/html/2401.16310v5)
- The metrics are not precision and recall. I-Score is the share of responses that experts rated "Instrumental". IH-Score adds "Helpful" responses. M-Score is the share of "Misleading" responses, so lower is better. Source: [arXiv 2401.16310v5](https://arxiv.org/html/2401.16310v5)
- On C and C++, DeepSeek-R1 with a chain-of-thought guardrail prompt got I 12.89%, IH 15.49% and M 27.39%. GPT-4 got I 5.40%, IH 11.74% and M 39.00%. Source: [arXiv 2401.16310v5](https://arxiv.org/html/2401.16310v5)
- On C and C++, CppCheck got I 0.00%, IH 0.72% and M 98.19%. Semgrep got I 0.00% and IH 0.36%. Source: [arXiv 2401.16310v5](https://arxiv.org/html/2401.16310v5)
- On Python, the best result was DeepSeek-R1 with I 7.26%, IH 9.26% and M 30.77%. Source: [arXiv 2401.16310v5](https://arxiv.org/html/2401.16310v5)

#### CRQBench (C++)

- The set has 100 C++ code reasoning questions from review comments. GPT-4 answered 65 of the 100 correctly. Source: [CRQBench](https://arxiv.org/html/2408.08453v1)

#### Other C and C++ data

- The CodeReviewer data contains C++ (133 projects, 999k PRs) and C (77 projects, 441k PRs). I did not find per-language results in the part that I read. Source: [CodeReviewer paper on ar5iv](https://ar5iv.labs.arxiv.org/html/2203.09095)
- CodeReviewQA has 100 C examples and 100 C++ examples. ContextCRBench contains C and C++. I did not read per-language results for them. Source: [CodeReviewQA v2](https://arxiv.org/html/2503.16167v2); [ContextCRBench](https://arxiv.org/html/2511.07017v1)
- LessLeak-Bench found 0% leakage for CodeReview-c (1.8k samples) and CodeReviewNew-c (1.05k samples). Source: [LessLeak-Bench](https://arxiv.org/html/2502.06215)
- The Qodo benchmark contains C, but the post gives no per-language numbers. Source: [Qodo](https://qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review)
- The RevMate paper says that the projects at Mozilla and Ubisoft use languages such as C++ and C#. It gives no per-language results. Source: [RevMate paper](https://arxiv.org/html/2411.07091v1)
- The Greptile, Augment and Martian offline sets contain only Python, TypeScript, Go, Java and Ruby. Source: [Greptile](https://www.greptile.com/benchmarks); [Martian README](https://github.com/withmartian/code-review-benchmark)
- Unconfirmed, not a review task: on PrimeVul paired C and C++ functions (2024), GPT-4 got pair-wise correct scores of 5.14 (two-shot) and 12.94 (chain of thought). A random guess got 22.70. Source: search summary of [PrimeVul paper](https://arxiv.org/pdf/2403.18624)
- Unconfirmed, and in conflict with the PrimeVul result: the TREAT paper reports a pair-wise correct score of 90.8% for GPT-4.1 on PrimeVul-Paired. The setup is not clear. Source: search summary of [TREAT](https://arxiv.org/pdf/2510.17163)

### Inferences

- The "Fixes:" method of Sashiko is the most direct model for a C++ team. It needs commit messages that link each fix to the commit that caused the bug.
- In AACR-Bench, C looks harder than Python and Java for the agent: F1 0.189 against 0.247 and 0.241. The sample has only 5 repositories per language, so this is a weak signal.
- In the Qt study, the C and C++ static analyzers found almost no review-level security defects, but the LLMs found some. Thus LLM review and static analysis find different issues.
- Results on Python, TypeScript, Go, Java and Ruby sets may not transfer to C++. Thus a C++ team must measure on its own code.

### Gaps

- I found no per-language precision and recall for frontier LLM reviewers on C++ PRs.
- I found no vendor benchmark with C++ repositories.
- The Sashiko false-positive rate comes from a spoken internal report, not from a published dataset.
- I did not check the C and C++ results of ContextCRBench, CodeReviewQA and GitHub ReviewBench.
