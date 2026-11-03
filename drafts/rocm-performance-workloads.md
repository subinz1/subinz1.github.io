---
title: "Performance is a systems property: reading PyTorch workloads on ROCm"
description: "What recent PyTorch work on FP8, MoE, attention, communication, and fault recovery says about building performant and dependable AMD GPU workloads."
eyebrow: "Field note / PyTorch performance"
context: "ROCm · TorchTitan · distributed training"
audience: "For ML infrastructure engineers, performance practitioners, and PyTorch users"
status: draft
---

# Performance is a systems property

## What recent PyTorch workloads on ROCm reveal about building faster, more dependable AI systems

Performance work on ROCm is no longer just about getting a model to run on an AMD GPU. The useful question is more specific: *which part of this workload is limiting progress?*

For one job, the answer is matrix-multiply throughput. For another, it is a chain of small kernels moving intermediate tensors through HBM. For a Mixture-of-Experts model, the cost can shift to token routing and All-to-All communication. At a thousand GPUs, the limiting factor may be whether the job can survive the next node failure without throwing away useful work.

That is the thread connecting recent PyTorch, TorchAO, TorchTitan, and Monarch work on ROCm. The performance story is not one benchmark or one library. It is a systems story: choose the right numerical format, compile the right kernel, keep data moving efficiently, overlap communication, and make recovery part of the training design.

> A workload is performant only when its math, memory, network, compiler, and operating model agree on what the bottleneck is.

## 01 / The workload chooses the bottleneck

Dense transformers and sparse MoE models can both use FP8, but they do not fail—or accelerate—for the same reasons.

