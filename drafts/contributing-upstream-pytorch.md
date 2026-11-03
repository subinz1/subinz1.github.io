---
title: "Contributing upstream to PyTorch: a path from first issue to trusted change"
description: "A practical, evidence-driven guide for new PyTorch contributors: choosing scope, navigating the tree, testing generated cases, triaging CI, and collaborating through review."
eyebrow: "Field note / upstream contribution"
context: "PyTorch · testing · CI · code review"
audience: "For new PyTorch contributors who want a reliable path from first issue to merged pull request"
status: draft
---

# Contributing upstream to PyTorch

## A practical path from first issue to a trusted change

The first difficult part of contributing to PyTorch is not opening a pull request. It is learning how to turn a useful observation into a small change that is easy for a maintainer to understand, test, review, and safely merge.

PyTorch is a large project with Python, C++, generated bindings, device-specific backends, compiled kernels, documentation, and a CI system that exercises a very large compatibility matrix. That scale can look intimidating, but it also gives a new contributor a reliable method: make the problem precise, follow the local conventions, validate the narrowest relevant behavior, and leave behind evidence that another person can inspect.

This guide is a field note for the first path through that process. It is not a substitute for the current upstream documentation—the source of truth changes with the project—but it explains how the pieces fit together and what to do next at each decision point.

> A good first contribution is not the smallest diff. It is the smallest change with a clear problem, an appropriate test, and a reviewable explanation.

## 01 / Start with a contribution shape that can finish

The best early contribution is usually bounded. It has an observable behavior, a plausible owner, and a way to prove the outcome. Documentation corrections, test coverage, focused bug fixes, and well-triaged regressions are all valuable entry points. PyTorch's [contribution page](https://github.com/pytorch/pytorch/contribute) lists issues marked as good first issues; the labels also help identify a module or on-call area.

Before editing code, answer four questions in writing:

1. **What happens today?** Describe the current behavior, including the relevant version, platform, device, dtype, model shape, or error message.
2. **What should happen instead?** State the user-visible or developer-visible expectation without jumping to an implementation.
3. **Where is the narrowest likely owner?** A Python API, native operator, compiler path, distributed component, documentation page, or test helper each has a different review and validation path.
4. **How will someone else verify it?** A failing test, a small reproduction, a before-and-after result, or a documentation rendering check is the beginning of the acceptance criteria.

For a non-trivial change, open or find an issue before writing a large patch. The issue is where scope can be corrected cheaply. A useful issue contains a minimal reproduction, the observed and expected behavior, environment details, and any evidence that the behavior is a regression. Avoid using an issue as a request for a broad rewrite; describe the user problem first, then invite discussion of the design.

If a proposed change changes an API, affects compatibility, adds a major subsystem, or has multiple viable designs, pause for maintainer direction. The correct first contribution is sometimes a small test or an issue that clarifies the design—not an ambitious implementation.

## 02 / Read the tree before changing it

PyTorch's source tree tells you what kind of change you are making:

| Area | What a contributor should learn there |
| --- | --- |
| `torch/` | Python-facing implementation and package structure. |
| `torch/csrc/` | C++ implementation and Python binding code; subdirectories cover areas such as autograd, distributed, and the C++ frontend. |
| `aten/` | Core tensor and operator implementation work. |
| `torchgen/` | Logic that generates low-level C++ and Python bindings from operator definitions. |
| `test/` | Python test suites, CI-style test entry points, C++ tests, expected-output fixtures, and feature-specific coverage. |
| `torch/testing/_internal/` | Internal test infrastructure: common utilities, device-type instantiation, and operator metadata helpers. |
| `.github/` and `.ci/` | Workflow and CI behavior; changes here deserve particular care because a PR's workflows can be evaluated from its merge result. |

Do not infer architecture from one nearby file. Find a recent change in the same subsystem, read its test, then follow the call path one or two layers outward. For an operator or API change, search for its existing tests, its public documentation, and its metadata before adding a new special case. For a CI or workflow change, read the workflow consumer and the test or validation that protects its contract.

