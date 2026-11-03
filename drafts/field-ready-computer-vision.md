---
title: "Accuracy is not the deployment contract: building field-ready computer-vision systems"
description: "A practical guide to turning computer-vision models into dependable systems: define the decision, validate the data and runtime path, monitor real inputs, and make failure actionable."
eyebrow: "Field note / applied machine learning"
context: "Computer vision · edge deployment · model operations"
audience: "For ML engineers moving a vision model from an offline experiment into a dependable product or field workflow"
status: draft
---

# Accuracy is not the deployment contract

## Building computer-vision systems that work outside the demo

A vision model can achieve an excellent score on a held-out dataset and still fail the first week it meets a real camera. The lighting changes. The lens gets dirty. A firmware update rotates an image. The crop silently changes. A server receives a different color order than training. The model continues to return a confident number, but the surrounding system no longer knows whether that number should trigger an action.

That is why this is not an article about selecting the best detector, classifier, or segmentation architecture. It is an article about engineering a **dependable visual decision path**: a path that starts with a physical input, makes a bounded prediction, attaches enough context to interpret it, and reaches a safe human or automated action.

The intended reader is an ML engineer who has a promising prototype and needs to answer a harder question: *what must be true for this system to be useful when nobody is watching the notebook?*

> A production vision system is not a model endpoint. It is a contract between the scene, the data, the runtime, the decision policy, and the people who act on the result.

## 01 / Begin with the decision, not the network

The first design artifact should be a decision contract, not a training script. A model does not create value merely by finding an object; value appears when its output changes an action safely enough to be worth taking.

For a hypothetical infrastructure-inspection camera, “detect a missing fastener” is incomplete. A decision contract makes the practical questions visible:

| Contract element | Example question | Why it matters |
| --- | --- | --- |
| Input | What camera, angle, color space, resolution, and motion conditions are supported? | Defines where the model is allowed to be trusted. |
| Target | Is the output a box, mask, class, count, or condition score? | Prevents a vague label from becoming a vague action. |
| Consumer | Does an operator review it, does it create a ticket, or does it stop a machine? | Determines the cost of false positives, false negatives, and delay. |
| Timing | What is the maximum useful end-to-end latency? | Separates an edge requirement from a batch-processing opportunity. |
| Fallback | What happens when image quality or confidence is insufficient? | Makes uncertainty an explicit product behaviour. |
| Evidence | Which image, model version, preprocessing version, and threshold produced the result? | Makes later investigation possible. |

This contract can be small. For example: *“For daylight images from Camera A, identify potentially missing fasteners with a location and confidence. Send high-confidence cases to a maintenance queue, route ambiguous cases to human review, and emit no automated action when image-quality checks fail.”* That is a much stronger starting point than “build an object detector.”

The contract also prevents a common mistake: optimizing one metric without recognizing that the system has several error costs. A false negative in a safety-oriented inspection flow may be more expensive than a false positive that creates one review task. In a high-volume consumer application, a review queue might be the expensive element. There is no universal confidence threshold; there is only a threshold justified by the decision and its fallback.

## 02 / Treat the input pipeline as part of the model

Training and serving inputs must mean the same thing. A model is sensitive to choices that often hide outside the model file: color order, image decoding, resize mode, crop policy, normalization values, orientation, frame selection, and the representation of missing metadata.

The most effective practical safeguard is an **input contract test**. Keep a small, versioned set of representative inputs and run the same preprocessing code—or an equivalence check—through both the training-side and deployed paths. For every representative image, compare:

- decoded width, height, channels, and orientation;
- crop or resize geometry;
- color ordering and numeric range;
- normalized tensor shape and dtype;
- final prediction, including any post-processing such as non-maximum suppression.

Consider a simple failure: training used RGB images resized with preserved aspect ratio and padding, while production decodes BGR images and resizes directly to a square. The process still returns valid tensors and valid bounding boxes. Unit tests that only confirm an HTTP response will pass. The model can nonetheless be wrong in a systematic, difficult-to-see way.