For a dense transformer, large GEMMs are usually the primary opportunity. The upstream TorchAO and TorchTitan FP8 work reports a 13.4% throughput gain over BF16 for Llama 3 8B on 8× MI300X GPUs, using `torch.compile`, FSDP2, and selective activation checkpointing. Peak memory remained nearly unchanged at about 39 GB, which is an important distinction: the reported win came from faster FP8 matrix-core execution, not from fitting a larger model in memory. [The FP8 training study](https://pytorch.org/blog/fp8-training-on-amd-gpus-with-torchtitan-and-torchao-upstreaming-performance-improvements/) documents the exact configuration and constraints.

MoE changes the shape of the problem. A router sends each token to only a few experts, producing uneven, often small batches for each expert. That creates three coupled bottlenecks:

1. **Micro-GEMMs:** each expert may receive too few tokens to saturate the GPU.
2. **Expert traffic:** tokens and outputs move between the ranks that own the selected experts, making All-to-All communication central to the step time.
3. **Parallelism bubbles:** FSDP, pipeline, tensor, and expert parallelism can leave parts of the system idle when their schedules do not line up.

The 1,024-GPU TorchTitan study makes those interactions tangible. Its DeepSeek-V3 and Llama 4 experiments pair FSDP, pipeline parallelism, and expert parallelism with ROCm-tuned kernels. The authors report a 2.77× end-to-end improvement for DeepSeek-V3 671B from kernel-level optimization, 96% scaling efficiency from 128 to 1,024 MI325X GPUs, and 100–102% scaling efficiency for Llama 4-Scout from 32 to 512 GPUs in that measured setup. [The MoE pre-training study](https://pytorch.org/blog/efficient-moe-pre-training-at-scale-with-torchtitan/) also provides the network and topology context behind those numbers.

Those results should be read as engineering evidence, not universal platform claims. The cluster used 400 Gb/s RoCE v2 networking and a full-bisection fat-tree topology. The same model with a different interconnect, expert-parallel degree, batch shape, or software revision can move the bottleneck somewhere else.

## 02 / Most of the MoE win was not the GEMM

The most useful finding in the FP8 work is that quantization overhead can dominate the supposedly faster low-precision path.

Before optimization, a DeepSeek-V3-shaped FP8 workflow repeatedly computed scales, applied them, clamped values, and cast data in separate kernels. Each stage wrote an intermediate result to high-bandwidth memory, then the next stage read it back. Across many experts, the surrounding data movement and launches became more expensive than the 8-bit arithmetic.

The fixes followed a clear order:

| Constraint | Change | Reported result in the studied shape |
| --- | --- | --- |
| Redundant layout conversion | Removed transpose/copy work before GEMM | 4.2× backward-pass improvement on DeepSeek-MoE-16B |
| Repeated quantization launches | Fused scale-and-cast work into Triton kernels | +17% end-to-end on DeepSeek-V3 671B; 89% of the FP8 overhead recovered |
| Non-coalesced writes | Transposed through local data share before storage | 6.2× faster per-MoE-layer scale kernel on DeepSeek-V3 shapes |
| Unneeded atomic fences | Used relaxed ordering where the reduction semantics permitted it | Lower synchronization overhead on AMD GPUs |

This leads to a practical rule: **before tuning a GEMM, inspect how much data is being moved to prepare for it.** A profiler trace that shows a small computation surrounded by scale, cast, copy, and synchronization kernels is an invitation to fuse or eliminate work—not to add more arithmetic tuning.

The same study records a useful non-result. Expanding the Triton autotuning search space for Llama 4 shapes on MI300X did not produce a measurable improvement and increased first-iteration compilation time. Autotuning should respect the hardware’s wavefront size, local-data-share capacity, and register pressure; more candidate configurations are not automatically better.

## 03 / Correctness is part of the performance budget

FP8 exposes a problem that ordinary throughput charts can hide. AMD Instinct uses an FNUZ FP8 variant whose range differs from a format initially assumed in parts of the training stack. Selecting the wrong maximum value silently clipped activations and corrupted gradients without producing a NaN signal.

The upstream solution was not a performance flag. It was platform detection, the correct dtype and scale selection, accurate MFU reporting, and hardware-appropriate loss baselines. Only after that correctness work could FP8 throughput figures be trusted.

This is the performance discipline I would carry into any PyTorch workload:

- Measure tokens per second, latency, memory, and compile time.
- Validate loss, numerical parity, and convergence at the same time.
- Keep the precise GPU, ROCm, PyTorch, compiler, model, sequence length, batch shape, and parallelism configuration with every result.

A faster run that changes model quality is not a faster training system.

## 04 / Attention, memory, and communication are first-class work

Recent PyTorch releases show ROCm performance work spreading beyond FP8 training.

PyTorch 2.12 added expandable segments to the ROCm caching allocator, which can reduce fragmentation in long-running workloads. It added rocSHMEM support for symmetric-memory collective operations, including MoE-oriented All-to-All patterns, and enabled FP8 semi-structured sparsity through hipSPARSELt on supported hardware. Its Inductor FlexAttention change uses two-stage Triton pipelining and reports 5–26% gains across causal, ALiBi, and sliding-window attention patterns on MI350X. [The PyTorch 2.12 release post](https://pytorch.org/blog/pytorch-2-12-release-blog/) is a useful map of those changes.

The common thread is reducing time spent outside useful model computation:

- allocator behavior determines whether a long process keeps usable memory;
- attention kernels decide whether common sequence patterns overlap memory and compute well;
- collectives decide whether additional GPUs improve throughput or only add waiting;
- compiler choices decide whether the right operation reaches the right backend.

PyTorch 2.14 extends the ROCm compiler path with grouped GEMM lowering, Composable Kernel templates under JIT compilation, and an analytical tile-size selector for ROCm max-autotune. The significance is practical: MoE should not fall back to an inefficient loop of individual BLAS calls merely because its expert batches are irregular. [The PyTorch 2.14 release post](https://pytorch.org/blog/pytorch-2-14-release-blog/) describes those ROCm-specific changes and their scope.

## 05 / Profile from the workload down to the kernel

The difference between a useful profile and a misleading one is whether it preserves the question being asked. A model operator can look slow because its kernel is slow, because data was not ready, because a collective held the stream, or because the host was waiting to launch the next unit of work. Those require different fixes.

ROCm's documentation suggests a layered approach rather than beginning with a long list of low-level counters:

1. **Start with an application trace.** Identify the longest kernels, memory copies, GPU idle periods, and host-side gaps. PyTorch Profiler can provide an operator-level view and export a trace for Perfetto; `rocprof` gives a ROCm-level view of the application.
2. **Attribute kernels to framework operations.** ROCm Compute Profiler's experimental `--torch-trace` mode connects PyTorch operators, GPU kernels, and hardware counters. That makes it possible to ask whether a named layer is compute-bound, memory-bound, or waiting on a dependency instead of guessing from the model source.
3. **Use counters only after locating the expensive work.** Hardware counters are powerful but easy to over-collect. Choose counters that test a hypothesis about one hot kernel: occupancy, cache behavior, memory traffic, or instruction mix.
4. **Measure communication separately.** A clean kernel trace does not prove that a distributed step is healthy. Profile the critical collective and inspect how much of it overlaps useful compute.

For example, ROCm Compute Profiler documents the following shape for an operator-to-kernel trace:

```bash
rocprof-compute profile --experimental --torch-trace --name workload -- python train.py
```

That command is a diagnostic tool, not a benchmark harness. Instrumentation changes timing, and the feature is explicitly experimental. The ROCm documentation also notes that trace coverage depends on the PyTorch version: newer supported PyTorch releases provide fuller operator coverage, while older integrations can omit backward-pass operations created in child threads. Keep a non-instrumented steady-state measurement beside the trace, and record the installed PyTorch and ROCm package combination before comparing results. [ROCm Compute Profiler's profile-mode guide](https://rocm.docs.amd.com/projects/rocprofiler-compute/en/develop/how-to/profile/mode.html) explains those limits.

This two-view method changes the conversation. Instead of saying, “training is slow on this GPU,” an engineer can say, “the expert MLP is memory-bound after quantization,” “the all-reduce begins late because the preceding stream is serialized,” or “the host has a launch gap after a dynamic-shape graph break.” Each statement points to a testable next action.

## 06 / The network is part of the workload design

At multi-GPU scale, the collective library and the topology are part of the model's effective architecture. RCCL is ROCm's communication library for multi-GPU and multi-node collectives, optimized for AMD GPU paths such as PCIe and xGMI. The relevant question is not simply whether an AllReduce or All-to-All works; it is whether the chosen process layout, memory mode, network, and library version let it overlap with the rest of the step. [The RCCL overview](https://rocm.docs.amd.com/projects/rccl/en/latest/) frames that scope.

The TorchTitan MoE result is a good illustration. In its study, raising the expert-parallel degree made the baseline communication share grow sharply and reduced tokens per second. With the DeepEP communication path, the study kept communication to a much smaller share of the step for that specific cluster and model configuration. The lesson is not that any one library automatically solves MoE. It is that token routing, expert placement, network bandwidth, and the communication schedule must be designed together.

ROCm's RCCL guidance is deliberately hardware-aware. It distinguishes supported partitioning modes and gives separate advice for MI300X, MI350X, and MI355X configurations; it also calls out symmetric memory and peer-to-peer prerequisites. One single-OAM MI300X AllReduce example in the documentation reports roughly 315 GB/s with an optimized configuration versus roughly 170 GB/s with its default configuration. That is a useful diagnostic reference, not a promise of application-level throughput: the result depends on the tested topology, software version, collective size, and configuration. [RCCL usage tips](https://rocm.docs.amd.com/projects/rccl/en/docs-7.14.1/how-to/rccl-usage-tips.html) should be treated as versioned operational guidance, not a collection of universal environment variables to copy into every job.

That caution matters because the right control can be harmful when transplanted. A process-layout setting that helps a fully connected topology may constrain another partitioning mode. A collective tuning flag may only be useful after the PyTorch-bundled RCCL version supports it. Before keeping a communication setting, test it against the real message sizes, number of ranks, and fabric used in production—and keep a baseline that proves it helped.

For an ML infrastructure team, this means communication needs its own acceptance checks:

- benchmark the collectives that occur in the actual training or serving step, not only a convenient synthetic size;
- record topology, rank mapping, RCCL/ROCm/PyTorch versions, and process layout with each result;
- look at tail latency and overlap, not only peak bandwidth;
- rerun the check when the cluster, driver, container, or parallelism configuration changes.

## 07 / At cluster scale, recovery is a performance feature

Throughput without recovery is fragile throughput. At hundreds of GPUs, a memory error, failed node, or network partition is not an unusual event; it is an operating condition.

The Monarch-on-ROCm work connects performance to this reality. It combines a single-controller runtime, RCCL, RDMA, TorchTitan, and TorchFT across SLURM, Kubernetes, and SkyPilot. When a training actor fails, a supervision tree isolates it; healthy replicas keep progressing, the failed unit is restarted, and a peer can provide the state needed to rejoin at a quorum boundary.

The published validation includes fault injection on a 16-node MI300 cluster and a 32-node MI355 Kubernetes cluster. In both cases, the reported loss curves continued to converge while workers recovered, rather than requiring a full-job restart. [The Monarch ROCm post](https://pytorch.org/blog/bringing-pytorch-monarch-to-amd-gpus-single-controller-distributed-training-on-rocm/) makes the key point clearly: a system that spends less time idle after a fault delivers more useful training, even if its nominal kernel benchmark is unchanged.

## 08 / A performance plan that can survive contact with production

For a team evaluating a PyTorch workload on ROCm, I would use this order of work:

1. **Describe the workload before optimizing it.** Record model family, precision, sequence-length distribution, batch shape, GPU topology, interconnect, and the parallelism plan. Separate dense, attention-heavy, and MoE paths.
2. **Establish reproducible baselines.** Measure eager and `torch.compile` runs with the same inputs. Capture steady-state throughput, first-iteration compile cost, peak memory, and a correctness signal.
3. **Profile by category.** Break time into GEMM, attention, pointwise and quantization kernels, allocator activity, host waits, collectives, and communication-compute overlap. Start with the application trace, then use framework attribution and targeted counters only where they answer a concrete question.
4. **Use the right lever for the bottleneck.** Prefer fusion and fewer HBM round-trips for quantization overhead; grouped GEMM and expert-routing work for MoE; communication overlap and topology awareness for distributed steps; allocator improvements for fragmentation.
5. **Test representative shapes.** A single maximum-throughput shape can hide decode latency, dynamic batch effects, skewed routing, long-context attention behavior, or different collective message sizes.
6. **Treat convergence and recovery as acceptance criteria.** Run enough steps to identify numerical drift, then inject realistic failures at multi-node scale. A fast path that cannot recover is unfinished.
7. **Make the evidence durable.** Save the trace, benchmark recipe, environment, and pass/fail threshold with the change that produced the result. Otherwise the next ROCm, PyTorch, or cluster upgrade resets the investigation to guesswork.

This approach is also a useful CI boundary. Correctness CI should protect builds, APIs, numerical behavior, and representative small workloads. Performance regression tracking needs controlled hardware, pinned configurations, warm-up rules, and noise-aware thresholds. Mixing them into one undifferentiated pass makes both signals less trustworthy.

## The takeaway

The strongest ROCm results are coming from upstream PyTorch systems work, not isolated vendor patches: TorchAO format support, TorchTitan recipes, Inductor and Triton kernels, ROCm collectives, allocator behavior, and fault-tolerant orchestration.

That makes the opportunity broader than one accelerator backend. The durable method is portable: understand the workload shape, establish a compiled baseline, remove unnecessary movement and synchronization, prove numerical behavior, and design the operating path—including failure recovery—with the same care as the kernel path.

## Sources and further reading

- [FP8 Training on AMD GPUs with TorchTitan and TorchAO: Upstreaming Performance Improvements](https://pytorch.org/blog/fp8-training-on-amd-gpus-with-torchtitan-and-torchao-upstreaming-performance-improvements/)
- [Efficient MoE Pre-training at Scale on 1K AMD GPUs with TorchTitan](https://pytorch.org/blog/efficient-moe-pre-training-at-scale-with-torchtitan/)
- [PyTorch 2.12 Release Blog](https://pytorch.org/blog/pytorch-2-12-release-blog/)
- [PyTorch 2.14 Release Blog](https://pytorch.org/blog/pytorch-2-14-release-blog/)
- [Bringing PyTorch Monarch to AMD GPUs: Single-Controller Distributed Training on ROCm](https://pytorch.org/blog/bringing-pytorch-monarch-to-amd-gpus-single-controller-distributed-training-on-rocm/)
- [Maximizing training throughput using PyTorch FSDP](https://pytorch.org/blog/maximizing-training/)
- [Experience the power of PyTorch 2.0 on AMD Solutions](https://pytorch.org/blog/experience-power-pytorch-2-0/)
- [RCCL documentation](https://rocm.docs.amd.com/projects/rccl/en/latest/)
- [RCCL usage tips](https://rocm.docs.amd.com/projects/rccl/en/docs-7.14.1/how-to/rccl-usage-tips.html)
- [ROCm Compute Profiler: profile mode](https://rocm.docs.amd.com/projects/rocprofiler-compute/en/develop/how-to/profile/mode.html)
- [ROCm workload optimization guidance](https://rocm.docs.amd.com/en/docs-7.0.2/how-to/rocm-for-ai/inference-optimization/workload.html)
- [Using rocprof](https://rocm.docs.amd.com/projects/rocprofiler/en/latest/how-to/using-rocprof.html)
