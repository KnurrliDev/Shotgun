# Production AI code review systems: architecture, filters and published quality data

These notes are for the designer of an AI code reviewer. For each system, the notes give the architecture, the context, the steps that filter and rank findings, the limits on comments, the severity levels and the published metrics.

Labels in the notes:

- [Vendor]: a claim from the vendor of the product. No other party checked it.
- [Vendor docs]: the current product documentation of the vendor.
- [Primary repo]: text that I read in the public source repository.
- [Vendor-run benchmark]: a benchmark that a vendor designed and ran. That vendor sells a competing tool.
- [Independent]: a study or a benchmark from a party that does not sell the tool under test.
- [Secondary]: a summary from a third party. I did not read the primary source.
- [Search snippet]: the data comes from the summary of a search engine. I did not open the page.
- [Unconfirmed]: I could not confirm the statement.
- [Inference]: my conclusion from the cited data.

I read all pages on 2026-11-17. A date in a label is the publication date of the source. "Current" means that the page has no date.

Terms in the notes:

- PR: pull request.
- Finding: an issue that a reviewer reports.
- Precision: the percentage of findings that are real issues.
- Recall: the percentage of real issues that the reviewer finds.
- F1: the harmonic mean of precision and recall.
- LLM: large language model.
- CI: continuous integration.

Each vendor uses a different name for its main outcome metric, for example "resolution rate", "address rate", "action rate" or "acceptance rate". The definitions and the PR populations are different. Do not compare these numbers directly.

## 1. Anthropic: what do /code-review, Claude Code Review and the open-source code-review plugin do, and what numbers did Anthropic publish?

### Takeaway

The managed Code Review product, ultrareview and the open-source plugin use 1 pattern: parallel finder agents, a separate verification step, removal of duplicate findings and a rank by severity. Anthropic published only internal numbers: PRs with substantive review comments went from 16% to 54%, and engineers marked less than 1% of findings as incorrect.

### Cited Findings

#### 1.1 Claude Code Review, the managed GitHub product

