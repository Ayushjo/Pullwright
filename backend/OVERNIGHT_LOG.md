
## P1 gateway — live gates (2026-09-29)

**Pinned gpt-5-mini through the gateway (Vercel), 10 ladder items, one run each:** 10/10 — every item accepted, and L09 blocked as designed. That matches P0.
- **Cost:** easy items are the same as P0 (L01 $0.007, L04 $0.010, L07 $0.011, L11 $0.016).
- Hard items H04 and H10 cost more in all 4 P1 runs:
  - H04: $0.089 and $0.068, vs P0's $0.028–0.030. P1 had 2 gate bounces in each run; the parser's line numbers were wrong.
  - H10: $0.106 and $0.121, vs P0's $0.064–0.095.
  - A re-run of H04 **failed** its hidden test (1/2 on P1, against 2/2 on P0).
- **Transport checked:** the request body is parameter-for-parameter identical to P0, the renderer strips the sidecars, and the backend log shows no gateway retries, timeouts or errors. The extra cost is extra turns, i.e. model variance.
- **Unresolved at n = 2–3 per item:** re-measure with more seeds in P2.

**Free lanes in the GUI** (`lanes/free.env`): L10 planned on the Vercel credit, executed on Gemini 3.5 Flash-Lite (11 calls, $0) and reviewed on Groq gpt-oss-120b ($0). It finished ready, the hidden test passed, and streaming worked in the GUI.

**Live failover** (`lanes/chaos-failover.env`): the first run lane is a model that doesn't exist. It failed once (404 → `model_gone`), and every later call went straight to Flash-Lite. L02 finished ready and passed its hidden test.

**Found and fixed on the way:**
- Vercel's free tier allows only 5 requests/min per model, and the gateway only waited 30 s inline. It now waits up to 65 s, parses "Retry after 60s", and paces requests itself (`c606c8d`).
