# Task intake: difficulty, vague issues, images

_Researched and measured 2026-09-29. Section 13 of the Pullwright SaaS plan; §-references point to that plan._

Real issues arrive in three shapes the ladder never tested: short and vague ("X is broken"), carrying screenshots, and of unknown size. This section decides how Pullwright handles each. Every rule cites a source or our own measurement, and **n** is given where our samples are small.

### 13.1 Evidence

**Our own runs**

| Fact | Source |
|---|---|
| **Planned files predict effort.** Correlation with cost: planned files **0.85**, steps 0.84, requirements 0.64 (31 gpt-5-mini tasks). Calls and cost by bucket:<br>• 1–2 files: median **11 calls, $0.010**, 9/9 accepted<br>• 3–4 files: **20 calls, $0.037**, 8/8 accepted<br>• 5+ files: **28 calls, $0.089**, 10/14 accepted | stored plans × `eval-results.jsonl` |
| Issue length also correlates with cost (0.85), but that's **an artifact of our ladder**: our hard issues happen to be long specs, while real vague issues are short and can still be hard. Not used for routing. | same |
| **Weak planners under-plan.** gpt-4.1-nano planned H03 as 2 files / 6 requirements; gpt-5.4-nano planned the same issue as 4 files / 11. Difficulty read from a weak model's plan is wrong. | comparison runs |
| **Cheap models, same 5 items** (L03, L06, L10, H03, H06), reviewer fixed at gpt-5-mini:<br>• **gpt-5-mini 5/5, $0.157**<br>• **gpt-5.4-nano 4/5, $0.083**. Its one miss was *our* bug: it wrote "No blocking issues identified…" into `blocked`, which aborted the run. Fixed in `efb5b40`.<br>• gpt-5-nano 3/5, $0.051: all L items pass, both H items fail (3+ planned files)<br>• gpt-4.1-nano 2/5, $0.085<br>• **gpt-4o-mini 0/3, $0.185**: dearest *and* worst; stopped early | `bevd8nndx` |
| **`risks` carries no signal.** The planner fills it in 47 of 49 plans. `blocked` was used 2/49 times correctly (L09's missing files) and 1 time falsely (the gpt-5.4-nano case above). | stored plans |
| **H01 failure mode: ambiguity detected but resolved wrongly.** In 2 of 3 runs the planner wrote in `risks` that load/save could be sync or async, then chose async, even though the existing `Inventory` API is synchronous. The hidden test expects sync. | stored plans |
| **L09 (false premise: the issue cites files that don't exist).** The planner asked in 3 of 4 runs; in the 4th it invented the files. | eval rows |
| **Vague variants, plan stage only, gpt-5-mini** (`probe-vague.mts`, $0.003–0.004 per plan). **Asked 0 of 5 times; matched the hidden intent in 1 of 5**:<br>• **V02** ("dividing by zero gives a weird result") → RangeError, **correct, taken from the repo's existing tests**<br>• **V06** ("users want to filter the book list") → guessed `?q=` search; hidden spec is `?author=` + `?tag=`; called it "low risk"<br>• **V07** ("POST /cart/quote sometimes returns 500") → **return 200 with total 0 for missing items**; hidden spec is **400 `{error}`** for bad input; called it "small risk"<br>• **V10** ("books endpoint returns too much data", empty body) → **strip fields from each book** (a breaking change); hidden spec is **pagination**<br>• **VH01** ("inventory changes are lost on restart", empty body) → **write back into the bundled `src/data/books.json`**; hidden spec is a separate atomic JSON store<br>Every guess changed behavior. Each was written in `risks`, and none became a question. | `.spend/vague-probes.jsonl` |
| **Images: which lanes read a screenshot**, with image cost measured from the usage delta (800 px / 1600 px image):<br>• gpt-5-mini ✓ **751 / 3,001 tokens**, $0.0005 / $0.0014. Matches OpenAI's formula: 32 px patches × 1.2<br>• gpt-5-nano ✓ 938 / 3,750<br>• **gpt-4o-mini ✓ but 25,501 tokens per image** (34× gpt-5-mini)<br>• Gemini 3.5 and 3.1 Flash-Lite ✓ **1,089 fixed**<br>• Gemma-4-26b ✓ 258, but leaks `<thought>` text into the answer<br>• **Groq qwen3.8-27b ✓ 1,282, 0.55 s**<br>• **Groq gpt-oss-120b ✗** (400 "content must be a string")<br>• Gemini 3.8 Flash 503 (overloaded) | `probe-vision.mts`, `.spend/vision-probes.jsonl` |
| **GitHub attachments.** A public `github.com/user-attachments/assets/<id>` URL answers 302 → signed S3 URL → 200 image/png, **no auth needed**. The API's `body_html` (`Accept: application/vnd.github.full+json`) holds `private-user-images…?jwt=` URLs whose **JWT lifetime is exactly 300 s** (decoded). | curl on vercel/next.js#95199 |
| **How common images are**: 2/24 (next.js), 5/46 (vscode), 2/12 (supabase) of recent issues embed an image, **≈8–17%** (small samples). A GitHub search over Aug 2026 found attachment links in 4% / 32% / 16% of issues. | GitHub API |
| **Vercel AI Gateway free tier: 5 requests/min per model, team-wide** ("Retry after 60s"). This broke the vague probe on the new gateway, which only waited 30 s inline; fixed in `c606c8d` (60 s wait, proactive 5 RPM pacing). A 60-call task on one Vercel model needs ≥12 min, so splitting roles across models (plan on mini, execute on nano) doubles throughput. | backend log |

**Published research** (links verified 2026-09-29)

| Fact | Source |
|---|---|
| **SWE-bench Verified difficulty buckets** (500 tasks): <15 min 38.8%, 15 min–1 h 52.2%, 1–4 h 8.4%, >4 h 0.6%. GPT-4o resolve rate by bucket: 45.1 / 20.8 / 4.8 / 0%. Average lines changed per bucket: 5 / 14 / 50. | [OpenAI](https://openai.com/index/introducing-swe-bench-verified/), [HF dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified), [Epoch](https://epoch.ai/publications/what-skills-does-swe-bench-verified-evaluate) |
| **Patch size vs solve rate**: single-file patches under 5 lines are solved 48% of the time; 3+ files or 100+ lines under 10%; 7+ files never. | [SWE-bench-Live](https://arxiv.org/html/2505.23419v2) |
| **Routing on issue text alone barely works**: Route-AUC 0.517–0.565, where 0 = cost-proportional random. **Letting the cheap model work 1–4 turns first → 0.694–0.709** (0.780 for deepseek→gemini-3-pro). Single-model baselines: gpt-5-mini 55.6% for $16.6 across 500 tasks, deepseek-v3.2 62.4% for $22.6. | [SWE-Router, arXiv 2607.00053](https://arxiv.org/html/2607.00053v1) |
| **The scout's handoff carries the result, not the router.** A cheap model scouts first and hands over verified notes and a reproduction test. The routed system solved 159 of 266 tasks at $0.230 per solve vs Opus 4.6 alone at 158 and $1.274. "Always send to the cheapest model" with the same handoff also solved 159. | [SuperScout, arXiv 2608.04804](https://arxiv.org/html/2608.04804) |
| **Item-response difficulty prediction**: AUC 0.841, and 0.786 from problem-statement features alone. | [arXiv 2604.00594](https://arxiv.org/abs/2604.00594) |
| **Underspecification is common**: 38.3% of 1,699 SWE-bench samples were rated underspecified, on OpenAI's 0–3 rubric (0 = clear, 1 = sensible blanks, 2 = room for ambiguity, 3 = can't tell what's wanted). Distribution: 23.3 / 38.4 / 31.9 / 6.4%. | OpenAI (above) |
| **Models don't ask unless made to.** Without explicit prompting they "almost never interact". Ambiguity-detection accuracy: Sonnet 4 0.89 (3% unnecessary asks), Haiku 3.5 ≤0.63, Qwen3 Coder 0.50 (never asked). **Interaction recovered 89% of full-spec performance for Sonnet 4, 59% for DeepSeek.** | [Ambig-SWE, arXiv 2502.13069](https://arxiv.org/html/2502.13069) |
| **Ask or assume, measured** (Sonnet 4.5, vague Verified): full issue 70.8%, vague issue with no asking 54.8%, forced asking 70.4%, the agent deciding for itself 61.2%, **a separate "intent" agent 69.4%** (≈ full, p=0.458). It asked on 344 of 500 tasks, ~3 questions each; the 156 it didn't ask on resolved at 76.9%. | [arXiv 2603.26233](https://arxiv.org/html/2603.26233v1) |
| **Asking in the wild**: agents ask in 1.4% of turns; users push back after 39% of turns. | [SWE-chat, arXiv 2604.20779](https://arxiv.org/html/2604.20779v1) |
| **SWE-bench Multimodal** (617 JS tasks, 862 issue images: 401 website screenshots, 194 code screenshots, 107 diagrams, 54 error messages…; 70 tasks have video or GIF). Annotators judged images necessary in 83.5% of tasks.<br>Removing images: SWE-agent + Claude 3.5 Sonnet 16.0 → 13.0%, GPT-4o 11.0 → 8.0%. **Text-heavy images lose nothing when removed (23.1% → 23.1%); non-text images drop 13.0 → 8.7%.** Only 5.6% of original SWE-bench tasks contain an image. | [arXiv 2410.03859](https://arxiv.org/html/2410.03859) |
| **Image token rules**:<br>• OpenAI patch models: 32 px patches × multiplier (gpt-5-mini 1.2, gpt-5-nano 1.5); gpt-5/5.1 tiles: `detail:"low"` = 70 tokens<br>• Gemini 3 `media_resolution`: low 280, medium 560, high 1,120 (default), ultra 2,240<br>• Groq qwen3.8-27b: ≤3 images per request, ≤2,048 tokens each; the only vision model on Groq | [OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision), [Gemini](https://ai.google.dev/gemini-api/docs/media-resolution), [Groq](https://console.groq.com/docs/vision) |
| **Private attachments**: since 2023-05 they need a logged-in user with repo access. Community reports say app installation tokens get 404 on direct asset URLs, and GitHub staff confirmed the 5-minute signed `body_html` URLs; one support quote says no token type works for direct download. **Unverified on a private repo: test in the implementation phase.** | [changelog](https://github.blog/changelog/2023-05-08-more-secure-private-attachments/), [discussion 148227](https://github.com/orgs/community/discussions/148227) |
| **gpt-5-mini-2025-08-07 shuts down Dec 11, 2026**; OpenAI suggests gpt-5.6-terra. Our proven default must be re-qualified before then. | [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations) |

### 13.2 Difficulty: classify from the plan, not the issue

**Decision.** There is no pre-plan difficulty model. The **plan stage is the scout**: it runs read-only on a T1 lane and makes 2–13 calls. Its output sets the tier, and the tier sets the executor, the call budget and review depth.

**Why.**
- Issue-text routers are near random (SWE-Router 0.52–0.57).
- A few turns of exploration make them useful (0.69–0.78).
- SuperScout shows the scout's notes carry most of the result.
- Our own data: planned files predict cost at r=0.85, and weak planners under-plan. So the plan must come from a strong lane, and plan-derived tiers are only trusted when they do.

**Tiers** (thresholds from our buckets; provisional until P2 has n ≥ 100):

| Tier | Rule (from the plan) | Executor | Call cap | Review |
|---|---|---|---|---|
| **S** | ≤2 files, ≤6 requirements, no new package or directory | cheapest qualified lane: gpt-5-nano/5.4-nano (3/3 on L items), Flash-Lite (P2 decides) | 25 (≈2.3× the S median of 11) | 1 reviewer pass |
| **M** | 3–4 files, or 7–10 requirements | T2 with the §5 escalation triggers | 45 (≈2.3× the M median of 20) | reviewer + fix round |
| **L** | ≥5 files, >10 requirements, several packages (e.g. frontend + backend), or a new subsystem | **T1 from the start** (gpt-5-nano failed both H items at 3–5 files; only gpt-5.4-nano passed H03 at 4 files) | 80 (the current hard-task p90 was 77) | full reviewer + repair |

**Tier plumbing.**
- `classifyTier(plan, grounding)` is a pure function in `agent/tier.ts`, unit-tested. It is stored on the task and shown as a chip ("Small · ~11 requests · ~2 min").
- **Admission forecast** (§6 `capacity.ts`) uses the tier's median calls to decide whether today's free quota can finish the task. Before the plan exists, it assumes M.
- **Online correction**: if touched files exceed planned files + 2, or calls pass the tier's median × 1.5, or the gate bounces twice, the task moves up a tier. That is the same trigger set as §5 escalation, which exists now.
- **Learning**: every task logs `(tier, plan features, lanes, outcome, calls, cost)`. Once there are ≥200 labelled tasks, fit a logistic model per lane on plan features. That is the psychometrics approach (AUC 0.84), but only once we have the data, not before.
- **Bug issues get a reproduction step in the plan stage** (P2+): a failing test or command recorded as `plan.repro`. It is the part of SuperScout's handoff that carried the result, and it turns vague bug reports into concrete behavior.

### 13.3 Vague and underspecified issues

**Decision.**
1. **A separate specification check** runs before planning.
2. **Every open question goes into a structured list**, and code decides ask vs assume. The model no longer does.
3. **Interactive users see assumptions as choices** on the plan-approval screen they already visit.
4. Autonomous runs proceed on stated defaults.

**Why.**
- Models don't ask by themselves. Ambig-SWE found this, and our probe confirms it: gpt-5-mini asked 0 of 5 times and made 4 behavior-changing guesses, each labelled "low" or "small" risk.
- A separate intent agent recovers about the full-spec rate (69.4 vs 70.8%), while the agent deciding for itself only reaches 61.2%.
- Our free-text `risks` field is filled 96% of the time, so it can't drive a decision.
- Our `blocked` string was once filled with a non-answer.

**1. Spec check** (`agent/intake/specCheck.ts`)
- **One JSON call** on the plan lane, before any code exploration. Input:
  - issue title, body, comments and labels;
  - attachment transcripts (13.4);
  - grounding results (paths and symbols found or missing, which already exists);
  - the repo map's top entries.
- **Output**:
  - `underspec: 0–3`, using OpenAI's rubric verbatim, so our labels are comparable with published data;
  - `kind`: bug | feature | refactor | docs | question;
  - `questions: [{id, question, options[2–4], default, impact: blocking | behavior | cosmetic, answerableFromCode: boolean, where?}]`.
- **Cost**: about 3–5K input tokens, which is ≈$0.001 on gpt-5-mini or 1 T1 request on free lanes.
- **Score 3 or any `blocking` question with `answerableFromCode=false`** → `needs_input` straight away, *before* the planner spends 2–13 calls. Blocking examples: L09's missing files, contradictory requirements, no identifiable target.

**2. The planner resolves what the code can answer.**
- Questions flagged `answerableFromCode` go to the planner as "resolve from the codebase and cite file:line". This is the V02 case, where existing tests fixed the RangeError choice.
- The **convention rule** (H01): when options differ, pick the one consistent with the existing API and patterns (a sync class stays sync), and cite the evidence.
- The planner's `submit_plan` replaces free-text `risks` and `blocked` with **`assumptions: [{questionId?, text, chosen, alternatives[], evidence, impact}]`** and `blockingQuestion?`.
- `risks` stays only as display text for older plans; `splitBlocked` stays as the guard.

**3. The decision is made in code** (`intake/decide.ts`, pure and tested):

| Situation | Interactive (default) | Autonomous (`autoApprove`) |
|---|---|---|
| blocking, not answerable from code | `needs_input` with the question and options | fail with "needs clarification" (as today) |
| `behavior` assumption, no code evidence | **plan shows "Assumptions — pick one"** with the default preselected; approving accepts it; changing one sends a clarification to the planner (existing re-plan path) | proceed; the assumption is listed in the PR body; **the reviewer checks the patch against the stated assumptions** |
| `behavior` assumption backed by code evidence | shown collapsed with its evidence | proceed |
| `cosmetic` | a note on the plan | PR note |

- **Ask at most once per task, with at most 3 questions.** Ask-or-Assume averaged ~3 per task, and users push back when agents over-ask (SWE-chat, 39%). Each question has options, because a one-click answer beats free text.
- **Where the question appears**:
  - the Pullwright UI (`needs_input` banner and notification) now;
  - **optionally as a GitHub issue comment** (P4, opt-in per repo, since posting publicly is an outward action), with the reply read through the `issue_comment` webhook or on resume.
  - If there is no answer in 7 days, the task expires to `needs_review` with its questions. A pending question does **not** count against the free plan's 1 active task, because it holds no worker or sandbox.

**4. Evals** (P2; files `evals/vague.json` and `evals/controls.json`)
- **Build the set**:
  - vague variants of all 26 ladder items, written like Ambig-SWE's: a fixed prompt summarises each issue and drops the specifics; saved once and reviewed by hand;
  - more false-premise items like L09 (3 → 6);
  - the 26 original issues as controls, to measure unnecessary asks.
- **A simulated user** (a cheap model holding the original issue) answers questions, or says "I don't know". This is the protocol used in both papers.
- **Metrics**:
  - ask rate on vague and false-premise items;
  - **unnecessary-ask rate on controls (target ≤5%; Sonnet 4 had 3%)**;
  - questions per task (≤3);
  - **vague + answers resolve rate ≥90% of the full-issue rate** (Ask-or-Assume reached 98%, Ambig-SWE Sonnet 4 89%);
  - vague autonomous (no answers) ≥ today's.
- **Cost**: plan-only probes ≈ $0.005/item. A full vague ladder on gpt-5.4-nano is ≈ $0.40 (26 × the measured $0.017/item).

### 13.4 Images (and other attachments)

**Decision.**
1. Extract attachments from the API's `body_html` and download them **immediately**.
2. **Transcribe each image once** into structured text on a cheap vision lane.
3. Give **raw images only to the planner and reviewer**, when their lane has vision.
4. Executors see only the transcript.

**Why.**
- Signed URLs die in 300 s (measured).
- Executor lanes can be text-only (gpt-oss-120b rejects images, measured). Groq's 8K request cap can't hold code plus images.
- Resending a ~1–3K-token image on each of 30–60 executor calls wastes free TPM.
- SWE-bench-M shows a transcript is enough for text-heavy images (23.1 → 23.1%), but pixels help for non-text ones (13.0 vs 8.7%). So the planner and reviewer, who decide "what" and "is it right", keep the pixels, and the executor keeps the facts.

**1. Extraction** (`fetchIssue` in `git.ts`)
- Request `Accept: application/vnd.github.full+json` for the issue and comments.
- Collect:
  - `<img src>` from `body_html`, with alt text and the surrounding sentence ("see screenshot below");
  - video and GIF links;
  - other files (logs, zip).
- Record the position, so the transcript is placed where the image was in the text.

**2. Download** (`intake/attachments.ts`), in the worker, right after the fetch:
- **Host allowlist**: `private-user-images.githubusercontent.com`, `user-images.githubusercontent.com`, `github.com/user-attachments/…` redirecting to `github-production-user-asset-*.s3.amazonaws.com`, and `camo.githubusercontent.com`. Camo proxies external images such as imgur, so we never call arbitrary hosts.
- Downloads go through the §6b `safeFetch` guard (no private IPs, redirects only within the allowlist).
- **Limits**: ≤10 MB, content sniffed as png/jpeg/webp/gif (first frame only), ≤6 images per task, deduplicated by sha256.
- Stored in Redis (≤2 MB) or S3/R2 with the task's TTL.
- **Never pass a URL to a model provider**: private URLs can't be fetched and would leak. Send base64 data URLs; all probed lanes accept them.
- **Auth**:
  - public repos: none (measured);
  - private repos: the user's GitHub token on the API call yields the signed `body_html` URLs. **To verify on a private test repo before shipping.** If it fails, say "couldn't read 2 private attachments" and continue text-only.

**3. Size policy**
- OpenAI patch cost grows with pixels (751 → 3,001 tokens from 800 → 1600 px, measured). Gemini and Groq are fixed at ~1.1–1.3K.
- **Measure real 2560 × 1440 retina screenshots first** (probe-vision with `PROBE_LARGE`). Add `sharp` to downscale (long edge 1,568 px, still legible for UI text) **only if** those cost >3K tokens on the chosen lanes.
- Gemini: `media_resolution` stays at its default until tested through the OpenAI-compatible endpoint (unverified).

**4. Transcription** (`intake/describe.ts`)
- **One call per image**, grouped ≤3 per call for Groq. JSON output:
  - `{kind: screenshot | code | error | diagram | mockup | chart | photo | other, visibleText (verbatim, relevant parts), elements, whatLooksWrong, relationToIssue, confidence}`.
- **Lanes, by spend order**:
  - free: **Groq qwen3.8-27b** (0.55 s, 1,282 tokens, read the test image correctly) → Gemini 3.5 Flash-Lite (1,089 tokens);
  - credits or paid: gpt-5-mini ($0.0005 per 800 px image).
  - **Excluded**: gpt-oss (no vision), gpt-4o-mini (25.5K tokens per image), Gemma-4 (leaks thoughts into the answer).
- The transcript goes through `redact()`: OCR can surface keys shown in screenshots.
- Stored as `attachments[i].description`. The plan message gets an "Attachments" block.
- **The user sees what we read**: plan approval shows each thumbnail with its transcript and "Pullwright read this as…", so a misread is corrected before any code is written.

**5. Who sees pixels**

| Role | Gets |
|---|---|
| Spec check | transcripts |
| Planner (2–13 calls) | transcripts + raw images when its lane has `vision` (≤4 images; mostly cached after the first call) |
| Executor | transcripts; on vision lanes a `view_attachment(n)` tool to look again on demand |
| Reviewer | transcripts + raw images when `kind ∈ {screenshot, mockup, diagram}` |

**6. Capability data**
- `probe-vision` results feed a `vision: boolean` capability per (provider, model) in the registry/catalog.
- The router filters on it for planner and reviewer lanes when a task has images.
- If no vision lane is available, fall back to text-only, with a notice.

**7. Privacy**
- Images from private repos follow the same data policy as code: never a training lane without consent (§2).
- The wallet UI says "attachments are sent to the model providers you enabled".

**8. Video, GIF and other files**
- v1 does not analyse video (SWE-bench-M: 70 of 617 tasks had one). The task shows "Video attachments aren't analysed — add a screenshot or describe the steps."
- GIF: first frame only.
- Text files (.log, .txt ≤200 KB): included as text, redacted.

**9. Visual verification of the fix** (rendering the app in the sandbox and screenshotting it) is **research for later, not in this plan**. It needs a headless browser and a runnable app per repo, and there's no measured benefit yet.

**10. Evals** (P2)
- `evals/multimodal.json`: 6 bookstore items where the key fact is only in the image:
  - cart `$NaN` screenshot;
  - stack-trace screenshot (text-heavy);
  - UI mock with the required label order (non-text);
  - error-toast screenshot;
  - diagram of a required data flow;
  - a decoy image that doesn't matter.
- Run each with the pipeline as is (URL text only), with transcripts, and with transcripts + raw images for the planner.
- **Gate**: transcripts read the key fact in ≥9/10 fixture images on each free vision lane; multimodal items resolve with transcripts ≥ without; image tokens ≤5% of task tokens.

### 13.5 Implementation order and cost
- **Done now**:
  - `splitBlocked` (`efb5b40`);
  - gateway 60 s wait + Vercel 5 RPM pacing (`c606c8d`);
  - probes `probe-vision.mts` and `probe-vague.mts` with the vague set (`56d1b1a`, `ab859b8`).
- **P1.5 "Intake"**, before P2, so qualification measures the final pipeline:
  - attachments extraction, download and transcription;
  - spec check;
  - structured assumptions and the decision table;
  - tiers and call caps;
  - UI: assumption choices, attachment transcripts, tier chip.
  - Unit tests for `decide`, `classifyTier`, the allowlist and extraction.
- **P2** additions:
  - vague, controls and multimodal eval sets with a simulated user;
  - tier thresholds refit on n ≥ 100;
  - **re-qualify the default model before gpt-5-mini's Dec 11, 2026 shutdown** (gpt-5.4-nano and gpt-5.6-terra as candidates).
- **Intake cost per task**:
  - spec check ≈ 1 call ($0.001 or 1 free T1 request);
  - transcription ≈ 1 call per ≤3 images (free on Groq/Gemini, ≤$0.0015 per image on gpt-5-mini);
  - no extra calls for well-specified, image-free issues beyond the spec check.

### 13.6 Implementation status (P1.5, 2026-09-29)

| Piece | Where | Notes |
|---|---|---|
| Attachment extraction, signed-URL pairing, allowlisted download | `backend/src/agent/intake/attachments.ts` | tested live on vercel/next.js#95199 (paired with the signed URL, 49,942 bytes) |
| `body_html` fetch | `git.ts` `fetchIssue` (`mediaType.format: "full"`) | issue + comments |
| Transcription | `intake/describe.ts` | lanes: `PW_LANES_VISION` (default Groq qwen3.8-27b → Gemini 3.5 Flash-Lite → Vercel gpt-5-mini); private repos drop lanes that train; transcripts redacted |
| Vision capability | `llm/registry.ts` `supportsVision` | measured models only; the gateway swaps images for a note on text-only lanes |
| Image token estimate | `llm/gateway.ts` `IMAGE_TOKENS = 3000` | so base64 length never trips Groq's 8K cap |
| Spec check + decision | `intake/specCheck.ts`, `intake/decide.ts` | `PW_SPEC_CHECK=off` disables it; a failed check plans as before |
| Structured decisions | `submit_plan.assumptions`; run message lists them as approved decisions; the reviewer checks the patch against them | `risks` is optional now |
| Re-plan on changed decisions | `POST /task/:id/replan` | the plan view's "Re-plan with my choices" |
| Attachments in the UI | `GET /task/:id/attachments/:n` (owner only); `Attachments.tsx` | thumbnails + what the vision model read |
| Tiers | `agent/tier.ts` | **Change from the plan:** call caps stay with the run loop's measured file-scaled formula (40 → 80 steps). Per-tier caps (25/45/80) would have *lowered* the cap for 5-file tasks (65 today). Tiers choose lanes (`PW_LANES_RUN_S/M/L`), show a size chip, and feed forecasts |
| Probes | `scripts/pw/probe-spec.mts`, `probe-vague.mts`, `probe-vision.mts` | gates below |
