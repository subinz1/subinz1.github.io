---
title: "Day-zero PyTorch wheels without a public-internet dependency"
description: "How a hermetic PyTorch supply chain builds and qualifies release-ready wheels inside Red Hat, without depending on public package services at build time."
eyebrow: "Field note / ML infrastructure"
context: "PyTorch · RHEL AI · build and test systems"
audience: "For ML infrastructure engineers, platform maintainers, and PyTorch users who need a dependable artifact supply chain"
status: draft
---

# Day-zero PyTorch wheels without a public-internet dependency

## How hermetic builds turn an upstream release into an internally consumable, production-ready PyTorch artifact

The useful outcome of a PyTorch release is not merely that its source is available upstream. It is that Red Hat product teams can use a compatible wheel on the day the release—or a point release—becomes available.

That requires more than a fast build. A normal source build commonly reaches out to public Git repositories, package indexes, language-specific registries, and binary-download locations while it is running. Each request introduces availability risk, changes outside the team’s control, and a dependency that may not satisfy an enterprise production environment’s security, provenance, or licensing expectations.

The intent of the hermetic-build system is to remove that runtime dependency on the public internet. It assembles the PyTorch build inputs through internal, controlled sources; creates or stages the packages required for the build from approved source; and then builds the wheel entirely within the Red Hat-controlled environment. When the release build begins, it should not need an external service to succeed.

> The deliverable is a day-zero PyTorch wheel with a known source, known dependencies, known platform recipe, and evidence that it is ready for internal product use.

## 01 / The real problem: releases cannot depend on a live public supply chain

Upstream PyTorch moves quickly. That is a strength: compiler improvements, backend support, operator fixes, distributed-training work, and new hardware enablement can arrive continuously. But a product platform cannot turn a release into a dependable internal dependency by hoping that the same public services, packages, and branches remain available at the moment a build runs.

That approach fails in predictable ways:

- A public package is removed, replaced, or published with different contents.
- A release-day build is blocked by an internet outage, rate limit, or unavailable upstream service.
- A dependency enters the build without the provenance or license review required for a production product.
- A package build works on one developer machine but cannot be reproduced in a secure build environment.
- The artifact is delayed while another team rediscoveres the same dependencies and build conditions.

The consequence is larger than one failed CI job. Product teams wait for a usable wheel, release engineering has an incomplete audit trail, and a security-constrained environment must make an exception for an uncontrolled external fetch.

A hermetic system changes the contract: all build-critical inputs are available through approved internal sources before the release build begins. The build may use upstream source as an intentional input, but it does not rely on public-network access while it is creating the product artifact.

## 02 / What “hermetic” means for this PyTorch supply chain

Hermetic does not mean that there are no dependencies. PyTorch has many of them: compilers, Python build tools, system libraries, package metadata, native-code components, and platform runtimes. It means that those dependencies are deliberately brought inside the supply chain instead of being fetched opportunistically from the internet during the build.

The key distinction is between **preparation** and **release-time construction**. During preparation, the platform can acquire approved source, build needed packages from source, perform license and security review, and publish the resulting inputs to internal registries. During release-time construction, the PyTorch wheel uses only that internal bill of materials.

| Boundary | Hermetic input | Why it matters |
| --- | --- | --- |
| PyTorch source | A resolved upstream release, point release, or commit | A tag or branch is not enough; the source state must be identifiable. |
| Build dependencies | Internally staged packages built from approved source where needed | The build does not have to contact public PyPI, GitHub, or another public registry. |
| Native toolchain | Reviewed, versioned internal builder image | Compiler and system-library changes are deliberate platform changes. |
| Runtime base | Approved internal or mirrored base image | The wheel is built against the runtime family it is expected to support. |
| Artifact storage | Internal package and container registries | Other Red Hat teams have a stable, authenticated consumption path. |
| Evidence | Build manifests, test records, and reports | A release can be investigated and audited after the runner is gone. |

This does not make licensing or security automatic. It creates the control point where they can be addressed: each source component can be reviewed, its license recorded, vulnerabilities assessed, and its approved build output made available internally. The release build then consumes that approved set instead of accepting whatever a public service returns that day.

## 03 / Day zero is prepared before release day

“Day zero” is not a promise to start collecting dependencies when an upstream release is announced. It is the outcome of doing the supply-chain work ahead of time.

The release path should already have:

