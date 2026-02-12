---
description: Overall high-signal code review (review-only)
---
{{SCOPE}}

Hard rules:
- Review only. Do NOT edit files.
- If you spot an issue, propose a fix in prose or small patch snippets, but don't apply it.

Focus:
- Correctness, edge cases, invariants
- Error handling, observability
- Performance/concurrency risks
- Tests that de-risk regressions

Output a single Markdown review with sections:
### Summary
### Risk assessment (Low/Medium/High + why)
### Blockers (must-fix)
### Major issues (should-fix)
### Minor issues (optional)
### Tests (what's missing + targeted suggestions)
### Suggested next commands

End your response with:
[[PI_REVIEW_STAGE_DONE]]
