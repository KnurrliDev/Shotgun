# LLMs and LLM agents for concurrency and memory-safety bugs in C and C++, alone and with static or dynamic analysis

The searches ran on 2026-11-17. Each finding has a tag for its source type:

- [Peer-reviewed]: an academic paper from a peer-reviewed venue.
- [Preprint]: an academic paper without peer review when I read it.
- [Industry]: a paper or report by a company about its own internal tool.
- [Practitioner]: a report from an independent person.
- [Organizer]: data from the organizer of a competition.
- [Vendor claim]: a claim by a company about its own model or product. Nobody outside the company checked it.
- [Project claim]: a self-reported number from an open-source project.
- [Extract]: the number comes from a search-engine extract of the primary source, not from my full read of it.
- [UNCONFIRMED]: I could not confirm the statement in a primary source, or the sources do not agree.

## 1. How accurate are LLMs at data race and deadlock detection, and which prompt or agent designs help?

### Takeaway
On small OpenMP and pthread programs, GPT-4 gave a correct race verdict at an F1 near a dynamic tool, but it could not name the racy variable pair (F1 0.19). On SV-COMP pthread programs, 5 models gave no true deadlock positive, and most models said "race" for almost all programs. I found no published 2025 or 2026 benchmark of current reasoning models on DataRaceBench or on deadlocks.

### Cited Findings

#### Independent results