1. **A source intake process.** The upstream release or point-release source is resolved, recorded, and brought into the controlled source path.
2. **An internal dependency bill of materials.** Every build-required Python package, native library, source archive, patch, and toolchain component has a known internal location and approval state.
3. **Rebuildable package recipes.** When a dependency must be made from source, its recipe and input source are preserved so it can be recreated rather than downloaded from an uncontrolled binary location.
4. **Ready build images and registries.** Builders, base images, and internal artifact destinations are available before the release build begins.
5. **A target validation plan.** CPU and accelerator lanes, runner capacity, test selection, and pass criteria are known in advance.

Then the release-day sequence is intentionally boring:

```text
release or point-release source arrives
→ resolve and record the exact revision
→ build with pre-approved internal inputs and no public-network dependency
→ test the candidate on its supported platforms
→ apply the quality gate
→ publish the qualified wheels to internal consumers
```

The goal is not to outrun upstream with an improvised build. It is to turn an upstream release into an internally consumable PyTorch wheel without asking product teams to wait for a second, unpredictable dependency-integration cycle.

## 04 / One revision, multiple platform truths

There is no single generic PyTorch artifact for every environment. The same upstream revision may need to become several independently validated artifacts:

```text
upstream PyTorch SHA
        │
        ├── CPU: x86_64 / aarch64 / other enterprise architectures
        ├── CUDA: toolkit and GPU-specific runtime paths
        ├── ROCm: AMD GPU runtime and kernel ecosystem
        └── emerging hardware: dedicated builders and enablement recipes
```

This is why platform support should be treated as a matrix rather than a checkbox. A source change that is harmless for CPU can expose a compiler issue on a GPU lane. A package that installs cleanly on one architecture can be unavailable on another. A low-level kernel can be correct but still perform or synchronize badly under a specific runtime.

The pipeline’s responsibility is to make that matrix explicit. Each lane needs a clear recipe, a target image, test selection appropriate to its capability, and a record that identifies the platform result. A healthy CPU wheel is useful evidence; it is not proof that a ROCm or CUDA artifact is healthy too.

## 05 / Build, publish, test, then decide

The strongest pipeline design separates the stages of confidence instead of letting one green build blur them together:

```text
resolve revision
→ select a versioned platform recipe
→ build the wheel and runtime image
→ publish the candidate artifact
→ execute target-platform tests
→ evaluate all expected results
→ publish the report and clean up
```

There is an important nuance here: an artifact may be published before the test quality gate completes. That can be intentional. Downstream jobs often need a stable candidate location in order to test the exact wheel that was built. Publication makes the candidate available; it does not certify it.

Certification arrives only after the quality gate checks that every expected test lane produced a valid, fresh result and that those results meet the agreed policy. In other words, the registry can store a candidate while the quality gate decides whether teams should trust it.

That distinction avoids two common failures:

1. **No artifact until every test finishes.** This prevents downstream validation from using the exact artifact under evaluation.
2. **Artifact exists, therefore it passed.** This turns the registry into an accidental source of false confidence.

The artifact should therefore carry enough identity—source SHA, platform, recipe, and build context—that a downstream result can be tied back to its producer.

## 06 / A quality gate must fail closed

Testing is only useful when absence of evidence is not interpreted as success.

In a distributed CI system, a job can disappear because a runner fails, a container cannot start, a log directory is reused, a test script exits early, or an upload path is unavailable. If a summary step reads only the happy-path counters, it can mistakenly report a green result even when no fresh test actually ran.

A reliable quality gate must distinguish at least these outcomes:

| Outcome | Meaning | Gate behaviour |
| --- | --- | --- |
| Passed | The expected tests ran and met their success policy | Accept the lane |
| Test failed | The test completed and found a functional regression | Reject the lane |
| Cancelled | Work was deliberately cancelled | Report it distinctly; do not call it a pass |
| Timed out | Work exceeded its allowed execution window | Reject or surface as an infrastructure outcome, according to policy |
| Missing or invalid result | The system cannot prove that the intended test completed | Fail closed |

The last category is the one that most often gets missed. A zero-test summary, a missing terminal marker, or a stale report from a previous reused runner should be an infrastructure failure—not a quiet green status. The quality gate is the final interpreter of evidence, so it must verify freshness and completeness as well as pass/fail counts.

## 07 / Separate the trusted path from the comparison path

There is value in having a second, less controlled build mode that follows upstream-oriented installation paths. It helps teams answer useful questions:

- Does the regression also appear outside the hermetic toolchain?
- Is a new upstream change buildable before a platform recipe is updated?
- Is a failure likely tied to the RHEL-specific dependency or runtime path?

But that comparison path should not silently become the production trust path.

The hermetic path exists to provide a controlled platform artifact. The upstream path exists to provide diagnosis and comparison. They have different purposes, different dependency assumptions, and potentially different operational requirements. Naming and reporting the distinction prevents a quick investigation build from being mistaken for an artifact backed by the full platform contract.

