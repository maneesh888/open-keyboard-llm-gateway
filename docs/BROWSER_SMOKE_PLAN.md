# Observed Gateway browser walkthrough

Use for changed admin wording, screens, navigation, model controls, or playground journeys. This is observed usability evidence, separate from `./scripts/check-e2e.sh` and live-provider transport proof.

## Safe target

Build the current checkout and run `node scripts/browser-fixture.mjs`. It starts the production gateway entry point with disposable state and local fixture upstreams. Use the printed loopback URL. Sign in with the public fixture account `fixture-admin` / `fixture-password`. It never uses your existing configuration, keys, processes, or model-service controller. Stop this exact process with Ctrl-C when finished; it removes its own state. Do not reuse an unrelated running server.

A fixture walkthrough can establish visible layout, interaction and recovery, but never real inference or provider availability. For live-result presentation requirements, use an explicitly configured live target bound to the same checkout and the same synthetic public input. Keep secrets and raw live output out of retained evidence. Never run start/stop/delete actions on real resources merely to prepare proof.

## Walk the affected journey

Use a browser-control tool or Computer Use to operate visible production controls. Do not inject DOM state, call UI functions directly, seed browser authentication, intercept gateway requests, or treat tool action success as visual acceptance. Inspect the resulting screen.

1. At desktop and a narrow viewport, sign in, inspect orientation and the next action. Exercise failed sign-in and its recovery when auth UI changed.
2. Create a disposable key, inspect default-model and limit wording, cancel/reopen edits, save, and verify the displayed result. Check disable/enable/delete only for the created fixture key. Inspect reveal/copy, then hide credentials before capture.
3. Follow the key's Live test action. Verify the selected key/model remains consistent and the action explains that it sends a request. Run a public synthetic request. Inspect loading, result, retry/reset, and navigation back.
4. For model-control changes, distinguish key enabled, metadata availability, loaded state and inference outcome. In the fixture, exercise start/stop. Read setup help and check that guidance is advisory.
5. Check accessible labels, visible keyboard focus, Tab/Shift-Tab order, Enter/Space actions, modal focus/return, browser back and narrow-screen scrolling. Check zoom/long-value fit on affected controls. Record any behavior you could not inspect; automated accessibility metadata alone is not acceptance.

## Record and deliver

Record capture SHA, clean current SHA, browser/version, viewport, target class (`fixture` or `live`), actions, observed results, artifact references, and unresolved findings. Every new commit expires this proof. Capture only safe screens; no visible keys, passwords, tokens, private config or raw live responses. Keep artifacts outside tracked files. Inspect captures and render required safe screenshots in the final response.

Use `observed:<full-sha>:<inspectable-reference>` in the PR's Workflow browser proof field. The independent reviewer must inspect the referenced evidence and assess each acceptance row. Metadata validation checks presence/head binding, not whether an image exists or the UI is usable.

If browser interaction or visual inspection is unavailable, retain `RUNTIME_UNVERIFIED` and the affected `UNVERIFIED` rows. After disclosing exact gaps and the current SHA, the existing exact-head owner approval route can accept only overridable visual proof risk. Record `human-approved:<full-sha>:<approval-reference>` and the existing human authorization fields; never relabel this as AI-observed proof. Mandatory tests/security/API gates remain required.