The [upstream contributing guide](https://github.com/pytorch/pytorch/blob/main/CONTRIBUTING.md) is the right starting point for repository-specific development details. It documents the current layout, code-generation responsibilities, lint tooling, test entry points, PR requirements, and help channels. Treat a copied command from an old issue or blog post as a lead, not as the source of truth.

## 03 / Set up enough environment for the change you own

Do not begin by trying to build every PyTorch configuration. Begin by identifying what your change needs:

- **Python-only behavior** may need a working editable checkout and focused CPU tests.
- **Native C++ or operator work** needs the compiler and build configuration for the affected path.
- **CUDA, ROCm, MPS, XPU, distributed, or mobile behavior** may require the corresponding hardware, runtime, or CI evidence.
- **Documentation** has its own rendering and docstring conventions.
- **Workflow changes** need careful static review plus the relevant CI path; they are not proven by a local unit test alone.

Fork the repository, create a branch from current `main`, and initialize the repository exactly as the active upstream setup instructions describe. Build configuration is environment dependent, so record the operating system, Python version, compiler/runtime, and any build options before comparing results. An editable installation is useful because Python imports resolve to the current source tree, but compiled output still depends on the build you produced.

Once the checkout works, discover the maintained commands instead of guessing:

```bash
spin --help
spin quicklint
python test/run_test.py -h
```

The `spin` tool is the maintained entry point for common development and lint operations. `quicklint` targets the changes in the working tree and most recent commit; the full lint path is appropriate when the change or subsystem warrants it. The contributor guide also documents code-generation commands. Run a generator only when your change requires it, and include the generated output only when the repository convention expects it.

The goal is not to make a laptop resemble every CI runner. The goal is to establish a repeatable local loop and know which parts require CI or a maintainer with specialized hardware.

## 04 / Learn why a PyTorch test name may look unfamiliar

PyTorch tests often generate concrete cases at import time. One template can expand across devices, dtypes, layouts, and operators. That is why a CI failure can name a test such as a CUDA float32 specialization rather than the source-level method a contributor just edited.

The generated name is useful evidence. It identifies the combination that failed. Before writing or debugging a test, learn the role of these building blocks:

- `TestCase` and `run_tests()` in `torch/testing/_internal/common_utils.py` provide common test behavior.
- `@parametrize` covers multiple input shapes or values without repeated test bodies.
- `instantiate_device_type_tests()` and decorators such as `@dtypes` generate device- and dtype-specific cases.
- `OpInfo` definitions centralize samples, supported dtypes, skips, decorators, and tolerance metadata for broad operator testing.
- `test/run_test.py` provides the CI-style runner, including selective execution and sharding behavior.

This changes how to write a durable test. Test the public or internal contract at the right abstraction level, use the test framework's existing parameterization instead of hand-writing near-duplicates, and make tolerances explicit when numerical behavior really requires them. For equality in PyTorch's internal test suite, use the established test assertion rather than building a one-off comparison. For device-generic behavior, do not hard-code a device that prevents the same test from running elsewhere.

The official [test infrastructure guide](https://pytorch.org/blog/understanding-pytorchs-test-infrastructure/) and [running and writing tests wiki](https://github.com/pytorch/pytorch/wiki/Running-and-writing-tests) explain the generated-test model in more detail. Read them before assuming that “no tests collected” means a CI test does not exist.

## 05 / Use a narrow local feedback loop

Run the smallest test that could disprove your hypothesis before expanding the scope. The exact command depends on the test file and environment, but the usual progression is:

```bash
# From the repository root, run a focused unittest-style case.
python test/test_file.py TestClass.test_name

# Or filter a test file by a useful substring.
pytest test/test_file.py -k "relevant_name" -v

# Use the CI-style runner when its selection or handlers are relevant.
python test/run_test.py test_file
```

The source name and the generated name are not always interchangeable. When a test is device- or dtype-instantiated, reproduce with the concrete generated name reported by CI. When the test is broad or expensive, use the smallest representative input that still exercises the actual branch; do not create a fast test that misses the bug.

Then widen deliberately:

1. Run the individual case.
2. Run its containing test file or affected group.
3. Run relevant lint and type checks.
4. Run neighboring coverage only when it protects an interaction your change may affect.
5. Let CI cover the platform matrix that the local machine cannot represent.

PyTorch's test wiki notes that direct test-file execution is generally preferred for focused iteration, while `test/run_test.py` adds CI-oriented selection, sharding, and handlers. The upstream contributor guide also notes a practical detail: CI runs tests from the `test` directory, so local and CI invocation context can differ. If that difference explains a failure, record it in the PR rather than treating it as unexplained flakiness.

## 06 / Make the pull request an evidence bundle

A pull request is the handoff from the person who found a problem to the people responsible for the subsystem. Make it easy to review in that order:

1. **Title:** state the change, not the implementation detail alone.
2. **Problem:** explain the failure mode or missing behavior in a few precise sentences.
3. **Approach:** say why this is the smallest appropriate fix and call out important alternatives you did not take.
4. **Validation:** list the focused tests, lint, or reproduction that support the change. Be accurate about what was and was not tested.
5. **Risk:** identify platform, API, numerical, performance, generated-code, or workflow implications.

Keep a PR cohesive. A test refactor, unrelated formatting sweep, and behavioral bug fix make it harder to discover which change introduced a problem and harder for a reviewer to reason about correctness. If a reviewer asks for a follow-up, prefer a distinct commit that preserves the logical review order unless the project convention calls for rewriting the earlier commit.

Before requesting review, check the live [contribution instructions](https://github.com/pytorch/pytorch/blob/main/CONTRIBUTING.md), current PR checklist, and required labels. Non-trivial changes should link their issue. The project uses automated checks and bots, but automation is an aid to review—not a substitute for a clear explanation or ownership of the submitted patch.

Complete the required PyTorch Foundation contributor license agreement when the PR check directs you to do so. The project also expects contributors to follow its code of conduct and the subsystem's design and documentation conventions. These are part of making a contribution maintainable, not administrative work to postpone until after the patch is ready.

## 07 / Triage CI by turning a red check into a question

The right response to a failed CI job is not always “change the code again.” First determine whether the job is relevant, whether the failure reproduces, and what exact test configuration failed.

Use this sequence:

1. **Read the summary.** Dr. CI can group failures and point to logs, but it is a starting point rather than final diagnosis.
2. **Open the HUD and job log.** Find the generated test name, device and dtype suffix, shard, revision, and the first meaningful failure.
3. **Ask whether the job is already failing upstream.** A recurring failure on the baseline may be unrelated, but do not dismiss it without evidence.
4. **Reproduce the narrow case.** Use the concrete generated name or a focused filter locally where possible.
5. **Classify the result.** Common categories include a real regression, environment mismatch, test pollution or order dependence, sharding assumptions, and numerical precision behavior.
6. **Respond with evidence.** Link the job, state what reproduced, name the affected configuration, and explain the next action or why the job is unrelated.

The official test-infrastructure guide calls out a reliable first route: begin with the Dr. CI summary, inspect the failing HUD job, identify the generated test and shard, then reproduce through `pytest -k` or `run_test.py`. It also explains why template names, device-generic tests, and CI-only environment differences can complicate that path.

Do not weaken a test to make a check green. If a test is flaky, capture the failure mode and frequency. If a tolerance genuinely needs adjustment, explain the numerical reason and preserve coverage for the intended behavior. If a shard is wrong, fix the selection or isolation issue rather than rerunning indefinitely.

## 08 / Collaborate as if the maintainer cannot read your mind

Review is a technical conversation, not a final obstacle after implementation. A good response either changes the code or explains, with evidence, why the existing approach is preferable. Keep the discussion close to the relevant code; resolve a thread only after the change or agreement is visible.

For reviewers, the most useful things you can provide are:

- a minimal reproduction or test that captures the behavior;
- the subsystem context a reader cannot infer from the diff;
- before-and-after behavior, not just an assertion that the fix works;
- a direct answer to the trade-off they raised;
- an update when CI has re-run on the latest commit.

If you do not know the appropriate reviewer, do not randomly add people. The upstream process uses triage and module ownership to route contributions. The contributor guide says that a reviewer is normally assigned after triage; if a PR has not received a response after the documented waiting period, a respectful follow-up comment is appropriate. Development-infrastructure office hours are also available for questions about CI and the contributor experience.

## 09 / Treat merge as the start of responsibility

After a change merges, check whether it reaches the expected branch and whether any follow-up task remains: documentation, release notes, a test gap, a performance measurement, or an issue that should be closed. If a post-merge regression appears, bring the same evidence-first approach: identify the commit range, reproduce the smallest failure, state the affected configuration, and help the subsystem owners decide whether to fix, revert, or mitigate.

The goal is not to merge the fastest possible patch. It is to leave PyTorch easier to change safely than it was before. A contribution that explains its behavior, encodes the contract in a test, and gives the next investigator a useful failure signal has a life beyond its first review.

## A compact first-contribution checklist

- [ ] I can state the current behavior, desired behavior, and affected configuration.
- [ ] I found or created an issue when the change is not trivial.
- [ ] I read nearby code, tests, and recent changes before designing the patch.
- [ ] I selected the smallest test that exercises the real behavior.
- [ ] I understand whether the test name is generated across device, dtype, or operator variants.
- [ ] I ran focused validation and the relevant lint path.
- [ ] I completed the contributor-agreement step required for my PR.
- [ ] My PR describes the problem, approach, validation, and risk honestly.
- [ ] I inspected failing CI with the job context before changing code or dismissing it.
- [ ] I responded to review with a visible code change or evidence-backed explanation.

## Sources and living references

- [PyTorch contributing guide](https://github.com/pytorch/pytorch/blob/main/CONTRIBUTING.md)
- [PyTorch contribution page and current good first issues](https://github.com/pytorch/pytorch/contribute)
- [Understanding PyTorch's Test Infrastructure](https://pytorch.org/blog/understanding-pytorchs-test-infrastructure/)
- [Running and writing tests](https://github.com/pytorch/pytorch/wiki/Running-and-writing-tests)
- [Pre-commit checks](https://github.com/pytorch/pytorch/wiki/Pre-Commit-Checks)
- [The Ultimate Guide to PyTorch Contributions](https://github.com/pytorch/pytorch/wiki/The-Ultimate-Guide-to-PyTorch-Contributions)
- [Create a Pull Request](https://github.com/pytorch/pytorch/wiki/Create-a-Pull-Request)
- [PyTorch developer wiki](https://github.com/pytorch/pytorch/wiki)