This separation also makes failures easier to reason about. If the trusted build fails, investigate the managed recipe, builder, package index, or target test environment. If only the upstream-oriented path fails, investigate its external dependency and entitlement assumptions without conflating that result with the hermetic platform lane.

## 08 / The build system is also an observability system

Ephemeral runners are useful because they are clean and scalable. They are difficult because they vanish when the job ends. The build pipeline must preserve enough evidence for the next engineer to answer a focused question without recreating the entire failure by hand.

For each build and test lane, capture:

```text
upstream revision
recipe and builder/base-image versions
target platform and Python/toolkit versions
candidate artifact location and digest or immutable identity
build configuration and key environment choices
test selection, terminal status, and summary
links to logs, reports, and any retained diagnostic artifacts
```

This is not reporting for its own sake. It changes an incident from “the nightly failed” into a small set of answerable questions:

- Did the upstream revision change?
- Did the builder or base image change?
- Did a package source change?
- Did one platform fail while another passed?
- Was the outcome a test regression, a timeout, or a missing result?
- Which candidate artifact did downstream validation actually consume?

The answer should be visible in the report rather than inferred from a long job log.

## 09 / New hardware enablement needs a deliberate landing path

Support for a new accelerator generation is more than adding one job name to a YAML file. It introduces a new builder, base image, package source, compiler/runtime combination, runner capability, artifact convention, and test policy.

A safe enablement path looks like this:

1. **Make the platform recipe explicit.** Keep its builder and base image in the same reviewed configuration surface as other platforms.
2. **Build the smallest useful artifact first.** Verify packaging and runtime import before attempting the broadest test suite.
3. **Add targeted capability tests.** A basic import is necessary but cannot prove that the intended accelerator path works.
4. **Integrate with the quality gate.** The new lane must be expected when selected and must fail closed if it produces no valid result.
5. **Document support honestly.** The platform matrix should reflect what CI actually builds and tests, including limitations and maturity.
6. **Expand only with evidence.** Stronger roles should follow a sustained record of successful, representative runs—not a single build.

This process may look slower than declaring support immediately. In practice it is faster than retroactively explaining a platform label that was never backed by a complete artifact and validation story.

## 10 / What internal product teams gain from the system

The value is clearest from the perspective of people who consume PyTorch rather than maintain the pipeline.

A product team gains a known wheel for its supported platform without having to build PyTorch itself or allow its production build environment to reach public package services. A model developer gains a way to tell whether a release was tested on that platform. A performance engineer gains a reproducible baseline with controlled compiler and runtime inputs. A downstream CI owner gains a candidate that can be linked to a precise source revision. A platform maintainer gains a record of where a failure began and whether it is isolated to one architecture or backend.

Most importantly, users gain a clearer answer to the question that matters after every PyTorch update:

> Can I use this revision for my workload on my platform, and what evidence supports that decision?

The pipeline cannot promise that every workload will behave identically. It can make the compatibility signal concrete, traceable, and honest about its coverage.

## A practical operating checklist

Before calling a platform artifact ready, ask:

- Is the upstream source identified by an immutable revision?
- Are builder, runtime, and dependency sources internal, intentional, and recorded?
- Can the release build complete with public-network egress unavailable?
- Were build-required packages sourced or rebuilt through the approved internal process, with licensing and security review completed before release time?
- Does every selected platform have a clear build and test policy?
- Does the test quality gate reject missing, stale, invalid, timed-out, and failed results appropriately?
- Can a downstream result be traced to the exact candidate artifact and source SHA?
- Are comparison or upstream modes visibly separate from the trusted hermetic path?
- Does the documentation describe the platform matrix that CI actually operates?

If those answers are clear, the system has done more than build PyTorch. It has converted fast-moving upstream work into a dependable platform interface.

## The takeaway

Hermetic PyTorch builds are a way to make release readiness operational. They give platform teams a repeatable route from an upstream release or point release to a wheel whose dependencies, toolchain, and runtime come from an approved internal supply chain.

That matters whenever a framework update has to become something internal product teams can use immediately: on a CPU fleet, a CUDA cluster, a ROCm environment, or hardware that is only beginning to enter the stack. The real deliverable is not merely a wheel. It is a qualified, explainable, internally consumable compatibility signal attached to that wheel.

## Further reading

- [PyTorch: Building from source](https://github.com/pytorch/pytorch#building-from-source)
- [PyTorch CI documentation](https://github.com/pytorch/test-infra)
- [SLSA: Supply-chain levels for software artifacts](https://slsa.dev/)
- [Open Container Initiative image specification](https://github.com/opencontainers/image-spec)
