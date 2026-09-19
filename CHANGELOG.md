# Changelog

## 1.4.0 — 2026-09-19
- Renamed to Jev for Chrome (repository chy4pro/jev-for-chrome; the old URL redirects). Extension name, popup and options titles, package name and release archive name follow.
- Community project, not affiliated with TypeSafe or Browser Use; stated in the manifest description and README.

## 1.3.1 — 2026-09-19
- Follow tabs opened by a click (target=_blank, window.open); return to the opener when that tab closes.
- Fixture pages served by the test harness; new-tab task in the suite.

## 1.3.0 — 2026-09-19
- Richer model context: task in state, element `href` and `section`, worded action outcomes, visited URLs, rules that reference state fields.
- Independent `goal_done` and `stuck` checks in the same request; hesitant or contradicted DONE/BLOCKED are asked again instead of ending the run.
- Repeated-action detection that survives page-changing toggles; tolerance for two-decimal probability rounding.
- Observation drops controls covered by another block; click points use the first rendered fragment of wrapped links.
- Popup: Copy trace, goal/stuck per step. Harness: E2E_LOCALE.

## 1.2.x — 2026-09-19
- PRESS_ENTER control for fields without a submit button; SVG-safe clicks; covered-target feedback; hover-layer clicks inside one component.
- Text-helper refusals fed back to the model; clearer key diagnostics; settings migration for obsolete model ids.
- 17-task suite from the popup, the reference project, X demos and WebVoyager-style sites; recorded traces in docs/.

## 1.1.x — 2026-09-19
- Stale-safe executor (one click, no implicit Enter, freshness and occlusion guards), deadlock detection, strict answer validation, service-worker settings race fixed.
- Headless-Chromium harness that loads the built extension (npm run e2e:ext).

## 1.0.0 — 2026-09-18
- Initial release.