Data validation is one way to make this boundary observable. TensorFlow Data Validation, for example, can infer and enforce dataset schemas, report anomalies, compare training and serving distributions for skew, and compare successive data spans for drift. The specific tool is optional; the discipline is not. A production vision pipeline should have explicit expectations about image properties, label availability, class balance, source mix, and missing or malformed examples. [TensorFlow Data Validation](https://www.tensorflow.org/tfx/guide/tfdv) documents schema validation, training-serving skew, and drift detection.

### A practical data review before every new model

Before accepting a new training set or model version, review the data by the conditions that can change a decision:

1. **Source:** camera model, location, lens, firmware, codec, and capture pipeline.
2. **Scene:** lighting, weather, background, viewpoint, occlusion, motion, and density.
3. **Time:** day, season, maintenance cycle, and whether near-identical video frames leaked across splits.
4. **Label:** definition, annotator instructions, class ambiguity, disagreement, and missing labels.
5. **Action:** the cases that are most costly to miss or most costly to escalate.

Random train/test splitting is often insufficient for image data. Frames from the same video, images from the same camera, or near-identical captures from the same scene can land in both sets and make offline evaluation look much better than deployment. Hold out an entire camera, location, time window, or scene family when that better represents the next real input.

## 03 / Measure the decision, not only aggregate accuracy

Aggregate accuracy, precision, recall, or mean average precision are useful—but they are not a release decision on their own. They summarize the system after error costs, source conditions, and threshold choices have been averaged together.

Build an evaluation table that retains the important slices. For a detector, that might look like this:

| Slice | Required evidence | Release question |
| --- | --- | --- |
| Bright, clean images | Baseline precision/recall and latency | Does the standard path still work? |
| Low light or blur | Miss rate and confidence distribution | Does the model become uncertain before it becomes wrong? |
| Small or occluded targets | Recall at the action threshold | Which real cases are being missed? |
| New camera or location | Per-source metrics and input statistics | Is the training distribution still representative? |
| Empty scene | False-positive rate | Will the system create unnecessary work? |
| Ambiguous scene | Human-review rate and disagreement | Does the fallback path have enough capacity? |

The threshold belongs in this table. Rather than choosing `0.50` because it is familiar, evaluate the operating points that map to actual actions. A useful three-way policy is often clearer than a binary classifier:

```text
high confidence + input checks pass  → create the defined action
middle confidence or uncertain input → request human review
low confidence                       → record the observation, take no action
```

This does not remove model risk. It makes the system's risk allocation visible. The review queue becomes a measured component with a capacity, latency, and quality target rather than an informal exception path.

For a model update, compare more than one headline number. Require a regression table that includes the critical slices, decision thresholds, average and tail latency, memory use, model size, and the change in review volume. A small gain in aggregate accuracy is not a win if it doubles latency on the constrained device or creates unacceptable false positives in the slice that matters most.

## 04 / Design deployment as an explicit translation step

Moving a model from a training framework to a runtime is not a file-copy operation. It is a translation step with its own compatibility, numerical, performance, and packaging risks.

At the server end, a model-serving system gives operations teams tools that a notebook does not: model version policies, batching configuration, monitoring, and a stable client-facing API. [TensorFlow Serving](https://www.tensorflow.org/tfx/guide/serving) is one example of a production-serving system, and its configuration guide documents version policies, batching, monitoring, and model configuration. The architecture matters more than the product name: the system should know which model version is serving, which input schema it accepts, and how to roll back safely.

At the edge, deployment is even more specific to hardware. Current PyTorch edge tooling illustrates the principle: ExecuTorch exports a model, lowers it toward a selected backend, and runs a prepared program on the target device. The resulting program can be specialized for a CPU, GPU, NPU, DSP, or constrained embedded target; lowering and quantization decisions are part of the deployment artifact, not an afterthought. [ExecuTorch's export and lowering documentation](https://docs.pytorch.org/executorch/stable/using-executorch-export.html) explains this target-specific process.

The practical rule is: **treat each runtime artifact as a release candidate.** It needs its own identity and tests.

### The deployment parity harness

For every model candidate, run the same golden inputs through:

1. the reference training-framework model;
2. the exported or converted artifact;
3. the actual target runtime on representative hardware;
4. the complete service or device integration path.

Compare the outputs at the right layer. For a classifier, compare ordered labels and probabilities within an accepted tolerance. For a detector, compare boxes, classes, scores, and post-processing decisions. For a segmentation model, compare masks or overlap metrics. Do not stop at “the model loaded.”

Also measure the complete transaction rather than raw inference alone:

```text
capture/decode + preprocessing + inference + postprocessing + transfer + action handoff
```

An accelerator can make the core model faster while image decoding, memory copies, or post-processing consume the saved time. A field device may have strict memory, power, storage, or connectivity limits that a GPU server benchmark never exposes.

## 05 / Choose edge, server, or batch from the operating constraint

The right topology follows the decision contract:

| Path | Useful when | Main engineering concern |
| --- | --- | --- |
| Edge or embedded | Latency, privacy, bandwidth, or intermittent connectivity make a local decision necessary | Memory, power, thermal behaviour, hardware-specific export, and constrained observability |
| Online server | A request/response decision benefits from centralized compute and frequent model updates | Tail latency, batching, model versioning, load handling, and rollback |
| Batch | The action can wait and many images can be processed together | Throughput, data lineage, failure recovery, and result delivery |
| Hybrid | A device needs a fast local filter while a server performs deeper analysis or review | Consistent contracts and clear ownership of each decision |

For example, a rail-side camera with intermittent connectivity may need an on-device filter that stores only suspicious frames and metadata for later review. A central service can run a larger model when the connection is available. That is not a compromise if it is intentional: the edge and server stages should have separate success criteria and a documented handoff.

Current edge runtimes make the specialization visible. ExecuTorch describes export, transformation, compilation, memory planning, and backend selection as separate parts of preparing a program for a target device. Its documentation also notes that different target backends commonly require dedicated deployment artifacts. [How ExecuTorch works](https://docs.pytorch.org/executorch/stable/intro-how-it-works.html) is a useful model for thinking about that boundary even when another runtime is used.

## 06 / Make observability part of the prediction output

An image prediction without context is difficult to debug. A dependable system records enough structured evidence to answer, later, *what did the system see, what did it do, and why?*

At minimum, attach these fields to a prediction record:

```text
event_id                  unique request or capture identifier
captured_at               source timestamp and time zone
source_id                 camera, device, or pipeline identity
input_contract_version    expected decode and preprocessing contract
model_version             model and exported-artifact identifier
runtime_version           service, runtime, and backend version
quality_signals           blur, brightness, resolution, or capture checks
prediction                class/boxes/mask plus scores
decision                  action, review, or no-action outcome
threshold_policy_version  threshold and fallback rules in effect
trace_link                safe reference to logs, image, or review record
```

Do not assume every image can be retained. Privacy, policy, storage cost, and bandwidth may require sampling, redaction, encryption, or only storing derived evidence. The design question is not “log everything”; it is “retain enough evidence, safely, to investigate material errors.”

Use the data to monitor both system and model health:

- **System health:** request rate, errors, queue age, end-to-end p50/p95/p99 latency, device memory, thermal throttling, and artifact-load failures.
- **Input health:** resolution, brightness, blur, source mix, missing metadata, and preprocessing failures.
- **Model health:** confidence distribution, predicted class mix, review rate, delayed-label quality, and performance by critical slice.
- **Decision health:** action volume, reversal or override rate, time-to-review, and incidents tied to false positives or false negatives.

Data drift is a prompt to investigate, not an automatic verdict that the model is wrong. A change in the image distribution may reflect a new camera, a useful expansion of coverage, or a broken preprocessing path. The right response is to join the distribution change with quality signals, model outcomes, and any delayed ground truth.

## 07 / Release models with a rollback story

A model release is safer when it has a small blast radius and a known exit. The release plan should name the model version, preprocessing version, runtime artifact, threshold policy, target sources, acceptance criteria, and rollback condition.

A practical rollout sequence is:

1. **Offline gate:** validate the held-out and slice-level evaluation table, deployment parity, artifact integrity, and latency/memory budgets.
2. **Shadow path:** run the new model beside the current decision path without changing production actions; compare predictions and disagreement cases.
3. **Limited rollout:** enable a bounded set of cameras, devices, locations, or traffic while monitoring input and decision health.
4. **Promotion:** expand only after the agreed evidence is met, including review-queue impact and delayed labels where available.
5. **Rollback:** revert the model, artifact, preprocessing, or threshold policy independently when the evidence crosses the pre-defined condition.

This is a software-delivery problem and an ML problem. Google's MLOps guidance describes why ML systems need more than source-code CI: data validation, model validation, serving infrastructure, monitoring, and reproducible pipeline metadata are part of the operating system around the model. [MLOps: continuous delivery and automation pipelines](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) is a useful reference for that broader view.

## 08 / A practical test plan for a vision decision path

The following is a starting test matrix, not a checklist to copy blindly:

| Layer | Example test | What it protects |
| --- | --- | --- |
| Input | Known JPEG, PNG, rotated, grayscale, corrupt, and oversized files | Decode, orientation, color, and safe rejection behaviour |
| Preprocessing | Golden image to normalized tensor comparison | Training-serving transformation parity |
| Model | Fixed input to expected result with a documented tolerance | Model behaviour and accidental weight/artifact mismatch |
| Post-processing | Overlapping detections, empty scenes, and boundary scores | NMS, threshold, label-map, and action mapping behaviour |
| Runtime | Artifact load, first inference, steady-state latency, memory use | Export correctness and production budget |
| Integration | Request to persisted decision record | Versioning, traceability, and action handoff |
| Data | Schema, source, distribution, and label checks | Bad input, skew, drift, and silent data loss |
| Operations | Rollback drill and review-queue overload simulation | Safe failure behaviour when the system is under stress |

An example makes the difference clear. Suppose a classifier distinguishes *clear*, *uncertain*, and *defect*. A model-only test confirms the three output scores. A system test should also prove that a rotated input remains correctly oriented, an unreadable input creates no action, a borderline result reaches review, the record identifies the serving artifact, and a rollback restores the previous decision policy without losing traceability.

That is the level at which the system becomes dependable: not when every output is correct, which no real model can promise, but when expected uncertainty and unexpected failure are both handled deliberately.

## The intent, in one sentence

The purpose of a computer-vision system is not to generate a prediction; it is to make a better decision with known limits, evidence, and a safe response when the world differs from the dataset.

## Sources and further reading

- [TensorFlow Serving: serving models](https://www.tensorflow.org/tfx/guide/serving)
- [TensorFlow Serving configuration](https://www.tensorflow.org/tfx/serving/serving_config)
- [TensorFlow Data Validation](https://www.tensorflow.org/tfx/guide/tfdv)
- [Get started with TensorFlow Data Validation](https://www.tensorflow.org/tfx/data_validation/get_started/)
- [MLOps: continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning)
- [ExecuTorch: model export and lowering](https://docs.pytorch.org/executorch/stable/using-executorch-export.html)
- [How ExecuTorch works](https://docs.pytorch.org/executorch/stable/intro-how-it-works.html)
- [ExecuTorch edge platforms](https://docs.pytorch.org/executorch/stable/edge-platforms-section.html)
