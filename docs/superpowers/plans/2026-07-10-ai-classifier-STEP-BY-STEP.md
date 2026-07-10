# AI Classifier Rebuild — Step-by-Step Guide

Ties together the spec + 3 plans into one execution order. Spec: `docs/superpowers/specs/2026-07-10-ai-classifier-architecture.md`.

## What you're building (one line)
Close-up (lesion) mode: EfficientNet-B0 classifies **locally**, Gemini only **explains the JSON**, works **offline** with built-in explanations, UI is **responsive** (phone/iPad/desktop). Face mode is untouched.

## The three plans, in order

| # | Plan | File | Depends on | Produces |
|---|---|---|---|---|
| 7 | Inference platform | `plan-7-inference-platform/` | — | Python FastAPI classifier + backend wiring + offline fallback; **app works end-to-end with a dev (untrained) model** |
| 8 | Dataset & training | `plan-8-dataset-training/` | 7 (transforms, registry) | Reproducible master dataset + train/evaluate/promote toolkit; **produces a real trained model** |
| 9 | Responsive UI + decommission | `plan-9-responsive-lesion-ui/` | 7 (wire contract, routes) | Responsive lesion result view + reconnect upgrade; removes the old browser classifier |

**Run 7 → 9 → 8**, or **7 → 8 → 9**. Both valid. Recommended: **7 → 9 → 8** — after 7+9 you have a fully working, testable app on the dev model (fake predictions, real plumbing), so you can see/verify the whole UX before spending hours on dataset downloads + training in 8.

## Before you start (one-time prerequisites)

1. **Confirm cwd + branch**
   ```bash
   cd "/Users/febrielotud/Desktop/Skin analysis"
   git checkout -b feat/ai-classifier   # isolate the whole effort
   ```
2. **Python env** already exists (`.venv`, has torch). Plan 7 Task 1 installs the rest.
3. **Docker running** (for the compose smoke test at the end of Plan 7) — it is.
4. **No API key needed to start:** blank `GEMINI_API_KEY` → explanations fall back to built-in, everything else works. `FAKE_CLASSIFIER=1` → no Python needed for frontend/backend work.
5. **Dataset accounts (only for Plan 8):** ISIC Archive + Kaggle logins for the downloads. Not needed for 7 or 9.

## Execution loop (per plan)

Each plan is TDD, bite-sized, commit-per-task. For every task:

```
1. Read the task's files list.
2. Write the failing test (Step 1).
3. Run it — SEE it fail (Step 2). Do not skip this.
4. Write the minimal implementation (Step 3).
5. Run the test — SEE it pass (Step 4).
6. Commit (Step 5).
```

**Gates that must stay green the whole way** (run after each plan, ideally each task that touches them):
- `npm run typecheck && npm run typecheck:server`
- `npx vitest run`  (Node + frontend tests)
- `make -C ai test` (Python tests — from Plan 7 Task 1 onward)

**Behavior-preservation check:** face-mode test counts must not change until Plan 9 Task 5 (which intentionally deletes the verdict/quality-gate tests). Note the number before you start.

## Milestones you can stop and verify at

- **After Plan 7:** `FAKE_CLASSIFIER=1 npm run dev:lite` → close-up upload returns a lesion report (fake Melanoma) with a Gemini or built-in explanation; `make -C ai serve` + `curl localhost:8000/healthz` works; `make build` builds all 3 images.
- **After Plan 9:** the lesion result renders responsively at 375 / 768 / 1280 px (preview tool screenshots); offline shows the built-in banner; reconnect upgrades in place; old browser classifier is gone and the suite is green.
- **After Plan 8:** `make -C ai build-master && make -C ai train && make -C ai evaluate && make -C ai promote` produces a real `ai/models/production/` model; restart inference to load it; predictions are now meaningful.

## How to actually run it (two options)

**Option A — dispatch to subagents (recommended, fast):** one fresh subagent per task, you review between tasks. See "Execution handoff" below.

**Option B — inline, batched:** work the tasks yourself in a session using `superpowers:executing-plans`, checkpointing every few tasks.

Either way the plans are self-contained — an engineer with zero context can follow them.

## Safety invariants that must survive (spot-check before merge)
- A malignant class in the top-3 (Melanoma / BCC / SCC ≥ 0.15) **always** yields referral guidance — online, offline, and on abstain.
- Gemini **never** receives the image (grep: only `explainProvider` sends text; `imageB64: ""`).
- Abstain shows "inconclusive", never a scary label headline.
- Every explanation carries the non-diagnosis disclaimer.
- `models/` is never overwritten — promotion archives the old version.

## When it's all done
- `superpowers:finishing-a-development-branch` → merge `feat/ai-classifier` to `main`.
- Update `PROJECT.md` (provider/pipeline/model story) + file the outcome to Obsidian.