- DRB-ML dataset: it has 201 entries from DataRaceBench v1.4.1, 1 entry for each C or C++ OpenMP microbenchmark. Each entry has labels for the race pairs, the variables, the line numbers and the read or write operations. Source: [Chen et al., arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505) and [DataRaceBench V1.4.1 and DRB-ML V0.1, arXiv 2308.08473](https://arxiv.org/pdf/2308.08473). [Preprint, LLNL]
- The tests used the 198 DRB-ML entries below 4k tokens. About 50.5% of these entries have a race. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- Race verdict (yes or no) on DRB-ML, GPT-4 with 3 prompts: F1 0.751 to 0.757, recall 0.77 to 0.78, precision 0.722 to 0.736. Intel Inspector, a dynamic tool: F1 0.762, recall 0.889, precision 0.667. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- Race verdict on DRB-ML, other models: GPT-3.5 F1 0.575 to 0.619. Llama2-7b F1 0.586 to 0.597. StarChat-beta F1 0.541 to 0.563. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- Race pair task on DRB-ML: the model must also give the variable pair, the line numbers and the read or write type. GPT-4 F1 0.193 (recall 0.14, precision 0.311). GPT-3.5 F1 0.145. StarChat-beta F1 0.081. Llama2-7b F1 0.059. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- Fine-tuning on DRB-ML, 5-fold cross-validation: the race verdict F1 of StarChat-beta went from 0.546 to 0.598, and of Llama2-7b from 0.584 to 0.586. The race pair F1 of StarChat-beta went from 0.081 to 0.083 only. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- Prompt design on DRB-ML: a short basic prompt gave F1 0.597 with GPT-3.5. A multi-task prompt gave F1 0.435. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- The DRB-ML authors conclude that LLMs are a possible approach. They also conclude that LLMs do not beat traditional tools when the task needs the exact variable pair. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- SV-COMP study setup: Jain and Purandare tested GPT-3.5-turbo, GPT-4, GPT-4o, GPT-4o-mini and Mistral Large2. They used 34 SV-COMP pthread programs of 39 to 172 lines and 25 litmus tests. Nidhugg and ESBMC gave the ground truth. Source: [arXiv 2501.14326v2](https://arxiv.org/html/2501.14326v2). [Preprint, v2 of September 2025]
- Data races on the 34 SV-COMP programs: GPT-4 accuracy 0.76, precision 0.50, recall 0.88, F1 0.64. Mistral Large2 accuracy 0.62, precision 0.38, recall 1.00, F1 0.55. Source: [arXiv 2501.14326v2](https://arxiv.org/html/2501.14326v2). [Preprint]
- Data races on the same programs, weaker results: GPT-4o and GPT-4o-mini had accuracy 0.24, precision 0.24, recall 1.00, F1 0.38. GPT-3.5-turbo had accuracy 0.21, precision 0.21, recall 1.00, F1 0.34. Source: [arXiv 2501.14326v2](https://arxiv.org/html/2501.14326v2). [Preprint]
- Deadlocks on the 34 SV-COMP programs: Table 4 gives precision, recall and F1 of 0 for all 5 models, because no model gave a true positive. Accuracy went from 0.06 (GPT-3.5-turbo) to 0.94 (GPT-4). Source: [arXiv 2501.14326v2](https://arxiv.org/html/2501.14326v2). [Preprint]
- [UNCONFIRMED] I could not find the number of programs with a real deadlock in this set. The abstract says that GPT-4, GPT-4o and Large2 identify deadlocks effectively, and this statement does not agree with Table 4. Source: [arXiv 2501.14326](https://arxiv.org/abs/2501.14326).
- Failure modes in the Jain and Purandare study: 3 models reported a race in race-free code with atomics (the CoRW test). Some models reported a livelock instead of a deadlock. The answers were long and mixed correct and incorrect content. Source: [arXiv 2501.14326v2](https://arxiv.org/html/2501.14326v2). [Preprint]
- Relaxed memory models: on the TSO and PSO litmus tests, GPT-4 had the best accuracy (0.72) and F1 (0.80). The models rarely gave a feasible trace with reordered instructions. Source: [arXiv 2501.14326v2](https://arxiv.org/html/2501.14326v2). [Preprint]
- ConCovUp: a multi-agent LLM system makes test drivers for concurrency testing of 9 C and C++ libraries. Static analysis finds the shared-memory accesses and their calling contexts. LLM backward tracing finds inputs that reach hard accesses. Source: [arXiv 2605.09573](https://arxiv.org/abs/2605.09573). [Preprint, May 2026]
- ConCovUp result: the average coverage of shared-memory access pairs went from 36.6% with a general Claude Code agent to 68.1%. The abstract gives no count of races found and no model name. Source: [arXiv 2605.09573](https://arxiv.org/abs/2605.09573). [Preprint]
- CIR+CVN: an LLM writes a concurrency intermediate representation from a specification, not from source code. A Petri net then does an exhaustive check for deadlock and signal loss on 9 bounded-concurrency patterns. Source: [arXiv 2604.09318](https://arxiv.org/abs/2604.09318). [Preprint, April 2026]
- [UNCONFIRMED] A search extract says that CIR+CVN detected all 5 definite bugs with the correct bug kind. The abstract that I read does not give this number. Source: [arXiv 2604.09318](https://arxiv.org/html/2604.09318).
- A real concurrency bug found by an LLM: o3 found CVE-2025-37899, a use-after-free in ksmbd, the SMB server of the Linux kernel. Source: [Heelan, May 2025](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]
- Mechanism of CVE-2025-37899: a second connection can bind to the same session. A worker on 1 connection uses `sess->user` while the logoff handler on the other connection frees it. The logoff path waits only for requests on its own connection. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]
- Heelan's prompt asked for use-after-free bugs and gave a short overview of the ksmbd architecture and threat model. It told the model to prefer "no bug" to a false positive. By my read, the prompt did not describe the thread model, so o3 found the cross-connection race by its own reasoning. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]
- Concurrency bug reports, not code: Shao, Xiao and Yu classified issue reports in 12 projects with 10,920 reports. Fine-tuned pre-trained language models with 58 linguistic patterns had the best precision: 91% on GitHub and 93% on Jira. Source: [arXiv 2601.16338](https://arxiv.org/abs/2601.16338v1). [Preprint, January 2026]
- [UNCONFIRMED] A search extract of the same paper says that prompted LLMs could not separate true concurrency reports from reports that only use concurrency words. Source: [arXiv 2601.16338](https://arxiv.org/html/2601.16338v1).

#### Vendor and project claims

- Sashiko, an agentic reviewer for Linux kernel patches, has a separate locking stage. This stage looks for concurrency issues, deadlocks, RCU rule violations and thread-safety problems. The project gives no numbers for this stage alone. Source: [Sashiko README](https://github.com/sashiko-dev/sashiko). [Project claim]
- Chris Mason's kernel review prompts give the model compact definitions of locking knowledge, for example when to use spinlocks, to cut the token cost. Source: [LWN, Reviewing kernel patches with LLMs](https://lwn.net/Articles/1073583/). [Practitioner]

### Inferences
- The race verdict and the race pair are different tasks. LLMs did the verdict at near-tool level on microbenchmarks, but they failed to localize the pair. A static engine that gives the pair removes the step where LLMs are weakest.
- Recall 1.00 with precision 0.21 to 0.24 means that GPT-3.5-turbo, GPT-4o and GPT-4o-mini said "race" for almost all SV-COMP programs. An LLM alone is not a usable race oracle.
- The false races on code with atomics show that the LLM needs explicit facts about atomics, memory order and happens-before edges.
- Deadlock detection should come from the lock-order graph of the static engine. The LLM can then judge if a given cycle is feasible. This is my inference from the zero true positives in the SV-COMP study.
- DataRaceBench is an old public benchmark. By my knowledge it is from 2017, but I did not check this date in these searches. The DRB-ML programs can be in the training data of the models, so the verdict numbers can be too high. No source tested this.
- The DRB-ML and SV-COMP numbers come from GPT-4-class models of 2023 to 2025. The ksmbd result shows that a 2025 reasoning model can find a real cross-thread use-after-free, but only in 1 to 8 of 100 runs (see section 2).

### Gaps
- I found no 2025 or 2026 DataRaceBench or DRB-ML results for reasoning models such as o3, GPT-5, Claude 4.x or Gemini 2.5 and 3.
- I found no LLM benchmark for deadlocks in real C or C++ code. The only data are the small SV-COMP programs.
- I found no LLM numbers for atomicity violations or order violations in C or C++.
- "Detecting Data Races in OpenMP with Deep Learning and Large Language Models" (ACM, August 2024) used GPT-4 Turbo with prompt engineering and fine-tuning. I did not find its numbers.

## 2. How accurate are LLMs at finding use-after-free, buffer overflows, null dereferences and lifetime bugs in C and C++, and what are the problems of the benchmarks?

### Takeaway
On realistic, deduplicated function-level data (PrimeVul), LLM detection is near or below random guess. On small synthetic C programs, LLMs do well, but accuracy falls as the code grows. Repository-level agents with validation find real memory-safety bugs, but the hit rate per run is low. The common benchmarks have many wrong labels, many duplicates, and functions that cannot be judged without context.

### Cited Findings

#### Independent results

- PrimeVul (Ding et al., ICSE 2025): StarCoder2 had F1 68.26% on BigVul and F1 3.09% on PrimeVul. Source: [arXiv 2403.18624](https://arxiv.org/abs/2403.18624). [Peer-reviewed] [Extract]
- PrimeVul pair test: the model must label both the vulnerable function and its patched version correctly (P-C). GPT-4 with two-shot prompts got P-C 5.14%. With chain-of-thought prompting, GPT-4 got 12.94%. The random-guess baseline got 22.70%. Source: [PrimeVul PDF](https://arxiv.org/pdf/2403.18624). [Peer-reviewed] [Extract]
- SecLLMHolmes (Ullah et al., IEEE S&P 2024): 8 LLMs, 228 code scenarios, 8 vulnerability types in C and Python. All models changed their answers over runs. All models had a high false-positive rate and flagged patched code as still vulnerable. Source: [arXiv 2312.12575](https://arxiv.org/abs/2312.12575v2). [Peer-reviewed] [Extract]
- SecLLMHolmes robustness: simple changes, such as whitespace, function names or related library functions, changed the answers. The reasons were often wrong when the answer was correct. The LLMs failed on real-world projects. Source: [arXiv 2312.12575](https://arxiv.org/pdf/2312.12575). [Peer-reviewed] [Extract]
- [UNCONFIRMED] A secondary summary gives error rates of 26% for PaLM2 and 17% for GPT-4 after code augmentations. I did not find these numbers in the paper. Source: [arXiv 2312.12575](https://arxiv.org/abs/2312.12575v2).
- CASTLE (Dubniczky et al., 2025): 250 compilable C micro-benchmarks with 1 CWE each, 25 CWEs in total. The study compared 13 static analyzers, 10 LLMs and 2 formal verification tools. Version 1 says 11 analyzers and 11 LLMs. Source: [arXiv 2503.09433](https://arxiv.org/pdf/2503.09433). [Preprint] [Extract]
- CASTLE results: the LLMs did very well on small snippets, but their accuracy fell and their hallucinations increased as the code size increased. The static analyzers had many false positives. ESBMC had few false positives but missed CWEs outside model checking. Source: [arXiv 2503.09433](https://arxiv.org/pdf/2503.09433). [Preprint] [Extract]
- "Top Score on the Wrong Exam" (Risse, Liu and Böhme, ISSTA 2025, Distinguished Paper): for more than 90% of functions in the most used datasets, nobody can decide the vulnerability without more context. Source: [arXiv 2408.12986](https://arxiv.org/abs/2408.12986v2). [Peer-reviewed] [Extract]
- The same paper: 9 of 10 papers of the last 5 years define vulnerability detection as binary classification of single functions. Models can get high scores from word counts only. Source: [arXiv 2408.12986](https://arxiv.org/abs/2408.12986v2). [Peer-reviewed] [Extract]
- Data quality (Croft, Babar and Kholoosi, ICSE 2023): 20% to 71% of the vulnerability labels in real-world datasets were not accurate. 17% to 99% of the data points were duplicates. Source: [arXiv 2301.05456](https://arxiv.org/pdf/2301.05456). [Peer-reviewed] [Extract]
- [Extract] Secondary sources give the label accuracy of Big-Vul as 0.543 and of Devign as 0.8, from the same paper. Source: [arXiv 2301.05456](https://arxiv.org/pdf/2301.05456).
- [UNCONFIRMED] A survey cites false-positive labels of 61% in Big-Vul and 50% in Devign from random samples by Risse and Böhme. I did not read the primary source. Source: [survey, arXiv 2412.11194](https://arxiv.org/pdf/2412.11194).
- CyberGym (UC Berkeley, ICLR 2026): 1,507 tasks from real vulnerabilities in 188 OSS-Fuzz projects. The agent gets a text description and the code, and it must write a proof-of-concept input that triggers the bug. Source: [arXiv 2506.02548](https://arxiv.org/pdf/2506.02548v2). [Peer-reviewed] [Extract]
- CyberGym results in the paper: the best agent and model pairs reached about 20%. Some agent frameworks reached 2.0% or less. Source: [arXiv 2506.02548](https://arxiv.org/pdf/2506.02548v2). [Peer-reviewed] [Extract]
- CyberGym discovery run with OpenHands, codebase only, 431 projects and 1,748 executables: GPT-4.1 caused 16 crashes and 7 confirmed zero-days. GPT-5 caused 56 crashes and 22 confirmed zero-days. 4 zero-days overlap. Source: [CyberGym blog](https://rdi.berkeley.edu/blog/cybergym/). [Blog of the authors of a peer-reviewed paper] [Extract]
- CyberGym later totals: 35 zero-days and 17 incomplete historical patches, with 3 CVEs. Earlier versions give smaller counts. Source: [arXiv 2506.02548](https://arxiv.org/pdf/2506.02548v2). [Extract]
- ksmbd benchmark, CVE-2025-37778, a use-after-free in Kerberos session setup, with about 3.3k lines (about 27k tokens) of code: o3 found it in 8 of 100 runs. Claude Sonnet 3.7 found it in 3 of 100 runs. Claude Sonnet 3.5 found it in 0 of 100 runs. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]
- In the same 100 o3 runs, the blog gives 66 "no bug" answers and 28 false-positive reports. [UNCONFIRMED] 8, 66 and 28 add up to 102, and I could not explain this. A secondary source gives 23 false positives. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/).
- ksmbd with about 12k lines (about 100k tokens), all command handlers: o3 found CVE-2025-37778 in 1 of 100 runs. The signal-to-noise ratio was about 1 to 50. The 100 runs cost about $116. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]
- Heelan's conclusion: o3 can often help on problems with less than 10k lines of code. It also gives much nonsense, so the user must have a mechanism to verify the output. He compares the LLM to a fuzzer that samples from a distribution. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]
- RepoAudit (Guo et al., ICML 2025): an LLM agent audits C and C++ repositories for null pointer dereference, memory leak and use-after-free. A validator checks the data-flow facts and the satisfiability of the path conditions. Source: [arXiv 2501.18160](https://arxiv.org/abs/2501.18160v2). [Peer-reviewed] [Extract]
- RepoAudit results: 40 true bugs in 15 benchmark projects at a precision of 78.43%. An earlier version gave 38 bugs and 65.52%. The average cost was 0.44 hours and $2.54 for each project. Source: [ICML 2025 poster](https://icml.cc/virtual/2025/poster/45170). [Peer-reviewed] [Extract]
- RepoAudit found 185 new bugs in 9 open-source projects, and developers confirmed or fixed 174. Source: [arXiv 2501.18160](https://arxiv.org/abs/2501.18160v2). [Peer-reviewed] [Extract]
- Bug classes in an industry triage study (Tencent, C and C++): null pointer dereference was the hardest class and divide-by-zero the easiest. The cases that all methods missed had functions about 95.6 lines longer than average and about 21 more conditional statements. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed, ICSE SEIP 2026, industry data]
- A simple C++ use-after-free from novice code: all tested GPT, Llama and Claude models found it. The test did not use lambda captures. Source: [arXiv 2508.16419](https://arxiv.org/pdf/2508.16419). [Preprint] [Extract]
- Clang Lifetime Safety Analysis warns about use-after-scope and use-after-free. Without lifetime annotations, it treats function calls optimistically, so it can miss dangling pointers. Source: [Clang documentation](https://clang.llvm.org/docs/LifetimeSafety.html). [Tool documentation] [Extract]
- A lambda that captures by reference and escapes its scope compiles without a warning in GCC and Clang. This source is not an LLM study. Source: [PVS-Studio](https://pvs-studio.com/en/blog/posts/cpp/1156/). [Extract]

#### Vendor claims

- Anthropic says that Claude Opus 4.6 found and validated more than 500 high-severity vulnerabilities in open-source code, for example in Ghostscript, OpenSC and CGIF. The model worked in a virtual machine with standard tools and fuzzers, without a custom harness. Source: [Anthropic red team, February 2026](https://red.anthropic.com/2026/zero-days/). [Vendor claim]
- Anthropic and Mozilla: Claude Opus 4.6 found 22 Firefox vulnerabilities in 2 weeks, in about 6,000 C++ files, with 112 unique reports. Mozilla rated 14 as high severity. Source: [Anthropic](https://www.anthropic.com/news/mozilla-firefox-security). [Vendor claim, with the severity rating from Mozilla]
- In the Firefox work, the model made a working exploit in only 2 cases from several hundred tries. These exploits worked only with some browser protections disabled. Source: [Anthropic](https://www.anthropic.com/news/mozilla-firefox-security). [Vendor claim]
- Claude Mythos Preview, April 2026: Anthropic reports about 83% on CyberGym, against about 67% for Claude Opus 4.6. Secondary sources give 83.1% and 66.6%. Source: [Anthropic red team](https://red.anthropic.com/2026/mythos-preview/). [Vendor claim] [Extract]
- Anthropic says that Mythos Preview found a 27-year-old OpenBSD bug. It also says that the model found and exploited a FreeBSD NFS remote code execution bug, CVE-2026-4747, autonomously. Source: [Anthropic red team](https://red.anthropic.com/2026/mythos-preview/). [Vendor claim] [Extract]
- Anthropic says that Project Glasswing partners found more than 10,000 high-severity or critical vulnerabilities with Mythos Preview. It says that the bottleneck is now verification, disclosure and patches. Source: [Glasswing update](https://www.anthropic.com/news/glasswing-initial-update). [Vendor claim] [Extract]
- OpenAI says that Aardvark, a GPT-5 agent, found 92% of the known and synthetic vulnerabilities in "golden" test repositories. Aardvark became Codex Security in March 2026. Source: [OpenAI](https://openai.com/index/introducing-aardvark). [Vendor claim] [Extract]

### Inferences
- Function-level benchmark scores such as BigVul and Devign overstate the ability of LLMs. Paired tests (PrimeVul), executable checks (CyberGym) and audits of real repositories with confirmed bugs give more honest numbers.
- Use-after-free and lifetime bugs often cross function boundaries. The LLM needs an interprocedural slice from the call graph, not 1 function.
- More code in the prompt can lower recall: o3 went from 8 to 1 in 100 runs when the code went from 3.3k to 12k lines. CASTLE shows the same trend.
- The hit rate per run is low. A review skill should run more than 1 sample and verify each finding.
- The vendor claims show what frontier models with tools can do at scale. They give no precision or recall on a fixed public benchmark, except CyberGym.

### Gaps
- I found no published precision or recall of LLMs for C++ lambda-capture bugs, for dangling references across function boundaries, or for detached threads that use stack objects.
- I found no Juliet results for current models.
- I did not confirm which model RepoAudit used. I did not find its precision for each bug type.
- No independent party has checked the Anthropic, OpenAI or Google counts.

## 3. What did LLM and static analysis hybrids find?

### Takeaway
Hybrids give the strongest independent results. LLM triage of analyzer warnings removes most false positives at low cost, and LLMs that write Clang Static Analyzer checkers found many long-latent kernel bugs. LLMs that read dynamic reports, from sanitizers or race detectors, fix a part of the bugs, and test runs validate each fix.

### Cited Findings

#### Independent results

- LLift (Li, Hao, Zhai and Qian, OOPSLA 2024) adds an LLM to UBITect, a static analyzer for use-before-initialization bugs in Linux. UBITect leaves about 40% of its warnings undecided because symbolic execution times out or runs out of memory. Source: [LLift PDF](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf). [Peer-reviewed]
- LLift on nearly 300 undecided UBITect cases: precision 50%, with no missed bugs. On 1,000 cases, LLift found 13 new bugs, and Linux developers confirmed 4. Source: [LLift PDF](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf). [Peer-reviewed]
- LLift design ablation on Cmp-40 (13 true and 27 false cases): a simple prompt gave precision 0.12, recall 0.15, F1 0.13. Post-constraint guided path analysis alone gave F1 0.31. Table 3 does not name the model, but GPT-4 is the main LLift model. Source: [LLift PDF, Table 3](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf). [Peer-reviewed]
- The full LLift design adds a progressive prompt, task decomposition and self-validation. It gave precision 0.87, recall 1.00 and F1 0.93 on Cmp-40. Task decomposition and self-validation also made the answers more consistent across runs. Source: [LLift PDF, Table 3](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf). [Peer-reviewed]
- LLift on 9 typical real UBITect bugs: recall was 100% with GPT-4, 89% with GPT-3.5, 67% with Claude 2 and 67% with Bard. Source: [LLift PDF, Table 4](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf). [Peer-reviewed]
- LLift outside Linux: in Nginx, UBITect gave 11 warnings, all false, and LLift labeled all 11 correctly. In EDK II, LLift labeled 12 of 13 cases correctly. Source: [LLift PDF, Tables 5 and 6](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf). [Peer-reviewed]
- KNighter (SOSP 2025): an LLM writes Clang Static Analyzer checkers from historical Linux bug-fix patches. The checkers then scan the kernel without LLM cost for each function. Source: [arXiv 2503.09002v3](https://arxiv.org/abs/2503.09002v3). [Peer-reviewed] [Extract]
- KNighter v3 results: 92 new bugs that were latent for 4.3 years on average. Developers confirmed 77 and fixed 57. Source: [arXiv 2503.09002v3](https://arxiv.org/abs/2503.09002v3). [Peer-reviewed] [Extract]
- [UNCONFIRMED] The KNighter CVE count does not agree: the v3 abstract gives 30 CVEs and the v3 HTML text gives 16. Version 1 gave 70 bugs, 56 confirmed, 41 fixed and 11 CVEs. Source: [arXiv 2503.09002v3 HTML](https://arxiv.org/html/2503.09002v3).
- [UNCONFIRMED] A search extract says that KNighter made high-quality checkers for 61% of "them", and the reference of "them" is not clear to me. The same extract gives a false-positive rate of about 35% with a triage agent. Source: [arXiv 2503.09002](https://arxiv.org/html/2503.09002v2).
- BugLens (Li, Zhang, Pei and Qian, 2025): an LLM refines the taint warnings of Suture on the Linux kernel. Suture alone has a false-positive rate of 90%. Source: [arXiv 2504.11711](https://arxiv.org/abs/2504.11711v3). [Preprint] [Extract]
- BugLens results: precision went from 0.10 to 0.72, about 7 times higher. A semi-automated baseline got 0.50. BugLens also found 4 new vulnerabilities. Source: [arXiv 2504.11711](https://arxiv.org/abs/2504.11711v3). [Preprint] [Extract]
- Tencent industry study, setup: 433 alarms (328 false, 105 true) from the BkCheck analyzer on C and C++ advertising software. The bug classes were null pointer dereference, out-of-bounds access and divide-by-zero. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed, ICSE SEIP 2026]
- Tencent study, LLM4PFA, which gives static path constraints to an agent: precision 0.83 to 0.93, recall 0.75 to 0.88, F1 0.83 to 0.86. It removed 94% to 98% of the false positives with GPT-4o, Claude-Opus-4, Qwen-3-Coder and DeepSeek-R1. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- Tencent study, LLM4SA, which gives the full code context around the sink: precision 0.63 to 0.85, recall 0.65 to 0.86, F1 0.70 to 0.81 with the same 4 models. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- Tencent study, prompts only: basic prompts gave accuracy 0.40 to 0.55. Few-shot prompts were best among the prompt-only methods, at about 0.69 to 0.72 accuracy for Claude-Opus-4, Qwen-3-Coder and DeepSeek-R1. Chain-of-thought prompting was the weakest in several cases. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- Tencent study, trained models: Devign, ReGVD and LLMAO gave accuracy 0.36 to 0.44. LineVul gave 0.76, but it labeled almost all alarms as false. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- Tencent study, cost for each alarm with LLM4PFA: GPT-4o $0.020 and 12.6 s, Claude-Opus-4 $0.120 and 16.7 s, Qwen-3-Coder $0.0056 and 16.1 s, DeepSeek-R1 $0.0025 and 58.3 s. A manual review takes 10 to 20 minutes for each alarm. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- The Tencent study has no ablation that isolates path constraints, call chains or data flow. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- IRIS (Li, Dutta and Naik, ICLR 2025), Java only: CWE-Bench-Java has 120 vulnerabilities. CodeQL found 27, and IRIS with GPT-4 found 55. The average false discovery rate of IRIS was 84.82%. The abstract says that this is 5.21% lower than CodeQL. IRIS found 4 new vulnerabilities. Source: [ICLR 2025 proceedings](https://proceedings.iclr.cc/paper_files/paper/2025/hash/582d4e27fa24168f3af1f4582655034b-Abstract-Conference.html). [Peer-reviewed] [Extract]
- Dr.Fix (Uber, PLDI 2025), Go only: the Go race detector, which uses the ThreadSanitizer runtime, gives the race reports. The LLM gets code at fix locations from the 2 stack traces and a retrieved example of a past fix. Source: [arXiv 2504.15637](https://arxiv.org/html/2504.15637). [Peer-reviewed, industry]
- Dr.Fix results over 18 months: 224 of 404 races (55%) got a validated fix. Developers accepted 193 of the 224 fixes (86%). Each fix took a median of 14 minutes. GPT-4 Turbo ran in deployment. Source: [arXiv 2504.15637](https://arxiv.org/html/2504.15637). [Peer-reviewed, industry]
- Dr.Fix validation: the patched package tests run 1,000 times. A fix passes only if the race does not occur in any run. Source: [arXiv 2504.15637](https://arxiv.org/html/2504.15637). [Peer-reviewed, industry]
- Theori RoboDuck, third place at AIxCC: Infer flags candidate bugs, with a false-positive rate of about 99.9% in their workflow. An LLM classifies each report as likely or unlikely with 1 output token. Token log-probabilities over several samples give the score, at about $0.001 for each report. Source: [Theori blog](https://theori.io/blog/aixcc-and-roboduck-63447). [Industry, team report]
- RoboDuck second stage: the top 20% of reports, or fewer under a budget cap, go to an agent with source-browsing tools, at about $0.50 for each report. The tools include TreeSitter, GTags, Joern and clang-ast. Source: [Theori blog](https://theori.io/blog/aixcc-and-roboduck-63447). [Industry, team report]
- RoboDuck diff analysis: 2 agents look for bugs that a code change adds. The agent that gets a diff pruned with compilation introspection gives far fewer false positives. Source: [Theori blog](https://theori.io/blog/aixcc-and-roboduck-63447). [Industry, team report]
- RoboDuck crash triage: the system groups fuzzer crashes by stack hash. An LLM agent then writes a bug report and tries to match it to known vulnerabilities. Source: [Theori blog](https://theori.io/blog/aixcc-and-roboduck-63447). [Industry, team report]
- [UNCONFIRMED] A search extract says that RoboDuck used o3, Claude Sonnet 4 and o4-mini. I did not see the model names in the primary post. Source: [Trail of Bits, AIxCC finals tale of the tape](https://blog.trailofbits.com/2025/08/07/aixcc-finals-tale-of-the-tape/).

#### Vendor claims

- Google AI-powered patching, 2024: Gemini fixed 15% of the sanitizer bugs that unit tests found in C and C++, Java and Go code. Google says that this gave hundreds of patched bugs, with a human review of each fix. Source: [Google Research](https://research.google/pubs/ai-powered-patching-the-future-of-automated-vulnerability-fixes/). [Vendor claim, technical report]
- OSS-Fuzz-Gen, November 2024: LLM-written fuzz targets found 26 new vulnerabilities. One is CVE-2024-9143, an out-of-bounds write in OpenSSL that existed for about 20 years. Source: [Google Security Blog](https://security.googleblog.com/2024/11/leveling-up-fuzzing-finding-more.html). [Vendor claim]
- OSS-Fuzz-Gen coverage: the AI targets cover 272 C and C++ projects, up from 160, with more than 370k new lines of coverage. Source: [Google Security Blog](https://security.googleblog.com/2024/11/leveling-up-fuzzing-finding-more.html). [Vendor claim]
- [UNCONFIRMED] SC Media says that the first 26 bugs used the Vertex AI code-bison model. Source: [SC Media](https://scworld.com/news/googles-ai-powered-fuzzing-tool-discovers-26-new-vulnerabilities).

### Inferences
- The common pattern: the analyzer gives recall and structure, and the LLM gives precision. The LLM checks if a specific path, constraint or report is feasible.
- Structured facts beat raw code. LLM4PFA with path constraints had higher precision than LLM4SA with hundreds of lines of context, for all 4 models.
- The LLift ablation shows that decomposition and self-validation matter as much as the model. F1 went from 0.13 to 0.93 with the same model.
- KNighter fits a Clang-based engine well. The LLM writes checkers offline, and the engine runs them at scale with no LLM cost for each function.
- The cost data support a funnel: a cheap 1-token classifier for all candidates, then an agent for the top-ranked part.

### Gaps
- I found no study of LLM triage for static race or deadlock warnings in C or C++, for example from RacerD, a RacerX-style tool or a lockset tool.
- I did not check the numbers of LLMSA, LLMDFA, SkipAnalyzer or SAN2PATCH.
- I found no independent replication of KNighter, BugLens or LLift.

## 4. What worked in practice at scale?

### Takeaway
The large successes combine LLMs with an execution check: fuzzers and sanitizers (OSS-Fuzz-Gen, AIxCC), proof-of-concept inputs (Big Sleep, CyberGym), or maintainer review (Sashiko). Kernel review bots now run on the main kernel lists with self-reported false-positive rates of about 10% to 20%. Vendor claims of hundreds to thousands of bugs have no independent precision data.

### Cited Findings

#### Independent and organizer results

- AIxCC final, DEF CON 33, August 2025: the systems analyzed more than 54 million lines of code. They found 54 synthetic vulnerabilities and patched 43. They also found 18 real zero-days and patched 11. Source: [DARPA](https://darpa.mil/news/2025/aixcc-results). [Organizer] [Extract]
- [UNCONFIRMED] The AIxCC percentages depend on the denominator. DARPA gives 63 challenges, so 86% found and 68% patched. Other sources give 70 synthetic vulnerabilities, so 77% found and 61% patched. Source: [DARPA](https://darpa.mil/news/2025/aixcc-results) and [Virtualization Review](https://virtualizationreview.com/Articles/2025/09/02/AIxCC-Find-and-Fix-Flaws-in-Software-Automatically.aspx).
- AIxCC cost and time: the average cost was about $152 for each competition task. The average time to a patch was 45 minutes. Source: [DARPA](https://darpa.mil/news/2025/aixcc-results). [Organizer] [Extract]
- AIxCC improvement from the semifinal to the final: vulnerability identification went from 37% to 77%, and patch success from 25% to 61%. Source: [Virtualization Review](https://virtualizationreview.com/Articles/2025/09/02/AIxCC-Find-and-Fix-Flaws-in-Software-Automatically.aspx). [Extract]
- AIxCC winners: Team Atlanta won $4M. Trail of Bits with Buttercup won $3M. Theori with RoboDuck won $1.5M. Team Atlanta found the most real-world vulnerabilities, and Theori had the lowest cost for each patched vulnerability. Source: [Infosecurity Magazine](https://www.infosecurity-magazine.com/news/defcon-ai-cyber-challenge-winners/) and [Virtualization Review](https://virtualizationreview.com/Articles/2025/09/02/AIxCC-Find-and-Fix-Flaws-in-Software-Automatically.aspx). [Extract]
- After AIxCC, Team Atlanta used OSS-CRS to find 25 vulnerabilities in 16 projects, for example PHP, U-Boot, memcached and Apache Ignite 3. 9 are fixed and 8 more are confirmed. Source: [OpenSSF](https://openssf.org/tag/darpa/). [Team claim] [Extract]
- Linux kernel review with Sashiko: it runs on the linux-kernel list and 47 other lists whose maintainers opted in. Kernel commit messages mention Sashiko 140 times in the 7 weeks after its launch in mid-March 2026. Source: [LWN](https://lwn.net/Articles/1073583/). [Practitioner report of a talk]
- Sashiko accuracy from an analysis of about 1,500 email threads by Roman Gushchin: about 10% false positives and about 85% true positives. The rest were low-value gray-zone reports. For critical and high-severity reports, the accuracy was almost 97%. Source: [LWN](https://lwn.net/Articles/1073583/). [Project claim, reported by LWN]
- Maintainer feedback on Sashiko: the output is too verbose. It reports known, accepted issues again. It finds new problems on each new version, so 1 author sent an 18-patch series 7 or 8 times. Source: [LWN](https://lwn.net/Articles/1073583/). [Practitioner]
- Chris Mason, a Meta engineer, keeps the kernel review-prompts repository. He describes a trade-off between bugs found, token cost and false positives. He also says that more context correlates with more bugs found. Source: [LWN](https://lwn.net/Articles/1073583/) and [Slashdot summary of Phoronix](https://linux.slashdot.org/story/26/02/02/0718228/linux-kernel-developer-chris-masons-new-initiative-ai-prompts-for-code-reviews). [Practitioner] [Extract]
- syzbot AI triage: the syzbot cluster runs an LLM "patch-evaluator" with gemini-3.1-pro-preview. In 1 trajectory, it decided that a patch with only a `data_race()` annotation does not change behavior and is not worth fuzzing. This trajectory used no code-search tool, although its instructions ask it to verify assumptions against the source. Source: [syzbot AI trajectory](https://ci.syzbot.org/sessions/364d2f2d-317f-49f2-80f9-5bc3c9ba544d/triage_trajectory). [Observed deployment, 1 page]
- Heelan's o3 result (sections 1 and 2) is a well-documented independent case of an LLM that found a real concurrency use-after-free in kernel C code. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]

#### Vendor and project claims

- Sashiko README: on historical Linux commits with bugs that passed human review, Sashiko v0.9.3 detected 75.8% of the bugs. On GCC, v0.7.0 detected 58.5%. Manual samples suggest a false-positive rate below 20%. Source: [Sashiko README](https://github.com/sashiko-dev/sashiko). [Project claim]
- [UNCONFIRMED] The Sashiko benchmark table names the models "Gemini 4 Carbon" for Linux and "Gemini 4 Argon" for GCC. I could not confirm what these names refer to. Gemini is the default provider, and Google funds the compute and tokens of the public instances. Source: [Sashiko README](https://github.com/sashiko-dev/sashiko).
- Sashiko stages: the goal, implementation and execution-flow stages always run. A planning stage selects other stages, for example resources, locking, security and hardware. Then the verification and post-verification stages check uncertain findings before the report. Source: [Sashiko README](https://github.com/sashiko-dev/sashiko). [Project claim]
- The Sashiko resources stage looks for leaks, use-after-free, double frees and object lifecycles across queues, timers and workqueues. Source: [Sashiko README](https://github.com/sashiko-dev/sashiko). [Project claim]
- Big Sleep (Google Project Zero and DeepMind), October 2024: the agent found a stack buffer underflow in the SQLite function `seriesBestIndex`. SQLite fixed it on the same day, before a release. Source: [Project Zero](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html). [Vendor claim] [Extract]
- [Extract] For the SQLite bug, Big Sleep used Gemini 1.5 Pro. The task was to look for variants of a previous SQLite vulnerability. Project Zero says that 150 CPU hours of fuzzing did not find the bug again. Source: [Project Zero](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html).
- Big Sleep, July 2025: it found CVE-2025-6965, a memory corruption in SQLite before 3.50.2. Google says that only threat actors knew the bug and that the bug was at risk of exploitation. Source: [The Record](https://therecord.media/google-big-sleep-ai-tool-found-bug). [Vendor claim]
- Big Sleep, August 2025: Google reported 20 vulnerabilities, mostly in FFmpeg and ImageMagick. A human expert reviews each finding before the report. Source: [TechCrunch](https://techcrunch.com/2025/08/04/google-says-its-ai-based-bug-hunter-found-20-security-vulnerabilities/). [Vendor claim]
- See section 2 for the Anthropic and OpenAI claims, and section 3 for OSS-Fuzz-Gen and Google AI-powered patching.

### Inferences
- The systems that work at scale have a verification step: a proof-of-concept input with a sanitizer, a test re-run, or a maintainer. A review skill without execution needs a substitute: static facts, more than 1 LLM sample, and a separate verification stage.
- The Sashiko feedback shows that noise control is a product problem. The skill needs suppression of known issues, a severity filter and short output.
- The kernel community uses separate stages for locking and for resources. This supports a review skill with separate concurrency and lifetime passes.

### Gaps
- No public precision data exist for Big Sleep, Aardvark, the Anthropic counts or Glasswing.
- I did not get the AIxCC result for each CWE, so I do not know how many concurrency bugs the systems found.
- I found no Meta numbers for LLM detection of concurrency or memory bugs in C++. Meta's known race work is RacerD, a static tool without an LLM.
- I did not confirm numbers for Google CodeMender.

## 5. Which static analyzer facts help an LLM reviewer most for concurrency bugs?

### Takeaway
No study that I found isolates the value of thread entry points, lock sets or shared-access facts for an LLM reviewer. The indirect evidence is consistent: give the LLM the exact racy pair, the call paths from the thread roots, the lock sets and the synchronization facts, in a small slice. Then ask the LLM to judge feasibility and impact, not to search the code.

### Cited Findings

- Localization is the weak step: on DRB-ML, GPT-4 had F1 about 0.75 for the race verdict but 0.193 for the variable pair, the lines and the read or write type. Source: [arXiv 2308.07505](https://ar5iv.labs.arxiv.org/html/2308.07505). [Preprint]
- Without facts, LLMs over-report races and miss deadlocks: on SV-COMP, 3 models had recall 1.00 with precision 0.21 to 0.24 for races. No model gave a true deadlock positive. Source: [arXiv 2501.14326v2](https://arxiv.org/html/2501.14326v2). [Preprint]
- Race-report facts that Dr.Fix gives to the LLM: the stack trace of each racy access, the stack of the parent goroutine at its creation point, and the read or write type of each access. Source: [arXiv 2504.15637](https://arxiv.org/html/2504.15637). [Peer-reviewed, industry, Go]
- Dr.Fix fix locations: the leaf functions of the 2 racy goroutines, the test function, and the lowest common ancestor (LCA) of the 2 stacks. With the LCA location, success went from 62.53% to 66.75% (GPT-4o, 403 races). Source: [arXiv 2504.15637](https://arxiv.org/html/2504.15637). [Peer-reviewed, industry]
- Dr.Fix slices: a program slice keeps the concurrency constructs and the racy variables and renames other variables. Retrieval with this skeleton raised success from 47% without examples to 66%. Retrieval without the skeleton gave 50%. Source: [arXiv 2504.15637](https://arxiv.org/html/2504.15637). [Peer-reviewed, industry]
- Dr.Fix scope: the function scope alone gave 39%, the file scope alone gave 33%, and the file scope with feedback gave 39%. The function scope first, then the file scope with feedback, gave 66%. Source: [arXiv 2504.15637](https://arxiv.org/html/2504.15637). [Peer-reviewed, industry]
- ConCovUp gives the agents the shared-memory accesses and their calling contexts from static analysis. The coverage of shared-access pairs went from 36.6% with a general Claude Code agent to 68.1%. Source: [arXiv 2605.09573](https://arxiv.org/abs/2605.09573). [Preprint]
- Structured constraints help: LLift with post-constraints, task decomposition and self-validation raised F1 from 0.13 to 0.93 with the same model. GPT-4 is the main LLift model. Source: [LLift PDF](https://www.cs.ucr.edu/%7Ezhiyunq/pub/oopsla24_llift.pdf). [Peer-reviewed]
- Path constraints beat broad context: in the Tencent study, LLM4PFA with static path constraints had higher precision than LLM4SA with callers, callees and hundreds of lines. GPT-4o went from 0.63 to 0.93. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- Small slices help: o3 found the ksmbd bug in 8 of 100 runs with 3.3k lines, and in 1 of 100 runs with 12k lines. Source: [Heelan](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/). [Practitioner]
- Long functions and many conditions cause misses: in the Tencent study, the cases that all methods missed had functions about 95.6 lines longer than average, with about 21 more conditional statements. Source: [arXiv 2601.18844](https://arxiv.org/html/2601.18844v1). [Peer-reviewed]
- Facts that classic static race tools compute: RacerX infers which locks protect which operations and which code runs multithreaded. It detects races and deadlocks. Source: [RacerX](https://www.researchgate.net/publication/220910258_RacerX_Effective_static_detection_of_race_conditions_and_deadlocks). [Peer-reviewed] [Extract]
- Locksmith uses a sharing analysis to show that many locations are thread-local and need no locks. Source: [Locksmith](http://www.cs.umd.edu/~mwh/papers/locksmith-journal.pdf). [Peer-reviewed] [Extract]
- RacerF, a Frama-C plugin for C with POSIX threads, is thread-modular. It analyzes the sequential behavior of each thread and then generalizes to the concurrent case. Source: [arXiv 2502.04905](https://arxiv.org/pdf/2502.04905). [Peer-reviewed, ECOOP 2025] [Extract]
- LR-Miner mines locking rules from kernel code and flags violations. It found 306 real races, and kernel developers confirmed 61. Source: [USENIX Security 2024](https://www.usenix.org/system/files/usenixsecurity24-li-tuo.pdf). [Peer-reviewed] [Extract]
- RacerD (Meta) prefers fewer false positives to fewer false negatives. It reports at most 1 pair of conflicting read-write snapshots for each access location. Source: [RacerD, OOPSLA 2018](https://ilyasergey.net/papers/racerd-oopsla18.pdf) and [Meta Engineering](https://engineering.fb.com/2017/10/19/android/open-sourcing-racerd-fast-static-race-detection-at-scale/). [Peer-reviewed] [Extract]
- Kernel review practice: Sashiko runs a separate locking stage and a separate resources stage. A planning stage selects the stages, and verification stages check uncertain findings. Source: [Sashiko README](https://github.com/sashiko-dev/sashiko). [Project claim]
- Kernel review practice: Mason gives the model compact locking rules. He reports that more context finds more bugs but costs more tokens and can add false positives. Running Sashiko several times and merging the results was proposed as an improvement. Source: [LWN](https://lwn.net/Articles/1073583/). [Practitioner]
- Ranking: RoboDuck scores all candidates with a 1-token LLM call at about $0.001 each. Only the top 20% go to the agent at about $0.50 each. Source: [Theori blog](https://theori.io/blog/aixcc-and-roboduck-63447). [Industry, team report]
- Lifetime facts: Clang Lifetime Safety Analysis needs lifetime annotations. Without them, it assumes that calls have no lifetime effect and can miss dangling pointers. Source: [Clang documentation](https://clang.llvm.org/docs/LifetimeSafety.html). [Tool documentation] [Extract]

### Inferences
These are design inferences for the review skill. No single study tested them together.
- For each race candidate, give these facts from the engine:
  - the 2 accesses with file, line, variable or field path, and read or write type;
  - the thread entry points that reach each access, with the call path;
  - the lock set at each access, and if the access is atomic, its memory order;
  - the happens-before edges between the threads, for example thread create, join, condition variables and once flags;
  - the escape facts that show how the object becomes visible to the other thread.
- These facts copy what Dr.Fix gets from a dynamic race report: 2 stacks, a creation-site stack and the read or write type. Dr.Fix showed gains from these facts and from the common ancestor.
- For deadlocks, give the lock-order cycle with the acquisition sites and the call paths. Ask the LLM if the threads can run these paths at the same time. Do not ask the LLM to find deadlocks without facts.
- For lifetime bugs of lambdas and threads, give the capture list of each lambda that goes to a thread, async task or executor. Also give the scope end of each captured object, and the join or detach points of the thread.
- Use the risk score of each function to select the candidates for the expensive agent pass, as RoboDuck did with its top 20%.
- Keep the slice small: the 2 access paths and their common ancestor, not whole files. Heelan, CASTLE and the Tencent failure analysis all show lower recall with more code.
- Run more than 1 sample, and merge the votes. Add a separate verification step. Tell the model that "no bug" is a valid answer, as Heelan did.
- Ask the LLM to judge feasibility, impact and the fix. The LLM tasks with the best results in sections 1 to 3 were verification tasks, not search tasks.

### Gaps
- I found no ablation that measures the value of thread entry points, lock sets, shared-access facts or call graphs for an LLM reviewer of concurrency bugs.
- I found no benchmark for LLM triage of static race warnings in C or C++.
- I found no study that gives Clang Thread Safety Analysis facts, such as `GUARDED_BY` annotations, to an LLM.
- The Dr.Fix evidence is for Go and for fixes, not for detection in C or C++.