- [Vendor, 2026-03-09] Anthropic released Code Review as a research preview for the Team and Enterprise plans. When a PR opens, Code Review sends a team of agents. The agents look for bugs in parallel, verify the bugs to remove false positives, and rank the bugs by severity. The depth changes with the PR. A large or complex change gets more agents and a deeper read. A trivial change gets a light pass. Source: [Anthropic blog, "Code Review for Claude Code"](https://claude.com/blog/code-review)
- [Vendor, 2026-03-09] The output is 1 overview comment that ranks the findings, plus inline comments on specific bugs. Code Review does not approve PRs. Source: [Anthropic blog, "Code Review for Claude Code"](https://claude.com/blog/code-review)
- [Vendor, 2026-03-09] In Anthropic tests, a review took about 20 minutes on average. The cost comes from token use and is $15 to $25 for an average review. The cost increases with the size and complexity of the PR. Admins get a monthly cap for the organization, an enable switch for each repository, and a dashboard with PRs reviewed, acceptance rate and total cost. Source: [Anthropic blog, "Code Review for Claude Code"](https://claude.com/blog/code-review)
- [Vendor, internal data of Anthropic, 2026-03-09] Published numbers:
  - PRs with substantive review comments: 16% before Code Review, 54% after.
  - PRs with more than 1,000 changed lines: 84% get findings, with an average of 7.5 issues.
  - PRs with less than 50 changed lines: 31% get findings, with an average of 0.5 issues.
  - Engineers marked less than 1% of the findings as incorrect.
  - Code output for each engineer increased by 200% in the last year.
  Source: [Anthropic blog, "Code Review for Claude Code"](https://claude.com/blog/code-review)
- [Vendor, 2026-03-09] Examples of caught bugs. Code Review flagged a 1-line change to a production service as critical, because the change would break authentication for the service. At TrueNAS, in a ZFS encryption refactor, it found a pre-existing type mismatch. The mismatch silently wiped the encryption key cache on each sync. Source: [Anthropic blog, "Code Review for Claude Code"](https://claude.com/blog/code-review)
- [Vendor, 2026-10-15] Code Review became generally available for Team and Enterprise. Most reviews are about 3 times faster: from about 20 minutes to 6 to 10 minutes. An Owner sets 1 of 3 review levels for each repository: Quick, Standard or Deep. Standard is the default. Teams in the preview asked for reviews that are "quieter, sized to each change, and faster". The post gives no quality metrics. Source: [Anthropic, "Code Review is now generally available"](https://claude.com/blog/code-review-is-now-generally-available)
- [Vendor docs, current] A review has 4 stages:
  1. Find: several agents examine the diff and the surrounding code in parallel.
  2. Verify: a verification step checks the candidate findings against the code and removes false positives.
  3. Rank: the system removes duplicate findings and ranks the findings that remain by severity.
  4. Post: the review posts its results on the PR.
  Source: [Claude Code docs, "Code Review"](https://code.claude.com/docs/en/code-review)
- [Vendor docs, current] By default, the review looks for correctness issues. The docs say: "bugs that would break production, not formatting preferences or missing test coverage". The review reads the diff and the surrounding code. It does not build or run the code. It has read-only access to the repository. Anthropic selects the models, and the admin cannot select a model. Source: [Claude Code docs, "Code Review"](https://code.claude.com/docs/en/code-review)
- [Vendor docs, current] Each review posts inline comments, a summary in the review body and a check run with the name "Claude Code Review". The check run never concludes as a failure, so a review never blocks a merge. Reviews run once after the PR opens, after each push, or only on request, as set for each repository. A user with write access can comment `@claude review`. Automatic reviews skip draft PRs and PRs from forks. Source: [Claude Code docs, "Code Review"](https://code.claude.com/docs/en/code-review)
- [Vendor docs, current] Severity levels:

  | Marker | Severity | Meaning, quoted from the docs |
  |---|---|---|
  | 🔴 | Important | "A bug that should be fixed before merging" |
  | 🟡 | Nit | "A minor issue, worth fixing but not blocking" |
  | 🟣 | Pre-existing | "A bug that exists in the codebase but wasn't introduced by this PR" |

  Source: [Claude Code docs, "Read and request reviews on a pull request"](https://code.claude.com/docs/en/code-review-pull-requests)
- [Vendor docs, current] A finding can have a collapsed section "Why this was flagged". The section gives the reason for the finding and how Claude verified the problem. The details of the check run give 1 table of all findings, sorted by severity. The last line is a machine-readable comment with counts, for example `<!-- bughunter-severity: {"nit":1,"normal":2,"pre_existing":0} -->`. The key `normal` holds the count of Important findings. Source: [Claude Code docs, "Read and request reviews on a pull request"](https://code.claude.com/docs/en/code-review-pull-requests)
- [Vendor docs, current] Re-review rules. A later automatic review focuses on the changes since the last review, and it posts fewer nits and fewer pre-existing findings. The review body counts the findings that the review found but did not post. If a push keeps the same added and removed lines, for example after a clean rebase, Code Review can keep the earlier result. The next review reads the replies to earlier findings, and it can resolve the thread or post 1 follow-up reply. It resolves its own earlier threads when it judges an issue fixed. Source: [Claude Code docs, "Read and request reviews on a pull request"](https://code.claude.com/docs/en/code-review-pull-requests)
- [Vendor docs, current] Before a July 2026 update, the comment `@claude review` subscribed the PR to a review on each push. Now only `@claude review always` does this. Source: [Claude Code docs, "Read and request reviews on a pull request"](https://code.claude.com/docs/en/code-review-pull-requests)
- [Vendor docs, current] Context and rules. The review reads the root CLAUDE.md and the CLAUDE.md files in the parent folders of each changed file. A change that violates a CLAUDE.md rule becomes a finding. REVIEW.md holds rules for reviews only. The finder agents and the verifier agents receive REVIEW.md. The step that writes the final review reads REVIEW.md before it sets the severity and writes the summary. Source: [Claude Code docs, "Customize Code Review"](https://code.claude.com/docs/en/code-review-customize)
- [Vendor docs, current] Code Review reads REVIEW.md from the base branch or the default branch, never from the changes in the PR. It obeys severity reductions, path exclusions and nit caps only when REVIEW.md comes from a protected default branch. Limits:
  - REVIEW.md and its included files: a maximum of 8 included files and 150,000 bytes.
  - Markdown links: a maximum of 64.
  - An included skill file: a maximum of 30,000 bytes.
  Source: [Claude Code docs, "Customize Code Review"](https://code.claude.com/docs/en/code-review-customize)
- [Vendor docs, current] The example REVIEW.md in the docs does these things:
  - It defines Important for the repository: findings that "would break behavior, leak data, or block a rollback". Style, naming and refactor suggestions are "Nit at most".
  - It caps the nits: "Report at most five Nits per review."
  - It lists what not to report: anything that CI already enforces, generated files, lock files, and test-only code.
  - It lists checks to always do, for example that each database query has the scope of the tenant of the caller.
  Source: [Claude Code docs, "Customize Code Review"](https://code.claude.com/docs/en/code-review-customize)
- [Vendor docs, current] To cut false positives, the docs recommend an evidence rule, for example: "behavior claims need a `file:line` citation in the source, not an inference from naming". Source: [Claude Code docs, "Customize Code Review"](https://code.claude.com/docs/en/code-review-customize)

#### 1.2 Anthropic reports on its internal use

- [Vendor, 2026-10-15] "Several agents look for bugs at the same time." Then "a separate group votes on each finding, and it only gets posted if enough of them agree it's real." The post does not give the vote threshold. The system drops findings that are only about style, diagnostics or cleanup. The team did A/B tests of these filters on internal PRs before they kept them. Source: [claude.dev blog, "How the Claude Code team does code review"](https://claude.dev/blog/solving-code-review-at-anthropic/)
- [Vendor, 2026-10-15] Each finding gets 1 of 3 tags: Important, Nit or Pre-existing. The Pre-existing tag prevents a bug that the PR did not introduce from looking like the fault of the author. The reviewer reads the diff against the whole repository and the stated intent of the PR. For a bug fix, it looks for the root cause. Source: [claude.dev blog, "How the Claude Code team does code review"](https://claude.dev/blog/solving-code-review-at-anthropic/)
- [Vendor, 2026-10-15] Evaluation. The team made an eval set from past incident PRs and revert PRs that experts confirmed. The set runs each day, and each change to the reviewer gets a score against it. The team records how the person on the PR responded to each comment: fixed, wrong, intentional, or did not matter. The post gives no rates for these responses. The team also tests the REVIEW.md guidance to make sure that the reviewer obeys it. Source: [claude.dev blog, "How the Claude Code team does code review"](https://claude.dev/blog/solving-code-review-at-anthropic/)
- [Vendor, 2026-10-15] 1 CLI PR went through more than 50 review rounds in 1 night. The team then made 4 changes:
  - A round cap: after 3 rounds, the reviewer asks the author to reconsider the approach.
  - Re-review of only the diff after the first few passes.
  - A rule to flag the class of bug, not only 1 line.
  - No repeats of findings that the reviewer posted before.
  The stated priority order is "catching real bugs first and cutting review rounds second." Source: [claude.dev blog, "How the Claude Code team does code review"](https://claude.dev/blog/solving-code-review-at-anthropic/)
- [Vendor, 2026-10-15] Convergence numbers before and after these changes:

  | Metric | Before | After |
  |---|---|---|
  | PRs that pass after 1 round of review and fix | 65% | 78% |
  | PRs that need 5 or more rounds | 8.9% | 1.5% |
  | Mean number of reviews to pass | 2.08 | 1.32 |

  Source: [claude.dev blog, "How the Claude Code team does code review"](https://claude.dev/blog/solving-code-review-at-anthropic/)
- [Vendor, 2026-10-15] The post says that about 59% of flagged code was already present at the first pass of the reviewer, as git blame shows. From June to September 2026, merged PRs more than doubled, and the share of reverted changes decreased by more than 40%. Changes that land each day in the monorepo went from about 2,500 in May to more than 30,000 in September. The post gives no precision, acceptance rate or findings per PR. Source: [claude.dev blog, "How the Claude Code team does code review"](https://claude.dev/blog/solving-code-review-at-anthropic/)
- [Vendor, 2026-07-21] When a PR opens, multiple review agents examine it. Each agent has a narrow focus. Each agent uses RAG, retrieval-augmented generation, for context and for memory of past incidents. The agents must write a proof that a finding is valid before they report it. Anthropic gives this rule credit for the higher rate of substantive comments. Source: [Anthropic, "How Anthropic secures its AI-native software development lifecycle"](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)
- [Vendor, 2026-07-21] Anthropic prefers several narrow reviewers to 1 large security prompt. Narrow reviewers do not share biases or blind spots. They can catch the errors of the other reviewers, and they do not spread effort too thin. New AI reviewers run in shadow mode first, and they post comments for human approval until the team trusts them. The team inserts malicious changes to test the reviewers. Source: [Anthropic, "How Anthropic secures its AI-native software development lifecycle"](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)
- [Vendor, 2026-07-21] Anthropic estimates that its current automated processes catch about 1 in 3 of the bugs behind past claude.ai incidents. Source: [Anthropic, "How Anthropic secures its AI-native software development lifecycle"](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)

#### 1.3 The local /code-review command in Claude Code

- [Vendor docs, current] `/code-review` runs in the session of the user, on any plan. In a terminal, it runs as a background forked subagent with its own context window. `/review` is an alias. The command looks for correctness bugs. Related to the model and the effort level, it also covers reuse, simplification and efficiency cleanups. Source: [Claude Code docs, "Review locally with /code-review"](https://code.claude.com/docs/en/code-review-local)
- [Vendor docs, current] Effort levels. The docs say: "At `low`, the review reports the findings it's most confident in, so you see fewer false positives. From `medium` through `max`, the review broadens coverage." The level `ultra` starts the cloud ultrareview. The command keeps the last level that the user typed. Source: [Claude Code docs, "Review locally with /code-review"](https://code.claude.com/docs/en/code-review-local)
- [Vendor docs, current] Flags:
  - `--fix` applies the findings to the working tree.
  - `--comment` posts the findings as inline comments on a GitHub PR, or as 1 note on a GitLab merge request.
  - `--max-findings <n>`, `all` or `default` replaces the usual limit of findings. The docs say: "Where the review reports through the findings tool, the limit is 32."
  Source: [Claude Code docs, "Review locally with /code-review"](https://code.claude.com/docs/en/code-review-local)
- [Vendor docs, current] The command reads CLAUDE.md but not REVIEW.md. In a host app such as the desktop app, each finding shows the file location, a 1-sentence summary and a category tag such as `correctness`. After later fixes, Claude Code marks each finding as fixed, skipped or no change needed. The command had the name `/simplify` before v2.1.147. Source: [Claude Code docs, "Review locally with /code-review"](https://code.claude.com/docs/en/code-review-local)

#### 1.4 Ultrareview, the cloud review

- [Vendor docs, current, research preview] `/code-review ultra` starts a fleet of reviewer agents in a cloud sandbox. The docs say: "every reported finding is independently reproduced and verified". A review typically takes 5 to 15 minutes. After 3 free runs, a review typically costs $5 to $25 in usage credits. Source: [Claude Code docs, "Find bugs with ultrareview"](https://code.claude.com/docs/en/ultrareview)
- [Vendor docs, current] The default diff limits are 500 changed files and 8,000 changed lines. `claude ultrareview --json` prints the raw `bugs.json` payload. The user can post the findings to a PR as 1 plain comment. Source: [Claude Code docs, "Find bugs with ultrareview"](https://code.claude.com/docs/en/ultrareview)

#### 1.5 The open-source code-review plugin

- [Primary repo] The plugin is in `anthropics/claude-plugins-official`, in the folder `plugins/code-review`. The command file has 2 commits: the initial scaffold on 2025-11-20, and on 2026-10-26 the commit "code-review: bring in the newer command from anthropics/claude-code". Source: [GitHub API, commits of code-review.md](https://api.github.com/repos/anthropics/claude-plugins-official/commits?path=plugins/code-review/commands/code-review.md)
- [Primary repo, current command] The pipeline:
  1. A Haiku agent checks eligibility. It stops if the PR is closed, is a draft, is automated or trivially correct, or already has a Claude comment. It still reviews PRs that Claude wrote.
  2. A Haiku agent returns the paths of the root CLAUDE.md and of the CLAUDE.md files in the folders of the changed files.
  3. A Sonnet agent summarizes the change.
  4. 4 agents run in parallel. Agents 1 and 2 use Sonnet and check CLAUDE.md compliance. Agent 3 uses Opus and scans the diff for obvious bugs without extra context. Agent 4 uses Opus and looks for problems in the new code, for example security issues or incorrect logic.
  5. Opus subagents validate the bug findings. Sonnet subagents validate the CLAUDE.md findings.
  6. The command drops each finding that the validation did not confirm.
  7. The command prints a summary. Without `--comment`, it stops here.
  8. The command plans the comments.
  9. The command posts 1 inline comment for each unique issue.
  Source: [code-review.md, raw file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Primary repo, current command] Only "high-signal" issues qualify: compile or parse failures, definite logic errors, and clear CLAUDE.md violations with a rule that the agent can quote. The command excludes style concerns, issues that depend on specific inputs, and subjective suggestions. Each agent receives the PR title and the PR description. Source: [code-review.md, raw file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Primary repo, current command] The list of false positives to ignore:
  - Pre-existing issues.
  - Code that looks like a bug but is correct.
  - Pedantic nitpicks.
  - Issues that a linter catches.
  - General quality or test-coverage concerns, unless CLAUDE.md requires them.
  - Issues that a lint-ignore comment silences.
  Source: [code-review.md, raw file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Primary repo, current command] The command uses a committable suggestion block only for a small, complete fix: less than 6 lines in 1 location. Each link uses the full commit SHA and a line range with 1 line of context on each side. If the command finds nothing, it posts "No issues found. Checked for bugs and CLAUDE.md compliance." Source: [code-review.md, raw file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- [Primary repo, README] The README still describes an earlier design. It gives 4 agents: 2 agents for CLAUDE.md compliance "for redundancy", 1 agent for obvious bugs, and 1 agent for git blame and history. Each issue gets a score from 0 to 100, and the threshold is 80. The README and the current command file do not agree. Source: [README.md of the plugin](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md)
- [Primary repo, README] The score rubric: 0 is a false positive, 25 is "somewhat confident", 50 is "real but minor", 75 is "highly confident and important", and 100 is "certain". For a CLAUDE.md issue, the scorer must confirm that the guideline explicitly mentions the issue. To change the threshold, a user edits the line "Filter out any issues with a score less than 80." Source: [README.md of the plugin](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md)
- [Secondary, verified by its author on 2026-07-19] A third-party copy describes an earlier command file:
  - 5 parallel Sonnet agents: CLAUDE.md compliance; a shallow bug scan of the diff only; git blame and history; earlier PRs that touched the same files; code comments in the modified files.
  - 1 Haiku scorer for each issue, with the 0 to 100 rubric.
  - A filter that drops each issue with a score below 80.
  - A second eligibility check before the command posts.
  Source: [pi-review reference copy on jsDelivr](https://cdn.jsdelivr.net/npm/@georgedong32/pi-review@0.5.3/reference/claude-code-review.md)

#### 1.6 Third-party measurements of Anthropic products

- [Vendor-run benchmark, Qodo, 2026-03-12] Qodo Code Review Benchmark 1.0 has 100 PRs with 580 injected issues in 8 repositories, and an LLM judge. Qodo ran Claude Code Review with default settings and with AGENTS.md rules that Qodo generated. Qodo says: "Qodo outperforms Claude by 12 F1 points". The 2 tools have "identical precision levels", and the difference is in recall. Qodo default: 79% precision, 60% recall. The text gives no Claude numbers, because they are only in charts. Source: [Qodo blog](https://www.qodo.ai/blog/qodo-outperforms-claude-in-code-review-benchmark)
- [Vendor-run benchmark, Augment, 2025-12-11, updated 2026-06-18] "Claude Code" got 23% precision, 51% recall and a 31% F-score on 50 PRs. The post does not say which Claude product or configuration it used. Source: [Augment blog](https://www.augmentcode.com/blog/we-benchmarked-7-ai-code-review-tools-on-real-world-prs-here-are-the-results)
- [Secondary snapshot of Martian Code Review Bench, article of 2026-10-05] "Claude" has F1 61.3%, precision 69.0%, recall 55.2%, a sample of 995 PRs, and rank 4. The snapshot does not say which Claude product this is. Source: [aicodereviews.io](https://www.aicodereviews.io/blog/martians-code-review-bench-the-1-claim-rots-in-months/)

### Inferences

- [Inference] The open-source plugin changed from a cheap score threshold, with a Haiku scorer and a threshold of 80, to validation by a strong model, with Opus for bug findings. The managed product also has a separate verify step and a vote. Anthropic probably found that a 0 to 100 score from a small model is not a good main filter. Anthropic did not publish the reason.
- [Inference] The number "less than 1% marked incorrect" counts only findings that engineers marked. It is not a precision value, because it does not include findings with no mark or bugs that the reviewer missed.
- [Inference] The 59% git blame number and the rules "flag the class of bug" and "no repeats" together suggest a problem: later rounds flagged old code that earlier rounds missed, so PRs stayed open. A designer can copy the fix: review only the new diff after the first passes, post no repeats, and cap the rounds.
- [Inference] All Anthropic products separate issues that the PR introduced from pre-existing issues. The plugin excludes pre-existing issues. The managed product posts them with a separate label, and re-reviews post fewer of them.
- [Inference] The managed product gives the repository owner control of the severity calibration, through REVIEW.md on a protected branch. This prevents a PR author from a change to the review rules in the same PR.

### Gaps

- Anthropic did not publish the number of agents, the models or the vote threshold of Code Review or of each review level.
- I found no public precision, recall or acceptance rate for the generally available product. The dashboard shows an acceptance rate, but Anthropic published no value.
- The docs do not say what changes between the levels `low`, `medium`, `high` and `max` of `/code-review`, for example the number of agents or the threshold. The Claude Code skill description in this session lists a level `xhigh`, but I found no public docs page for `xhigh`. [Unconfirmed]
- The docs give no hard cap on comments for the managed product. The only documented caps are the nit cap that a team writes in REVIEW.md and the limit of 32 findings in the local findings tool.
- The raw URL of the command file in `anthropics/claude-code` gave HTTP 404. I read the copy in `anthropics/claude-plugins-official`.
- The internal steps of the local `/code-review` command are not public, because it is a bundled skill with no file on disk.

## 2. GitHub Copilot code review, CodeRabbit, Cursor Bugbot, Graphite, Greptile, Qodo, Sourcery, Amazon CodeGuru Reviewer, Google and Meta: architecture and numbers

### Takeaway

Most large vendors moved from a fixed pipeline to an agentic loop with tools for repository context, and most keep a filter or a verification step after the find step. The published quality numbers are mostly vendor "acted on" rates: Bugbot 78.13% resolution, Greptile 66% addressed, Graphite about 52% accepted, and Google 40% to 50% of previewed edits applied. Independent studies give similar or lower numbers, for example 36.4% acceptance for CodeRabbit in public repositories.

### Cited Findings

#### 2.1 GitHub Copilot code review

- [Vendor, 2026-03-05] Copilot code review started in April 2025. Usage increased 10 times since then. It now does "more than one in five code reviews on GitHub". More than 12,000 organizations run it automatically on each PR. Source: [GitHub blog, "60 million Copilot code reviews and counting"](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Vendor, 2026-03-05] In 71% of reviews, Copilot gives actionable feedback. In the other 29%, it posts no comments. It averages about 5.1 comments per review. The post says that this did not increase review churn or lower the quality threshold. The post does not say if the average includes the reviews with no comments. Source: [GitHub blog, "60 million Copilot code reviews and counting"](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Vendor, 2026-03-05] GitHub measures quality with these signals:
  - Thumbs-up and thumbs-down reactions on comments.
  - Whether the author resolves a flagged issue before the merge.
  - Internal tests against known code issues.
  - A continuous loop of experiments.
  Source: [GitHub blog, "60 million Copilot code reviews and counting"](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Vendor, 2026-03-05] Architecture. The agent retrieves repository context and explores logic, architecture and invariants. It flags issues while it reads, not only at the end. It keeps memory across reviews. For a long PR, it makes a review plan first. It reads linked issues and PRs, to find code that looks correct alone but does not meet the project requirements. Source: [GitHub blog, "60 million Copilot code reviews and counting"](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Vendor, 2026-03-05] The agentic redesign gave an initial 8.1% increase in positive feedback. A more advanced reasoning model gave 6% more positive feedback but 16% more review latency, and GitHub accepted this trade. Source: [GitHub blog, "60 million Copilot code reviews and counting"](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Vendor, 2026-03-05] Noise controls:
  - No comment when there is nothing actionable.
  - Multi-line comments on logical code ranges, not comments on single lines.
  - 1 grouped unit for repeated instances of the same pattern.
  - Batch autofixes for a class of fixes.
  GitHub stopped the pin of comments to single lines after survey responses and reactions. Source: [GitHub blog, "60 million Copilot code reviews and counting"](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Vendor, 2026-03-05] The "agentic tool-calling architecture" became generally available for Copilot Pro, Pro+, Business and Enterprise. It runs on GitHub Actions. GitHub claims "higher-quality findings", lower noise and more actionable guidance, with no data. Source: [GitHub changelog, 2026-03-05](https://github.blog/changelog/2026-03-05-copilot-code-review-now-runs-on-an-agentic-architecture/)
- [Search snippet, vendor, 2025-10-28] A public preview added tool calls for context and the deterministic tools ESLint and CodeQL. Source: [GitHub changelog, 2025-10-28](https://github.blog/changelog/2025-10-28-new-public-preview-features-in-copilot-code-review-ai-reviews-that-see-the-full-picture/)
- [Search snippet, vendor, 2025-11-20] A repository rule lets a team select ESLint, PMD or CodeQL as linters for Copilot code review. Source: [GitHub changelog, 2025-11-20](https://github.blog/changelog/2025-11-20-linter-integration-with-copilot-code-review-now-in-public-preview/)
- [Vendor docs, current] Review effort levels and cost estimates for each review, without GitHub Actions minutes:

  | Level | Description in the docs | Average cost | Typical range |
  |---|---|---|---|
  | Lite | fast, targeted feedback on "bugs, security vulnerabilities, and style inconsistencies" | about $0.25 | $0.05 to $1 |
  | Balanced, the default | routes to "a higher-reasoning model for longer analysis" | about $1.50 | $0.25 to $5 |
  | Max, public preview | "uses multiple high-reasoning models" | about $10 | $1.50 to $25 |

  Source: [GitHub docs, "About Copilot code review"](https://docs.github.com/en/copilot/concepts/agents/code-review)
- [Vendor docs, current] Instruction files are `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `AGENTS.md` and `.github/skills/`. Copilot code review reads instructions from the head branch, not from the base branch. The GitHub MCP server and the Playwright MCP server are on by default. Copilot Memory can keep facts about the repository for later reviews. Source: [GitHub docs, "About Copilot code review"](https://docs.github.com/en/copilot/concepts/agents/code-review)
- [Vendor docs, current] By default, Copilot reviews do not count toward required approvals. If an admin enables Copilot approvals, Copilot can submit a review that approves the PR. Each review gives an approval assessment in the overview comment. Copilot skips dependency files, log files and SVG files. If GitHub Actions is not available, the review has no agentic features. The docs give no severity levels and no cap on comments. Source: [GitHub docs, "About Copilot code review"](https://docs.github.com/en/copilot/concepts/agents/code-review)

#### 2.2 CodeRabbit

- [Vendor, 2025-09-05] Context sources:
  - Codegraph: a map of definitions and references, plus the files that often change together in the commit history.
  - Code index: an index of embeddings of functions, classes, tests and earlier PRs, for search by purpose.
  - Team rules: coding guidelines and review instructions.
  - Learnings: rules for the repository from developer replies. Example: a developer said that Prisma migrations are generated, and CodeRabbit stored this to stop future false positives.
  - Tool signals: findings from linters and security analyzers.
  - Verification scripts: shell or Python checks, for example with grep and ast-grep, that confirm assumptions before CodeRabbit posts a comment.
  Source: [CodeRabbit blog, "How CodeRabbit delivers accurate AI code reviews on massive codebases"](https://www.coderabbit.ai/blog/how-coderabbit-delivers-accurate-ai-code-reviews-on-massive-codebases)
- [Vendor, 2025-09-05] Each PR gets an isolated, short-lived environment. The environment pulls only what it needs, and CodeRabbit removes it after the review. The stated flow: map what the change touches, tie it to intent, apply rules, verify with tools, then comment with evidence. The post gives no model names, no severity levels and no quality metrics. Source: [CodeRabbit blog, "How CodeRabbit delivers accurate AI code reviews on massive codebases"](https://www.coderabbit.ai/blog/how-coderabbit-delivers-accurate-ai-code-reviews-on-massive-codebases)
- [Vendor docs, current] Review profiles, the option `reviews.profile`:
  - `quiet`: "Posts only the most important comments inline and groups the other review comments in the review summary."
  - `chill`, the default: "Balanced feedback."
  - `assertive`: "More feedback, which may feel nitpicky."
  Source: [CodeRabbit docs, configuration reference](https://docs.coderabbit.ai/reference/configuration)
- [Vendor docs, current] The knowledge base has learnings, issues and past PRs, each with a scope of local, global or auto. `code_guidelines` uses guideline files as review criteria. `path_instructions` adds guidance for the paths that match a glob. `path_filters` includes or excludes files. The section `reviews.tools` lists 59 tools. Source: [CodeRabbit docs, configuration reference](https://docs.coderabbit.ai/reference/configuration)
- [Vendor docs, current] On the findings page for the IDE, each finding has a type and a severity. The types are Nitpick, Potential issue and Refactor suggestion. The severities are Critical, Major, Minor, Trivial and Info. The thread label combines them, for example "Potential Issue | Major". The page does not define the levels. I did not confirm that PR comments use the same labels. Source: [CodeRabbit docs, findings](https://docs.coderabbit.ai/ide/findings)
- [Search snippet, vendor, 2026-03-03] CodeRabbit claims the first rank for F1 among 10 tools in the online part of Martian Code Review Bench, with 51.2% F1 across nearly 300,000 PRs. Source: [CodeRabbit blog](https://www.coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark)
- [Independent, 2026-02-26] Martian reports that CodeRabbit had the highest online recall, 0.54, with 5,035 PRs reviewed. Source: [Martian, "Code Review Bench: Towards Billion Dollar Benchmarks"](https://withmartian.com/post/code-review-bench-v0)
- [Independent, 2026-07-03] Lin et al., University of Melbourne and Monash University, studied CodeRabbit in public repositories:
  - Data: 31,073 pairs of CodeRabbit review comments and developer replies, in 10,191 PRs and 239 GitHub repositories.
  - Accepted: 36.4%. Accepted means a code change, a follow-up PR or a new issue.
  - Discussion: 7.3%. Rejected: 56.3%.
  - Acceptance increased by about 0.5% each month, a statistically significant trend.
  - Causes of rejection: invalid suggestions, 58.0%, for example false positives, redundant suggestions and comments out of scope; misalignment with coding practices, 42.0%.
  - Functional concerns were 75.9% of comments, with 56.2% rejected. Evolvability concerns were 24.1%, with 56.7% rejected.
  - A LoRA-tuned Qwen2.5-4B model predicts rejection with 68% precision, 87% recall and 76% F1.
  Source: [alphaXiv, arXiv 2607.03316, "Is Agentic Code Review Helpful?"](https://www.alphaxiv.org/abs/2607.03316v1)
- [Independent, arXiv v2 of 2026-04-25] Sun et al. measured the old open-source GitHub Action `coderabbitai/ai-pr-reviewer`, which reviews each hunk. Authors addressed 19.2% of its 713 comments. Authors addressed 60.0% of human comments. This action is not the current CodeRabbit product. Source: [arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)

#### 2.3 Cursor Bugbot

- [Vendor, 2025-07-24] Bugbot left beta. During the beta, it reviewed more than 1 million PRs and found more than 1.5 million issues. Cursor says: "over 50% of identified bugs are resolved by the time the PR is merged". Teams guide reviews with rules in a `BUGBOT.md` file. Cursor says that Bugbot keeps "the false positive rate low", with no number. Source: [Cursor blog, "Bugbot is out of beta"](https://cursor.com/en/blog/bugbot-out-of-beta)
- [Vendor, 2026-01-15] The first design, from July 2025:
  - 8 parallel passes look for bugs. Each pass gets the diff in a random order.
  - The system puts similar bugs into buckets.
  - A majority vote drops each bug that only 1 pass found.
  - The system merges each bucket into 1 clear description.
  - A filter removes unwanted categories, for example compiler warnings and documentation errors.
  - A validator model catches false positives.
  - The system removes bugs that it posted in earlier runs.
  Source: [Cursor blog, "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)
- [Vendor, 2026-01-15] The main metric is "resolution rate". At the merge of a PR, an AI decides which flagged bugs the author resolved in the final code. Cursor checked examples with the PR authors, and the LLM "correctly classified nearly all of them". Offline, Cursor uses BugBench, "a curated benchmark of real code diffs with human annotated bugs". Source: [Cursor blog, "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)
- [Vendor, 2026-01-15] Cursor ran 40 major experiments and released 11 versions from July 2025 to January 2026. Many changes made the metrics worse. In fall 2025, Cursor moved to a fully agentic design, which gave the largest gains. The agent reasons over the diff, calls tools and decides where to look deeper. The early agent was too cautious, so Cursor changed the prompts to make it more aggressive. The design of the tools had a large effect on the behavior of the agent. Source: [Cursor blog, "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)
- [Vendor, 2026-01-15] Numbers:
  - Resolution rate: from 52% to "over 70%".
  - Average bugs flagged per run: from 0.4 to 0.7.
  - Resolved bugs per PR: from about 0.2 to about 0.5.
  - Volume: more than 2 million PRs reviewed each month.
  Source: [Cursor blog, "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)
- [Vendor, 2026-02-26] Autofix starts cloud agents, each in its own virtual machine, that make fixes for the bugs. Developers merge more than 35% of Autofix changes into the base PR. The resolution rate went from 52% to 76%. Issues per run nearly doubled in 6 months. Self-verification of findings is a future goal. Source: [Cursor blog, "Bugbot Autofix"](https://cursor.com/blog/bugbot-autofix)
- [Vendor, 2026-04-08] Learned rules. Bugbot collects signals from merged PRs: reactions to its comments, replies to its comments, and comments from human reviewers about issues that Bugbot missed. Bugbot makes candidate rules from these signals. A candidate rule becomes active when enough signal accumulates. Bugbot can disable an active rule that gets consistent negative signal. Users can edit or delete rules. Source: [Cursor blog, "Bugbot learning"](https://cursor.com/blog/bugbot-learning)
- [Vendor-run comparison, 2026-04-08] The resolution rate is 78.13% across 50,310 PRs in public repositories, with an LLM judge at merge time. Cursor gives Greptile 63.49% on the same measure. At the end of the beta in July 2025, the rate was 52%, and the post calls the rest false positives. More than 110,000 repositories turned on the learned rules, and Bugbot generated more than 44,000 learned rules. Bugbot reviews "hundreds of thousands of PRs per day". Source: [Cursor blog, "Bugbot learning"](https://cursor.com/blog/bugbot-learning)
- [Vendor docs, current] Rules and limits:
  - The root `.cursor/BUGBOT.md` always applies. Bugbot also includes the `BUGBOT.md` files that it finds when it goes up from each changed file.
  - Order of rules: team rules, then project `BUGBOT.md` files, then learned rules, then manual rules.
  - Bugbot cuts each rule at 30,000 characters. The combined rules for 1 review have a cap of 100,000 characters.
  - The configuration file `.cursor/config/bugbot.yaml` comes from the base branch of the PR, not from the head branch.
  - Effort levels: low, default, high and smart. Smart selects a level from the title, the author, the repository name and the diff.
  - Incremental reviews are on by default. Bugbot reads the PR comments to prevent duplicate suggestions.
  - The check concludes as neutral when there are findings. It concludes as failure only if the team enables the fail-on-unresolved option.
  - Bugbot skips a PR that is too large and asks for a split.
  - The docs give no cap on comments and do not define severity levels. The API has a `severity` field with values such as "high" and "medium".
  Source: [Cursor docs, Bugbot](https://cursor.com/docs/bugbot)
- [Search snippet, 2025-12-19] Cursor announced that it acquired Graphite. Reports say that the companies plan to merge the AI reviewer of Graphite with Bugbot. Source: [SiliconANGLE](https://siliconangle.com/2025/12/19/cursor-acquires-ai-code-review-startup-graphite/)

#### 2.4 Graphite: Diamond, now Graphite Agent

- [Vendor, speaker-reported, 2025] At AI Engineer World's Fair 2025, Tomas Reimers of Graphite gave these numbers:
  - Less than 4% of Diamond comments get a downvote.
  - Authors put about 45% to 50% of human review comments into the PR.
  - Authors put about 52% of Diamond comments into the PR, as of March 2025, after "substantial tuning".
  The talk gives no sample sizes or time windows. Source: [AI Engineer talk page](https://ai.engineer/talks/don-t-get-one-shotted-use-ai-to-test-review-merge-and-deploy-code-tomas-reimers-graphite)
- [Secondary] A study summary of the Graphite talk "Lessons from millions of AI code reviews" says these things. Graphite measures whether a comment makes the author change code in that PR. It does not use thumbs reactions, because less than 4% of comments got a reaction. The LLM makes too many comments that are correct but unwanted, for example "add test", "extract function" and "comment this". Wrong comments, for example "revert this code", erode trust. Diamond keeps only the comments that the LLM can catch reliably and that humans want. Source: [CS146S handbook summary](https://fireman333.github.io/CS146S-handbook-zh/readings/w7_lessons_from_millions_of_ai_code_reviews/)
- [Vendor case study, no date] Graphite builds evals from Diamond comments on internal Graphite PRs. Each comment has a label: accepted or rejected, and thumbs up or thumbs down. There are 3 scorers: line range validation, semantic similarity to earlier versions, and binary user feedback. Graphite calls acceptance rate its most important metric: comments that cause a developer action, for example a commit of the suggested change. The page shows a "90%+" target acceptance rate and a "5% reduction in negative rules generated", without detail. Source: [Braintrust, Graphite case study](https://www.braintrust.dev/blog/graphite)
- [Vendor docs, current] The comment categories are logic bugs, edge cases, security vulnerabilities, performance issues, and code committed by accident, for example debug statements. Each comment gives the problem, why it matters and a concrete fix that the author can commit. An issue counts as accepted when it leads to a code change. Graphite tracks the downvote rate. Graphite does not analyze a PR with more than 200,000 characters. The page gives no severity levels and no cap on comments. Source: [Graphite docs, AI review comments](https://www.graphite.com/docs/ai-review-comments)
- [Search snippet, secondary] Diamond became part of Graphite Agent in October 2025. Source: [21st.dev](https://21st.dev/blog/graphite-vs-design-bug-bot)
- [Independent, 2026-02-26] Graphite had the highest precision and the lowest recall in both the online and the offline benchmark of Martian. The post gives no numbers. Source: [Martian, "Code Review Bench: Towards Billion Dollar Benchmarks"](https://withmartian.com/post/code-review-bench-v0)

#### 2.5 Greptile

- [Vendor, 2024-12-18] The bot left too many comments, up to 10 on a PR with 20 changes. Greptile defines "address rate" as the "percentage of generated comments that the author actually addresses". An analysis found about 19% good comments, 2% incorrect comments and 79% nits. Source: [Greptile blog, "How to make LLMs shut up"](https://www.greptile.com/blog/make-llms-shut-up)
- [Vendor, 2024-12-18] Approaches that Greptile tried:
  - Prompts: the team "simply could not get the LLM to produce fewer nits without also producing fewer critical comments". Few-shot examples made the bot worse.
  - An LLM judge gave each comment a severity from 1 to 10, and a filter removed scores below 7. The judgment "was nearly random", and the extra call made the bot slow.
  - Fine-tuning: not tried, because of cost, speed and loss of model portability.
  - A filter with embeddings: this approach worked.
  Source: [Greptile blog, "How to make LLMs shut up"](https://www.greptile.com/blog/make-llms-shut-up)
- [Vendor, 2024-12-18] The filter with embeddings. Greptile stores embeddings of past comments for each team: addressed, upvoted or downvoted comments. A new comment gets a cosine-similarity check against the stored comments. If it is similar to 3 or more unique downvoted comments, Greptile blocks it. If it matches 3 upvoted comments, or matches neither or both, it passes. The post does not give the similarity threshold. Within 2 weeks, the address rate for current users went from 19% to more than 55%. Source: [Greptile blog, "How to make LLMs shut up"](https://www.greptile.com/blog/make-llms-shut-up)
- [Vendor, 2025-11-26] v2 was a fixed pipeline, "a flowchart": the PR diff, a fixed step for codebase context, a fixed step for external context, then comments. v3 is an agentic loop with tools: codebase search, learned rules and git history. It has "a very high limit" on LLM calls and tool calls, so it can follow nested function calls. v3 uses about 3 times more context tokens than v2. It has a higher threshold for "sureness", because it can challenge its own hypotheses. Source: [Greptile blog, "Greptile v3"](https://www.greptile.com/blog/greptile-v3-agentic-code-review)
- [Vendor, 2025-11-26] Metrics from v2 to v3:

  | Metric | v2 | v3 | Change |
  |---|---|---|---|
  | Ratio of upvotes to downvotes | 1.44 | 5.13 | +256% |
  | Upvotes per 10,000 comments | 109 | 183 | +68% |
  | Action rate | 34.75% | 59.24% | +70.5% |

  v3 reviewed more than 1 billion lines of code. Inference costs for self-hosted customers are 75% lower because of high cache hit rates. Source: [Greptile blog, "Greptile v3"](https://www.greptile.com/blog/greptile-v3-agentic-code-review)
- [Search snippet, vendor] Greptile uses Claude for code investigation with multiple steps, and it uses the sub-agent capabilities of the Claude Agent SDK. Source: [Anthropic customer story, Greptile](https://claude.com/customers/greptile)
- [Vendor, 2026-03-05] Greptile did an A/B test of v4 against v3 for 1 month across many customers and "hundreds of thousands of PRs". An LLM judge decides whether the author addressed a comment. Results:

  | Metric | v3 | v4 | Change |
  |---|---|---|---|
  | Addressed comments per PR | 0.92 | 1.60 | +74% |
  | Comments addressed | 30% | 43% | +44% |
  | Positive replies per PR, for example "nice catch" or "fixed" | 0.31 | 0.52 | +68% |
  | Upvote reactions per PR | 0.05 | 0.08 | +60% |

  The post says that v4 has "a far lower false positive rate", with no number. The price is $30 for each developer each month, with 50 reviews, then $1 for each review. Source: [Greptile blog, "Greptile v4 + New Pricing"](https://www.greptile.com/blog/greptile-v4)
- [Vendor, 2026-08-05] v5 is a swarm of narrow agents. Each agent tests 1 hypothesis about a potential bug, and the agents run in parallel. Greptile says that "agents perform better when their task is narrowly scoped". In an A/B test of about 1 month on more than 1 million PRs, the median review time went from 5:04 to 2:25. Comments addressed by authors went from 52% to 66%. Positive replies per PR went from 0.266 to 0.342, an increase of 28.6%. Source: [Greptile blog, "Greptile v5"](https://www.greptile.com/blog/greptile-v5)
- [Vendor, conflict between posts] The numbers of the same version do not agree between posts. The v3 post gives v3 an action rate of 59.24%, but the v4 post gives v3 30% of comments addressed. The v4 post gives v4 43%, but the v5 post gives v4 52%. The posts use different metric names and different time periods. Sources: [Greptile v3](https://www.greptile.com/blog/greptile-v3-agentic-code-review), [Greptile v4](https://www.greptile.com/blog/greptile-v4), [Greptile v5](https://www.greptile.com/blog/greptile-v5)
- [Vendor docs, current] Strictness has 3 levels, and the default is 2. Level 1 comments on everything. Level 2 "provides moderate filtering". Level 3 "shows only the most critical issues (high threshold)". The comment types are `logic`, `syntax` and `style`, and all 3 are on by default. `ignorePatterns` skips files such as generated code and lock files. The docs tell teams to "give the learning system 2-3 weeks to adapt to your reactions". Source: [Greptile docs, "Controlling nitpickiness"](https://www.greptile.com/docs/code-review/controlling-nitpickiness)
- [Search snippet, vendor docs] Greptile reads the first and the last commit of each PR to find which comments the author addressed. An LLM judge decides "Addressed". A pattern with a thumbs-down reaction can cause Greptile to suppress that type of comment. Source: [Greptile docs, memory and learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning)

#### 2.6 Qodo: PR-Agent, Qodo Merge and Qodo 2.0

- [Primary repo, current] The review prompt of the open-source PR-Agent:
  - It focuses on new code, "lines starting with '+'", and "only on issues introduced by this PR".
  - It treats the PR title, the description, commit messages, tickets and CI artifacts as untrusted data.
  - It flags clear bugs and security issues as discrete, actionable issues.
  - It flags a standards violation only when a repository rule "explicitly covers the changed code". The finding must name the rule and its source file.
  - It does not speculate that changes break other code, unless the affected path is visible in the diff.
  - It does not flag style preferences, missing docstrings, type hints, comments, unused imports or narrower exception types, unless a broad handler hides a real failure.
  Source: [pr_reviewer_prompts.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/pr_reviewer_prompts.toml)
- [Primary repo, current] The output is YAML under a key `review:`. The field `key_issues_to_review` is "A concise list (0-{{ num_max_findings }} issues)". Each issue has a file, a header, content, a start line, an end line and an optional confidence. Other fields: `security_concerns`, `relevant_tests`, `estimated_effort_to_review_[1-5]`, `score` from 0 to 100, `risk_level`, and `merge_recommendation`. Earlier findings count toward the cap, and the model must not restate them in different words. Source: [pr_reviewer_prompts.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/pr_reviewer_prompts.toml)
- [Primary repo, current] Default values:

  | Key | Default |
  |---|---|
  | `pr_reviewer.num_max_findings` | 6 |
  | `pr_reviewer.require_security_review` | true |
  | `pr_reviewer.require_tests_review` | true |
  | `pr_reviewer.require_score_review` | false |
  | `pr_code_suggestions.num_code_suggestions_per_chunk` | 3 |
  | `pr_code_suggestions.max_number_of_calls` | 3 |
  | `pr_code_suggestions.parallel_calls` | true |
  | `pr_code_suggestions.focus_only_on_problems` | true |
  | `pr_code_suggestions.suggestions_score_threshold` | 1 |
  | `pr_code_suggestions.new_score_mechanism_th_high` | 9 |
  | `pr_code_suggestions.new_score_mechanism_th_medium` | 7 |
  | `pr_code_suggestions.score_on_reflection_failure` | 7 |
  | `config.max_model_tokens` | 256000 |
  | `config.patch_extra_lines_before` and `patch_extra_lines_after` | 5 and 1 |
  | `config.large_patch_policy` | "clip", the other value is "skip" |

  Source: [configuration.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/configuration.toml)
- [Primary repo, current] Self-reflection for code suggestions. A second model call gives each suggestion a score from 0 to 10. It gives 0 "if the suggestion is wrong". It reserves "high scores (8-10) for suggestions addressing critical issues such as major bugs or security concerns". It gives "moderate scores (3-7)" for minor issues, style and readability. Caps: a suggestion that only asks for verification gets 7 or less, and error handling or type checks get 8 or less. Automatic 0: docstrings, type hints, comments, unused imports, missing imports, more specific exception types, and doubts about definitions that can exist elsewhere in the codebase. Each score has a short `why`. Source: [pr_code_suggestions_reflect_prompts.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/code_suggestions/pr_code_suggestions_reflect_prompts.toml)
- [Vendor, 2026-02-04] Qodo 2.0 splits the review into tasks for specialized agents. Each agent has its own dedicated context. A judge agent resolves conflicts between agents, removes duplicates and filters low-signal results. Qodo says: "Only issues that meet a high confidence and relevance threshold make it into the final review." A recommendation agent uses past PRs, earlier review feedback and repeated patterns. Each issue has a type, for example bug, rule violation or requirement gap, a severity, and a label for the quality dimension. The post names no severity levels and no cap. Source: [Qodo blog, "Introducing Qodo 2.0"](https://www.qodo.ai/blog/introducing-qodo-2-0/)
- [Vendor, 2026-02-04] Qodo says that precision "can be tuned through filtering and prioritization once issues are found", but recall "cannot". The post names "Too much noise from low impact comments" as a core problem. Source: [Qodo blog, "Introducing Qodo 2.0"](https://www.qodo.ai/blog/introducing-qodo-2-0/)
- [Vendor-run benchmark, 2026-02-04] Qodo 2.0 had "the highest overall F1 score at 60.1%" and a recall of 56.7%, on PRs from open-source repositories with injected bugs. Qodo says it beat "the next best solution by 9%". The text gives no numbers for competitors, and it gives "60.1" also for a different mode. Source: [Qodo blog, "Introducing Qodo 2.0"](https://www.qodo.ai/blog/introducing-qodo-2-0/)
- [Independent, ICSE SEIP 2025, search snippet of the arXiv paper] Beko used a tool based on the open-source PR-Agent with GPT-4 Turbo. 238 practitioners in 10 projects had access. In 3 projects, the study covered 4,335 PRs, and 1,568 PRs had automated reviews. Authors resolved 73.8% of the automated comments. The average time to close a PR increased from 5 hours 52 minutes to 8 hours 20 minutes. Developers reported faulty reviews, unnecessary corrections, and comments that were too frequent or not relevant. Source: [arXiv 2412.18531, "Automated Code Review In Practice"](https://arxiv.org/abs/2412.18531)

#### 2.7 Sourcery

- [Vendor docs, current] A review has these parts:
  - A summary in the PR description, under "Summary by Sourcery".
  - A reviewer's guide: an overview, then a table of what changed in each file and why.
  - Inline comments. Each comment starts with a label, for example `issue (bug_risk):` or `nitpick (performance):`. Security comments start with 🚨.
  - A suggestion block, when a concrete fix is possible.
  - A status check "Sourcery review". It fails "when blocking security findings require changes".
  Source: [Sourcery docs, "Anatomy of a review"](https://docs.sourcery.ai/reviews/anatomy-of-a-review/)
- [Vendor docs, current] Sourcery can approve a PR when "nothing it found is worth blocking on", if the team turns on this option. Sourcery reviews a PR when it opens and again after each commit. Automatic re-reviews have a cap of 5 for each PR, and a comment `@sourcery-ai review` resets the counter. The docs say that comments "change as your team reacts to them and as you add review rules". Source: [Sourcery docs, "Anatomy of a review"](https://docs.sourcery.ai/reviews/anatomy-of-a-review/)
- [Search snippet, vendor docs, unconfirmed] Sourcery uses LLM analysis together with static analysis. When many similar past comments got the mark "unhelpful", Sourcery suppresses similar new comments. The page that I opened did not confirm this. Source: [Sourcery docs, Code Review](https://docs.sourcery.ai/Code-Review)
- [Secondary, unconfirmed] A blog post says that 1 evaluation found about 50% of Sourcery comments to be noise and 25% to be bikeshedding. The post does not name the evaluation. Source: [dev.to](https://dev.to/rahulxsingh/sourcery-ai-alternatives-10-best-code-quality-tools-in-2026-98n)

#### 2.8 Amazon CodeGuru Reviewer

- [Vendor docs, current] CodeGuru Reviewer uses program analysis together with machine learning models, trained on millions of lines of Java and Python code from Amazon and other sources. It analyzes PRs automatically, and it can also analyze a full repository. Recommendations cover, for example, AWS SDK best practices, thread safety of concurrent data structures, and resource closure. Developers give feedback on whether a recommendation was useful. A file `aws-codeguru-reviewer.yml` can exclude files and folders. AWS claims "a low rate of false positives", with no number. Source: [AWS docs, "How Amazon CodeGuru Reviewer works"](https://docs.aws.amazon.com/codeguru/latest/reviewer-ug/how-codeguru-reviewer-works.html)
- [Vendor docs, current] Since November 7, 2025, customers cannot create new repository associations. Source: [AWS docs, "How Amazon CodeGuru Reviewer works"](https://docs.aws.amazon.com/codeguru/latest/reviewer-ug/how-codeguru-reviewer-works.html)
- [Search snippet, 2020-06-29] At general availability, AWS said that the models learned from decades of Amazon code reviews and more than 10,000 open-source projects on GitHub. Comments usually appeared on the PR within 15 minutes. Source: [VentureBeat](https://venturebeat.com/2020/06/29/amazon-launches-ai-powered-code-review-service-codeguru-in-general-availability/)
- [Search snippet, vendor, 2021-05] Reviewer scanned more than 200 million lines of code and produced 165,000 recommendations. Source: [All Things Distributed](https://www.allthingsdistributed.com/2021/05/devops-powered-by-machine-learning.html)
- [Search snippet, vendor case study] Gridium: 281 automated PR reviews gave 104 recommendations and 50 code corrections. Source: [AWS DevOps blog, Gridium](https://aws.amazon.com/blogs/devops/codeguru-gridium-maintain-codebase)
- [Search snippet, Amazon Science] An Amazon paper says that precision and recall are not practical to measure on industrial code, because there is no ground truth. The paper monitors the quality of static analysis rules with true negatives. Source: [Amazon Science PDF](https://assets.amazon.science/ed/11/a321529f4b61a1a35b9f4a7b8626/long-term-static-analysis-rule-quality-monitoring-using-true-negatives.pdf)

#### 2.9 Google: ML-suggested edits and AutoCommenter

- [Vendor research, 2023-05-23] Google built a model with the DIDACT method. It fine-tuned the model on reviewed code changes, reviewer comments and the edits that authors made in response. Google calibrated the model for a target precision of 50%. Offline, the model addresses 52% of comments at that precision. Online, suggestions pass the target confidence for about 50% of relevant comments. Source: [Google Research blog, "Resolving code review comments with ML"](https://research.google/blog/resolving-code-review-comments-with-ml/)
- [Vendor research, 2023-05-23] Authors apply 40% to 50% of all previewed suggested edits. A "Show ML-edit" button increased the preview rate from about 20% to about 40%. Authors apply more than 70% of suggestions in the code review tool and less than 30% in the IDE. The share of comments addressed with an ML-suggested edit doubled from the beta to the full internal launch. "Not helpful" feedback showed repeated failure patterns, and heuristics at serving time removed them. This traded quantity for quality and increased the acceptance rate. Source: [Google Research blog, "Resolving code review comments with ML"](https://research.google/blog/resolving-code-review-comments-with-ml/)
- [Search snippet, vendor research, ICSE SEIP 2024] The paper abstract says that authors at Google address 7.5% of all reviewer comments with an ML-suggested edit. The ICSE talk page says "almost 5%", and that the number can reach 10% with a newer version. The 2 sources do not agree. Sources: [Google Research publication page](https://research.google/pubs/resolving-code-review-comments-with-machine-learning/), [ICSE 2024 talk page](https://conf.researchr.org/details/icse-2024/icse-2024-software-engineering-in-practice/35/Resolving-Code-Review-Comments-with-Machine-Learning)
- [Vendor research, AIware 2024, arXiv 2405.13565] AutoCommenter flags violations of coding best practices in C++, Java, Python and Go. Its model is a T5-based multi-task model. The data has more than 3 billion examples, and about 800,000 examples come from human review comments with a URL to a best-practice document. The model gives a location, a best-practice URL and a confidence from 0 to 1. The context window is 2,048 tokens, enough for about 200 lines. Source: [arXiv 2405.13565](https://arxiv.org/html/2405.13565)
- [Vendor research, AIware 2024] Filters:
  - A global threshold of 0.98 gave too many false negatives, so Google set a threshold for each URL.
  - 80% of comments fell on unchanged lines, and Google removed them. With greedy decode, the posted share of changed files was then 1.3%. With a beam search of 4, it was 3.9%.
  - Google suppressed 17 non-actionable URLs. The useful ratio from developers went from 54% to 66%, and from raters it went from 60% to 74%. Google then suppressed 5 more URLs.
  - Google suppressed outdated practices with conditional regex filters.
  Source: [arXiv 2405.13565](https://arxiv.org/html/2405.13565)
- [Vendor research, AIware 2024] Results and rollout. The target before a wide rollout was a useful ratio of 80%. The paper says that a simple suppression mechanism increased acceptance to more than 80%. Developers gave explicit feedback on about 10% of review comments and 2% of IDE diagnostics. The estimated resolution rate is about 40%. An A/B test showed no significant change in review duration. The rollout reached all developers in October 2023, and "tens of thousands of developers" use it each day. Source: [arXiv 2405.13565](https://arxiv.org/html/2405.13565)
- [Vendor research, AIware 2024] Lessons: "Intrinsic evaluations and real-world performance can diverge significantly." Also: "Even a few negative user experiences can erode trust." Of the top 50 predicted URLs, 33 were outside the scope of traditional static analysis. Source: [arXiv 2405.13565](https://arxiv.org/html/2405.13565)

#### 2.10 Meta: MetaMateCR and RADAR

- [Vendor research, arXiv v1 of July 2025, FSE 2026 industry track] MetaMateCR generates patches for reviewer comments in Phabricator. The parts are a classifier for actionable comments, an LLM that writes the patch, and a validation system that runs linters, tests and builds on each patch. Source: [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [Vendor research] Data and models. Meta fine-tuned Llama 3.1 70B models: SmallLSFT on 2,900 human-labeled pairs, and LargeLSFT on 64,000 pairs, of which a classifier labeled 46,000. The actionability classifier had a precision of 0.86, a recall of 0.85 and an F1 of 0.85 on 240 labeled comments. Source: [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [Vendor research] Offline exact match of the patch: GPT-4o 59.22%, SmallLSFT 63.11%, LargeLSFT 67.96%. Source: [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [Vendor research] Safety trial 1 showed the patches to reviewers. Time in review increased by 5.5%, with p = 0.029, and time spent increased by 6.7%. Meta stopped this trial. In trial 2, only authors saw the patches, and reviewers saw them collapsed. Trial 2 showed no significant regression. Source: [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [Vendor research] Production results, "ActionableToApplied" and "ShownToApplied":

  | Model | ActionableToApplied | ShownToApplied |
  |---|---|---|
  | GPT-4o, experiment 1 | 10.71% | 19.90% |
  | GPT-4o, experiment 2 | 10.53% | 21.27% |
  | SmallLSFT | 16.13% | 27.55% |
  | LargeLSFT | 19.75% | 28.74% |

  Source: [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [Vendor research, arXiv v2 of 2026-06-12] RADAR automates the review of low-risk diffs. The funnel has eligibility gates, static heuristics, the Diff Risk Score, an LLM-based Automated Code Review, and deterministic validation. The Diff Risk Score is an ML model that predicts the probability of a production incident. The LLM review classifies changes as safe or as a risk. Auto-accept needs a confidence of 8 or more out of 10, all changes safe, and no risk signal. Source: [arXiv 2605.30208](https://arxiv.org/html/2605.30208)
- [Vendor research] RADAR reviewed 535,290 diffs, and 331,720 of them landed. The peak was about 25,000 diffs each day. The revert rate of RADAR diffs was 1 third of the rate of other diffs. The production incident rate was 1 fiftieth. The median review wall time was 35% lower. The paper also states a time to close "over 330%" lower, which is not a valid reduction. The paper says that the comparisons are not causal estimates, and it gives no precision for the LLM reviewer. Source: [arXiv 2605.30208](https://arxiv.org/html/2605.30208)

#### 2.11 cubic, an additional data point

- [Vendor, 2025-06-19] cubic made 3 changes to its review agent. First, the agent must state its reasoning before it gives feedback, and each finding has a logged reasoning field, a finding and a confidence. Second, cubic cut the tools to a simplified LSP and a basic terminal. Third, cubic split the work into micro-agents: Planner, Security, Duplication and Editorial. Result: 51% fewer false positives "without sacrificing recall", and the median number of comments for each PR decreased by half. Source: [cubic blog, "Learnings from building AI agents"](https://www.cubic.dev/blog/learnings-from-building-ai-agents)

#### 2.12 Independent cross-vendor evaluations

- [Independent, 2026-02-26] Martian Code Review Bench v0 has 2 parts. The offline part runs all tools on the same PRs against a curated gold set, built on datasets from Augment and Greptile. The online part collects data each day from tools in open-source repositories, and it tracks which comments developers act on. The benchmark has more than 200,000 PRs. "No tool found more than 63% of the known issues." Source: [Martian, "Code Review Bench: Towards Billion Dollar Benchmarks"](https://withmartian.com/post/code-review-bench-v0)
- [Independent, 2026-02-26] Martian caveats:
  - The gold set is incomplete. Some false positives were real issues, so precision is too low and recall is too high in the data.
  - The offline results and the online results do not agree.
  - A comment that a developer ignores is not always wrong.
  - Repositories that use a tool differ from other repositories, so raw acceptance rates are not comparable.
  Source: [Martian, "Code Review Bench: Towards Billion Dollar Benchmarks"](https://withmartian.com/post/code-review-bench-v0)
- [Secondary snapshot of the live Martian board, article of 2026-10-05] The article reads the board of the last month, ordered by F1, across 17,466 scored PRs:

  | Rank | Tool | F1 | Precision | Recall | Sample PRs |
  |---|---|---|---|---|---|
  | 1 | Cubic Dev AI | 65.5% | 72.4% | 59.8% | 1,551 |
  | 2 | Greptile | 62.3% | 80.5% | 50.8% | 1,564 |
  | 3 | GitHub Copilot | 61.5% | 66.8% | 57.0% | 925 |
  | 4 | Claude | 61.3% | 69.0% | 55.2% | 995 |
  | 5 | CodeRabbit | 61.0% | 68.6% | 55.0% | 2,084 |
  | 6 | Devin AI Integration | 60.7% | 75.1% | 50.9% | 678 |
  | 7 | Macroscope | 60.0% | 77.5% | 48.9% | 809 |
  | 8 | Qodo Code Review | 58.4% | 73.1% | 48.6% | 2,434 |
  | 9 | Cursor | 57.4% | 72.2% | 47.6% | 864 |
  | 10 | Kilo Code | 56.8% | 66.5% | 49.6% | 898 |
  | 14 | CodeAnt AI | 48.9% | 69.5% | 37.6% | not stated |

  The article criticizes the board: the F-beta value is adjustable from 0.5 to 3.0, the ranks depend on the LLM judge, the sample sizes differ, and the fixed 50-PR offline set can be in the data that trained the tools. Source: [aicodereviews.io](https://www.aicodereviews.io/blog/martians-code-review-bench-the-1-claim-rots-in-months/)
- [Independent, MSR 2026, arXiv of 2026-04-03] Chowdhury et al. studied PRs from the AIDev dataset that have code review agents. Among PRs in the "Commented" state, PRs with only agent reviews merged at 45.20%, 127 of 281. PRs with only human reviews merged at 68.37%, 804 of 1,176. Closure without merge was 34.88% against 21.60%. The chi-squared test gave 83.0319, with p < 0.001. Source: [arXiv 2604.03196](https://arxiv.org/pdf/2604.03196)
- [Independent, MSR 2026] In 98 closed PRs with only agent reviews, 60.2% had a signal ratio from 0% to 30%. The signal ratio is the share of comments with keywords for critical or important issues. 12 of 13 agents had an average signal ratio below 60%. Copilot had an average of 19.79% on 24 PRs. The method uses keywords, the samples are small, and the results are correlations. Source: [arXiv 2604.03196](https://arxiv.org/pdf/2604.03196)
- [Independent, arXiv v2 of 2026-04-25] Sun et al. studied 16 AI review actions on GitHub, with 22,326 AI comments in 178 repositories. Authors addressed 60.0% of human comments and 0.9% to 19.2% of AI comments. The tools that review each hunk had 6.5% to 19.2%. The tools that review each file had 0.9% to 4.2%. Manual triggers had 14.4% against 9.0% for automatic triggers, which is not significant overall. GPT-4 comments had 12.6% against 5.4% for GPT-3.5. Short comments with code snippets were more likely to be addressed. The tools are older open-source GitHub Actions, not the current commercial products. Source: [arXiv 2508.18771](https://arxiv.org/html/2508.18771v2)
- [Search snippet, independent, unconfirmed] An arXiv paper did a 50-PR external check against the offline track of Martian. It reports Haiku 4.5 at 32.6% precision, 41.2% recall and 36.4% F1, and Sonnet 4.6 at 27.1% F1. I did not read the paper. Source: [arXiv 2606.15689](https://arxiv.org/pdf/2606.15689)
- [Search snippet, unconfirmed date] The New Stack reports that the online board of Martian puts Cubic first with 64.9% F1. Source: [The New Stack](https://thenewstack.io/github-reviewbench-code-review/)

#### 2.13 Vendor-run cross-vendor benchmarks

- [Vendor-run benchmark, Greptile, July 2025, search snippet] Greptile used 50 real bugs from 5 open-source repositories: Sentry, Cal.com, Grafana, Keycloak and Discourse. The catch rates were Greptile 82%, 41 of 50; Cursor 58%; Copilot 54%; CodeRabbit 44%; Graphite 6%. A critic says that the score counts a PR as caught if the tool flagged at least 1 real bug in it. Source: [Greptile benchmarks](https://www.greptile.com/benchmarks)
- [Vendor-run benchmark, Augment, 2025-12-11, updated 2026-06-18] 50 PRs from Sentry, Grafana, Cal.com, Discourse and Keycloak, with a golden set that Augment corrected:

  | Tool | Precision | Recall | F-score |
  |---|---|---|---|
  | Augment Code Review | 65% | 55% | 59% |
  | Cursor Bugbot | 60% | 41% | 49% |
  | Greptile | 45% | 45% | 45% |
  | Codex Code Review | 68% | 29% | 41% |
  | CodeRabbit | 36% | 43% | 39% |
  | Claude Code | 23% | 51% | 31% |
  | GitHub Copilot | 20% | 34% | 25% |

  Source: [Augment blog](https://www.augmentcode.com/blog/we-benchmarked-7-ai-code-review-tools-on-real-world-prs-here-are-the-results)
- [Vendor claim about the Martian board, 2026-07-30, search snippet] Greptile says that it is first with 60.8% F1 and 76.2% precision. Source: [Greptile](https://www.greptile.com/content-library/greptile-martian-code-review-benchmark)

### Inferences

- [Inference] 3 vendors moved from a fixed pipeline to an agentic loop between fall 2025 and March 2026: Bugbot, Greptile v3 and Copilot. Each vendor reports a quality gain: Bugbot "the largest gains", Greptile an action rate from 34.75% to 59.24%, and Copilot 8.1% more positive feedback.
- [Inference] After the move to agents, Greptile v5, Qodo 2.0, cubic and Anthropic split the work into several narrow agents again. Narrow scope and parallel agents are now the common design.
- [Inference] The vendor "acted on" metrics of Bugbot and Greptile use an LLM judge. Only Cursor reports a check of the judge against the authors. A designer must check the judge, because judge errors move the main metric.
- [Inference] On the Martian snapshot, the top tools have precision from 66.8% to 80.5% and recall from 47.6% to 59.8%. So the best tools still miss about 40% to 50% of the known issues.
- [Inference] Vendor-run benchmarks rank the vendor first each time: Greptile in its benchmark, Augment in its benchmark, Qodo in its benchmark. The same tools have closer results on Martian.
- [Inference] In the CodeRabbit study, 56.3% of comments were rejected and 58.0% of these were invalid. So about 32.7% of all comments in that data were invalid suggestions.

### Gaps

- Graphite: I found no published precision. The numbers come from a talk with no sample sizes, and they are from March 2025. I found no data on the merge of Graphite Agent with Bugbot after the acquisition.
- Sourcery: I found no published metric of any kind. The suppression mechanism is unconfirmed.
- CodeRabbit: I found no vendor acceptance rate or precision. The definitions of the severity levels are not in the docs.
- Copilot: the docs give no severity levels and no cap. The denominator of the 5.1 average is not clear.
- CodeGuru Reviewer: I found no published precision. The product is in maintenance mode since November 2025. A third-party source names Amazon Q Developer as the successor. [Unconfirmed]
- Meta: I found no Meta paper on an LLM that posts bug comments with a measured precision. The published Meta work is about patches for human comments and the automatic approval of low-risk diffs.
- Martian: I could not read the live board directly, because the page needs JavaScript. The table comes from a secondary article.
- Qodo 2.0: the numbers for competitors are only in images.
- Beko study: I read only a search summary of the paper.

## 3. Which design choices do several systems share?

### Takeaway

The proven pattern has 8 parts: rules files plus repository context; several finders in parallel; a verification step; removal of duplicates and of low-value categories; a separate label or exclusion for pre-existing code; severity labels with a cap on minor comments; a result that does not block the merge; and an outcome metric that measures whether the author acted, with a feedback loop. Thumbs reactions are too rare to be the main metric.

### Cited Findings

#### 3.1 Several finders in parallel

- Claude Code Review: "several agents examine the diff and the surrounding code in parallel". Source: [Claude Code docs, "Code Review"](https://code.claude.com/docs/en/code-review)
- Code-review plugin: 4 agents in parallel, 2 for CLAUDE.md compliance and 2 for bugs. Source: [code-review.md, raw file](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- Bugbot, first design: 8 parallel passes, each with a random order of the diff. Source: [Cursor blog, "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)
- Qodo 2.0: specialized agents, each with its own context. Source: [Qodo blog, "Introducing Qodo 2.0"](https://www.qodo.ai/blog/introducing-qodo-2-0/)
- Greptile v5: a swarm of agents, each with 1 hypothesis. Source: [Greptile blog, "Greptile v5"](https://www.greptile.com/blog/greptile-v5)
- cubic: micro-agents for Planner, Security, Duplication and Editorial. Source: [cubic blog](https://www.cubic.dev/blog/learnings-from-building-ai-agents)
- Copilot Max level: "uses multiple high-reasoning models". Source: [GitHub docs, "About Copilot code review"](https://docs.github.com/en/copilot/concepts/agents/code-review)

#### 3.2 A verification step after the find step

- Claude Code Review: a Verify stage checks candidate findings against the code. Internally, a separate group of agents votes on each finding. Sources: [Claude Code docs, "Code Review"](https://code.claude.com/docs/en/code-review), [claude.dev blog](https://claude.dev/blog/solving-code-review-at-anthropic/)
- Anthropic security review: agents must write a proof that a finding is valid. Source: [Anthropic SDLC blog](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)
- Ultrareview: each finding is "independently reproduced and verified". Source: [Claude Code docs, ultrareview](https://code.claude.com/docs/en/ultrareview)
- Code-review plugin: Opus subagents validate bug findings. The earlier version used a Haiku score with a threshold of 80. Sources: [code-review.md](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md), [README.md](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/README.md)
- Bugbot, first design: a majority vote across passes, then a validator model. Source: [Cursor blog, "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)
- CodeRabbit: verification scripts with grep and ast-grep before each comment. Source: [CodeRabbit blog](https://www.coderabbit.ai/blog/how-coderabbit-delivers-accurate-ai-code-reviews-on-massive-codebases)
- Qodo: a self-reflection call scores each suggestion, and the Qodo 2.0 judge agent filters low-signal results. Sources: [reflect prompt](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/code_suggestions/pr_code_suggestions_reflect_prompts.toml), [Qodo 2.0](https://www.qodo.ai/blog/introducing-qodo-2-0/)
- Greptile v3: a higher threshold for "sureness", because the agent challenges its own hypotheses. Source: [Greptile v3](https://www.greptile.com/blog/greptile-v3-agentic-code-review)
- Meta MetaMateCR: builds, linters and tests validate each patch before an author sees it. Source: [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)

#### 3.3 Removal of duplicate findings

- Claude Code Review removes duplicates in the Rank stage. The Claude Code team also stopped repeats of posted findings. Sources: [Claude Code docs](https://code.claude.com/docs/en/code-review), [claude.dev blog](https://claude.dev/blog/solving-code-review-at-anthropic/)
- Bugbot put similar bugs in buckets and removed bugs from earlier runs. It reads PR comments to prevent duplicates. Sources: [Building a better Bugbot](https://cursor.com/blog/building-bugbot), [Bugbot docs](https://cursor.com/docs/bugbot)
- Qodo 2.0: the judge agent removes duplicates. Source: [Qodo 2.0](https://www.qodo.ai/blog/introducing-qodo-2-0/)
- Copilot groups repeated instances of the same pattern into 1 unit. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- PR-Agent: earlier findings count toward the cap, and the model must not restate them. Source: [pr_reviewer_prompts.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/pr_reviewer_prompts.toml)

#### 3.4 Severity levels and scores

| System | Levels | Source |
|---|---|---|
| Claude Code Review | Important, Nit, Pre-existing | [Claude Code docs](https://code.claude.com/docs/en/code-review-pull-requests) |
| CodeRabbit, IDE findings | Types: Nitpick, Potential issue, Refactor suggestion. Severities: Critical, Major, Minor, Trivial, Info | [CodeRabbit docs](https://docs.coderabbit.ai/ide/findings) |
| Qodo 2.0 | A severity and a quality dimension label, names not published | [Qodo 2.0](https://www.qodo.ai/blog/introducing-qodo-2-0/) |
| PR-Agent suggestions | Score 0 to 10. Config thresholds: high at 9, medium at 7 | [configuration.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/configuration.toml) |
| Sourcery | Labels such as `issue (bug_risk)` and `nitpick (performance)`, and 🚨 for security | [Sourcery docs](https://docs.sourcery.ai/reviews/anatomy-of-a-review/) |
| Bugbot | A `severity` field in the API, for example "high" and "medium", scale not defined | [Bugbot docs](https://cursor.com/docs/bugbot) |
| Greptile | No severity. Strictness 1 to 3 filters comments | [Greptile docs](https://www.greptile.com/docs/code-review/controlling-nitpickiness) |
| Copilot, Graphite | No severity levels in the docs | [GitHub docs](https://docs.github.com/en/copilot/concepts/agents/code-review), [Graphite docs](https://www.graphite.com/docs/ai-review-comments) |

#### 3.5 Caps and size limits

- PR-Agent: a maximum of 6 key issues for each review, and 3 code suggestions for each chunk, by default. Source: [configuration.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/configuration.toml)
- Local `/code-review`: a limit of 32 findings in the findings tool. A user can change it with `--max-findings`. Source: [Claude Code docs](https://code.claude.com/docs/en/code-review-local)
- Claude Code Review: no hard cap is documented. The docs example caps nits at 5 in REVIEW.md. Re-reviews post fewer nits and pre-existing findings. Sources: [Customize Code Review](https://code.claude.com/docs/en/code-review-customize), [Read and request reviews](https://code.claude.com/docs/en/code-review-pull-requests)
- Ultrareview: 500 changed files and 8,000 changed lines by default. Source: [ultrareview docs](https://code.claude.com/docs/en/ultrareview)
- Graphite: no analysis of PRs with more than 200,000 characters. Source: [Graphite docs](https://www.graphite.com/docs/ai-review-comments)
- Bugbot: a skip for PRs above the size limit, 30,000 characters for each rule and 100,000 characters for all rules. Source: [Bugbot docs](https://cursor.com/docs/bugbot)
- Sourcery: a maximum of 5 automatic re-reviews for each PR. Source: [Sourcery docs](https://docs.sourcery.ai/reviews/anatomy-of-a-review/)
- CodeRabbit `quiet` profile: it posts only the most important comments inline and moves the other comments to the summary. Source: [CodeRabbit docs](https://docs.coderabbit.ai/reference/configuration)

#### 3.6 Exclusion lists for low-value categories

- Code-review plugin: pre-existing issues, linter issues, pedantic nitpicks, and general quality concerns that CLAUDE.md does not require. Source: [code-review.md](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- PR-Agent: an automatic score of 0 for docstrings, type hints, comments, unused imports and more specific exception types. Source: [reflect prompt](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/code_suggestions/pr_code_suggestions_reflect_prompts.toml)
- Claude Code team: findings only about style, diagnostics or cleanup are dropped. Source: [claude.dev blog](https://claude.dev/blog/solving-code-review-at-anthropic/)
- Bugbot, first design: a filter for compiler warnings and documentation errors. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- REVIEW.md example: no report of anything that CI already enforces. Source: [Customize Code Review](https://code.claude.com/docs/en/code-review-customize)

#### 3.7 Only issues that the PR introduced

- PR-Agent: "only on issues introduced by this PR". Source: [pr_reviewer_prompts.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/pr_reviewer_prompts.toml)
- Code-review plugin: excludes pre-existing issues. Source: [code-review.md](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/code-review/commands/code-review.md)
- Claude Code Review: posts pre-existing bugs with a separate 🟣 label. Source: [Claude Code docs](https://code.claude.com/docs/en/code-review-pull-requests)
- AutoCommenter: removed the 80% of comments that fell on unchanged lines. Source: [arXiv 2405.13565](https://arxiv.org/html/2405.13565)

#### 3.8 Rules files in the repository, and the branch they come from

- Claude Code Review: CLAUDE.md and REVIEW.md. REVIEW.md comes from the base branch or the default branch. Source: [Customize Code Review](https://code.claude.com/docs/en/code-review-customize)
- Bugbot: `BUGBOT.md`, plus `bugbot.yaml` from the base branch. Source: [Bugbot docs](https://cursor.com/docs/bugbot)
- Copilot: `copilot-instructions.md`, `*.instructions.md` and `AGENTS.md`, read from the head branch. Source: [GitHub docs](https://docs.github.com/en/copilot/concepts/agents/code-review)
- CodeRabbit: `path_instructions` and `code_guidelines` in `.coderabbit.yaml`. Source: [CodeRabbit docs](https://docs.coderabbit.ai/reference/configuration)
- PR-Agent: flags a rule violation only when the rule explicitly covers the changed code, and names the rule file. Source: [pr_reviewer_prompts.toml](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/pr_agent/settings/pr_reviewer_prompts.toml)

#### 3.9 Feedback loops

- Greptile: embeddings of upvoted, downvoted and addressed comments for each team, with a block at 3 similar downvotes. Source: [Greptile blog](https://www.greptile.com/blog/make-llms-shut-up)
- Bugbot: candidate rules from reactions, replies and human comments, with promotion and disable steps. Source: [Bugbot learning](https://cursor.com/blog/bugbot-learning)
- CodeRabbit: Learnings from developer replies. Source: [CodeRabbit blog](https://www.coderabbit.ai/blog/how-coderabbit-delivers-accurate-ai-code-reviews-on-massive-codebases)
- Google: heuristics from "not helpful" feedback, and the suppression of best-practice URLs in AutoCommenter. Sources: [Google Research blog](https://research.google/blog/resolving-code-review-comments-with-ml/), [arXiv 2405.13565](https://arxiv.org/html/2405.13565)
- Graphite: evals from accepted and rejected comments. Source: [Braintrust case study](https://www.braintrust.dev/blog/graphite)
- Copilot: memory across reviews and Copilot Memory. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)

#### 3.10 Outcome metrics that measure whether the author acted

| System | Metric name | Definition | Source |
|---|---|---|---|
| Bugbot | Resolution rate | An AI decides at merge which flagged bugs the author resolved | [Building a better Bugbot](https://cursor.com/blog/building-bugbot) |
| Greptile | Address rate, action rate, comments addressed | Share of comments that the author addresses. An LLM judge decides | [Greptile v4](https://www.greptile.com/blog/greptile-v4) |
| Graphite | Acceptance rate | A comment that leads to a code change | [Graphite docs](https://www.graphite.com/docs/ai-review-comments) |
| Copilot | Resolution before merge, plus thumbs reactions | Whether the author resolves the flagged issue before merge | [GitHub blog](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/) |
| Anthropic | Substantive review comments; the response of the author | Share of PRs with substantive comments; fixed, wrong, intentional, did not matter | [claude.dev blog](https://claude.dev/blog/solving-code-review-at-anthropic/) |
| Google | Applied edits | Share of previewed suggested edits that authors apply | [Google Research blog](https://research.google/blog/resolving-code-review-comments-with-ml/) |
| Meta | ActionableToApplied | Share of actionable comments where the author applies the AI patch | [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1) |

- Thumbs reactions are rare. Graphite reports that less than 4% of comments got a reaction. AutoCommenter got explicit feedback on about 10% of review comments. Sources: [CS146S summary](https://fireman333.github.io/CS146S-handbook-zh/readings/w7_lessons_from_millions_of_ai_code_reviews/), [arXiv 2405.13565](https://arxiv.org/html/2405.13565)

#### 3.11 Silence and non-blocking results

- Copilot posts no comment in 29% of reviews. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- Claude Code Review posts a note when it finds no issues, and its check run never fails. Source: [Claude Code docs](https://code.claude.com/docs/en/code-review)
- Bugbot concludes as neutral by default when it has findings. Source: [Bugbot docs](https://cursor.com/docs/bugbot)
- By default, Copilot reviews do not count toward required approvals. Source: [GitHub docs](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Sourcery fails its check only for blocking security findings. Source: [Sourcery docs](https://docs.sourcery.ai/reviews/anatomy-of-a-review/)

#### 3.12 Published comment volume and catch numbers

- Claude Code Review: an average of 7.5 issues on PRs above 1,000 lines, and 0.5 issues on PRs below 50 lines. Source: [Anthropic blog](https://claude.com/blog/code-review)
- Copilot: about 5.1 comments per review, and no comment in 29% of reviews. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- Bugbot: 0.7 bugs flagged per run and about 0.5 resolved bugs per PR, in January 2026. Source: [Building a better Bugbot](https://cursor.com/blog/building-bugbot)
- Greptile v4: 1.60 addressed comments per PR. Source: [Greptile v4](https://www.greptile.com/blog/greptile-v4)
- Greptile in 2024: up to 10 comments on a PR with 20 changes, before the filter. Source: [Greptile blog](https://www.greptile.com/blog/make-llms-shut-up)
- AutoCommenter: comments on 1.3% to 3.9% of changed files, related to the decode method. Source: [arXiv 2405.13565](https://arxiv.org/html/2405.13565)

### Inferences

These are the parts that a designer can copy. Each part has support from 2 or more systems. [Inference]

1. Find broadly, then filter late. Qodo says that recall cannot be recovered after the find step. Bugbot got more bugs and a higher resolution rate when it made the finder more aggressive and kept a validator.
2. Verify each finding with evidence from the code, not with a self-score alone. Greptile found that a severity score from an LLM judge was "nearly random". AutoCommenter found 1 global threshold too strict and changed to 1 threshold for each category. Anthropic replaced the Haiku score in its plugin with Opus validation.
3. Use several narrow finders in parallel, and use a vote or a judge to merge their output.
4. Remove duplicate findings in the run and across runs. Group repeated instances of 1 pattern into 1 comment.
5. Keep a list of categories that the reviewer never reports: linter issues, style, docstrings, type hints, and anything that CI enforces.
6. Separate issues that the PR introduced from pre-existing issues. Post pre-existing issues with a separate label, or not at all.
7. Use few severity levels. Cap the minor level, not the bug level.
8. Let the review be silent when it finds nothing, and do not block the merge.
9. Read the review rules from the base branch, so that a PR cannot change its own review rules. Anthropic and Bugbot do this. Copilot reads from the head branch.
10. Measure whether the author acted, with an LLM judge at merge time, and check the judge against people. Report a count per PR together with the rate, because a reviewer that posts fewer comments can show a higher rate.
11. Learn from negative feedback by category or by similarity, with a minimum number of votes before a suppression.
12. On re-review, review only the new diff, post no repeats, and cap the number of rounds.

### Gaps

- No vendor publishes a full pipeline with all thresholds. The open-source plugin and PR-Agent are the only complete, readable pipelines that I found.
- I found no published comparison of severity schemes, for example 3 levels against 5 levels.
- I found no controlled study of the effect of a cap on comments.

## 4. Which systems changed their design after user feedback, and why?

### Takeaway

Almost each vendor cut noise after early releases, because users rejected too many minor or wrong comments. Later, Bugbot found the opposite problem: an agent that was too cautious missed bugs. The fix was a more aggressive finder with a separate verification step, and an outcome metric that counts both resolved bugs and the resolution rate.

### Cited Findings

- [Vendor research, 2023-05-23] Google, ML-suggested edits. Users did not find the feature, so Google added a "Show ML-edit" button, and the preview rate went from about 20% to about 40%. Local changes made many suggestions inapplicable, so Google added a 3-way merge in the IDE. "Not helpful" feedback showed repeated failure patterns, so Google added heuristics at serving time to remove them. Source: [Google Research blog](https://research.google/blog/resolving-code-review-comments-with-ml/)
- [Vendor research, 2022 to 2023] Google, AutoCommenter. The useful ratio stopped at about 54%, below the target of 80%. Google suppressed 17 non-actionable best-practice URLs, then 5 more, and changed to 1 threshold for each URL. The useful ratio from developers went from 54% to 66%. The paper says: "Even a few negative user experiences can erode trust." Source: [arXiv 2405.13565](https://arxiv.org/html/2405.13565)
- [Vendor, 2024-12-18] Greptile. 79% of comments were nits. Prompts and an LLM severity judge did not fix this. A filter with embeddings of team feedback increased the address rate from 19% to more than 55% in 2 weeks. Source: [Greptile blog](https://www.greptile.com/blog/make-llms-shut-up)
- [Vendor, speaker-reported, 2025] Graphite. Thumbs reactions were too rare, so Graphite measures whether the author changes code. Wrong comments eroded trust, and correct but unwanted comments, for example "add test", got rejected. After "substantial tuning", Diamond reached about 52% acceptance in March 2025. Sources: [AI Engineer talk page](https://ai.engineer/talks/don-t-get-one-shotted-use-ai-to-test-review-merge-and-deploy-code-tomas-reimers-graphite), [CS146S summary](https://fireman333.github.io/CS146S-handbook-zh/readings/w7_lessons_from_millions_of_ai_code_reviews/)
- [Vendor, 2025-06-19] cubic. The agent mistook style issues for critical bugs and repeated linter suggestions. cubic made the agent state its reasoning first, cut the tools, and split the work into micro-agents. False positives decreased by 51%, and the median number of comments for each PR decreased by half. Source: [cubic blog](https://www.cubic.dev/blog/learnings-from-building-ai-agents)
- [Vendor research, 2025] Meta, MetaMateCR. When reviewers saw AI patches, time in review increased by 5.5%. Meta then showed the patches only to authors, and review time had no significant regression. The paper asks "should reviewers take on the responsibility of fixing authors' code?" and suggests "perhaps not". Source: [arXiv 2507.13499](https://arxiv.org/html/2507.13499v1)
- [Vendor, July 2025 to April 2026] Cursor Bugbot:
  - Version 1 was tuned to keep false positives low, with 8 passes, a vote and a validator.
  - In fall 2025, the agentic version was "too cautious", so Cursor made the prompts more aggressive.
  - Bugs flagged per run went from 0.4 to 0.7, and the resolution rate went from 52% to more than 70%.
  - In April 2026, Cursor added learned rules from reactions, replies and missed issues. The resolution rate reached 78.13%.
  Sources: [Building a better Bugbot](https://cursor.com/blog/building-bugbot), [Bugbot learning](https://cursor.com/blog/bugbot-learning)
- [Vendor, November 2025 to August 2026] Greptile. v3 replaced the fixed pipeline with an agentic loop that can challenge its own hypotheses. v4 claims "a far lower false positive rate". v5 changed to a swarm of narrow agents, which cut the median review time from 5:04 to 2:25. Sources: [Greptile v3](https://www.greptile.com/blog/greptile-v3-agentic-code-review), [Greptile v4](https://www.greptile.com/blog/greptile-v4), [Greptile v5](https://www.greptile.com/blog/greptile-v5)
- [Vendor, October 2025 to March 2026] GitHub Copilot. Survey responses and reactions caused GitHub to stop the pin of comments to single lines. GitHub added multi-line comments, groups for repeated patterns, and silence when there is nothing actionable. The goal changed from thoroughness to high signal. GitHub accepted 16% more latency for 6% more positive feedback. Source: [GitHub blog](https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/)
- [Vendor, 2026-02-04] Qodo. Qodo names "Too much noise from low impact comments" as a core problem. Qodo 2.0 added specialized agents and a judge agent that filters low-signal results. Source: [Qodo 2.0](https://www.qodo.ai/blog/introducing-qodo-2-0/)
- [Vendor, March to October 2026] Anthropic:
  - Preview teams asked for reviews that are "quieter, sized to each change, and faster". The general availability release made reviews about 3 times faster and added the Quick, Standard and Deep levels.
  - Internally, the team dropped findings about style, diagnostics and cleanup after A/B tests.
  - After 1 PR went through more than 50 rounds, the team added a cap of 3 rounds, re-review of only the diff, a rule to flag the class of bug, and no repeats.
  - Re-reviews now post fewer nits and pre-existing findings, and they count what they did not post.
  Sources: [Anthropic GA post](https://claude.com/blog/code-review-is-now-generally-available), [claude.dev blog](https://claude.dev/blog/solving-code-review-at-anthropic/), [Claude Code docs](https://code.claude.com/docs/en/code-review-pull-requests)
- [Vendor docs, July 2026] Anthropic changed `@claude review` so that it no longer subscribes the PR to reviews on each push. The docs give no reason. Source: [Claude Code docs](https://code.claude.com/docs/en/code-review-pull-requests)
- [Primary repo, 2026-10-26] Anthropic replaced the plugin command. The new command validates findings with Opus and Sonnet subagents in place of the earlier score threshold of 80. The commit gives no reason. Source: [GitHub API, commits](https://api.github.com/repos/anthropics/claude-plugins-official/commits?path=plugins/code-review/commands/code-review.md)
- [Vendor docs, current] CodeRabbit offers a `quiet` profile that moves minor comments into the summary, and it stores Learnings to stop repeated false positives. I found no date for the `quiet` profile. Sources: [CodeRabbit docs](https://docs.coderabbit.ai/reference/configuration), [CodeRabbit blog](https://www.coderabbit.ai/blog/how-coderabbit-delivers-accurate-ai-code-reviews-on-massive-codebases)

### Inferences

- [Inference] The first fix for noise was a filter: embeddings at Greptile, URL suppression at Google, category filters at Bugbot and Anthropic. The second fix was architecture: agents that verify, and narrow parallel agents.
- [Inference] There are 2 directions of failure. A noisy reviewer loses trust: Greptile in 2024, Graphite, AutoCommenter. A cautious reviewer misses bugs: the early agentic Bugbot. A designer needs metrics for both directions, for example resolved bugs per PR together with the resolution rate.
- [Inference] A rate alone can mislead. A reviewer that posts fewer comments can show a higher rate. Bugbot and Greptile report a count per PR together with the rate.
- [Inference] Convergence across rounds is a new design target. When agents write and fix code in loops, an unbounded reviewer can keep a PR open for a long time, as the Anthropic example of more than 50 rounds shows.
- [Inference] Who sees an AI output matters. Meta found a cost when reviewers saw AI patches, and Graphite and Anthropic found that wrong comments cost trust.

### Gaps

- Most vendors do not publish the details of their A/B tests, for example sample sizes, time windows or statistical tests.
- Anthropic did not publish the reasons for the change of `@claude review` in July 2026 or for the rewrite of the plugin in October 2026.
- I found no published design changes for Graphite after the acquisition by Cursor, for Sourcery, or for CodeGuru Reviewer before its maintenance mode.
