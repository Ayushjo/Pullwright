# Recording the demo video (≈90 seconds)

The landing page shows `frontend/public/demo.mp4` automatically once it exists: H.264, 1920×1080 or 1440×900, under 10 MB. Add `frontend/public/demo-poster.png` as the still frame.
Until then, the demo section links to a real public replay (`/r/<taskId>`), which costs nothing to show.

## Shot list
| # | Seconds | What to show | Say / caption |
|---|---|---|---|
| 1 | 0–8 | A GitHub issue (e.g. devin-test-app #3) | "A real issue on a real repo." |
| 2 | 8–15 | Paste the URL into **New task**, with "approve the plan" ticked | "Paste it. Nothing runs yet." |
| 3 | 15–30 | The **plan card**: requirements R1–R5, steps; edit a step or drop a requirement | "You approve, or edit, the plan." |
| 4 | 30–50 | **Activity**: reads, patches, `npm test` running in the sandbox; send a note | "It works in a sandbox with no network, and you can steer it." |
| 5 | 50–65 | **Review** tab: validation before/after, reviewer requirement checklist | "Every change is validated and independently reviewed." |
| 6 | 65–78 | **Changes** tab: diff, untick a file | "You review the diff." |
| 7 | 78–90 | **Publish PR** → the draft PR on GitHub with its summary and tables | "Then it opens the pull request. This one cost 4 cents." |

## Tips
- Use a task that already finished for shots 4–6 (Activity replays instantly), and a fresh one only for shots 2–3.
- A good cheap issue to record: *"Add a `clamp(value, min, max)` helper to src/math.js with tests"* on `devin-test-app` (≈$0.01).
- Record with the browser at 90% zoom so the three-column task view fits.
- To make a replay public, click **Share replay** on a finished task; the link is `/r/<taskId>`.
