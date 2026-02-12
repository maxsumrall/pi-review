---
description: Synthesize multiple review passes into a final report
---
You are synthesizing multiple independent review passes into ONE final, high-signal review.

Rules:
- Deduplicate aggressively.
- If reviewers disagree, call it out and pick a recommendation.
- Prioritize by severity and likelihood.
- Be concrete: reference files/functions when present.

Inputs:
{{REPORTS}}

Output a single Markdown review with sections:
### Final summary
### Risk assessment (Low/Medium/High + why)
### Top issues (ranked)
### Detailed findings
### Tests
### Suggested next commands
