import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";

type ReviewTarget =
	| { kind: "worktree" }
	| { kind: "staged" }
	| { kind: "pr"; prNumber: number }
	| { kind: "recent"; baseSha: string };

type ParsedTarget = ReviewTarget | { kind: "recentPicker"; limit: number };

function clampInt(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function parseArgs(argsRaw: string): ParsedTarget | null {
	const args = String(argsRaw || "").trim();
	if (!args) return null;

	// Very small convenience parser (doesn't add new commands):
	//   /review staged
	//   /review worktree
	//   /review 123
	//   /review recent [N]
	if (/^(staged|stage)$/i.test(args)) return { kind: "staged" };
	if (/^(worktree|wt|working-tree)$/i.test(args)) return { kind: "worktree" };

	const recent = args.match(/^recent(?:\s+(\d+))?$/i);
	if (recent) {
		return { kind: "recentPicker", limit: clampInt(Number(recent[1] ?? 50), 10, 200) };
	}

	const m = args.match(/^(?:#)?(\d+)$/);
	if (m) return { kind: "pr", prNumber: Number(m[1]) };

	return null;
}

function buildPrompt(target: ReviewTarget): string {
	const common =
		`You are doing a high-signal code review.\n\n` +
		`Hard rules for this run:\n` +
		`- Do NOT implement changes. Do NOT edit files. Review only.\n` +
		`- If you spot an issue, propose a fix in prose or small patch snippets, but don't apply it.\n\n` +
		`Review priorities (in order):\n` +
		`1) Correctness / logic errors\n` +
		`2) Security / auth / secrets\n` +
		`3) Error handling & observability (logs/metrics)\n` +
		`4) Data correctness (schemas/migrations/serialization)\n` +
		`5) Performance / concurrency / idempotency\n` +
		`6) Tests (missing/weak tests)\n\n` +
		`Additional instructions:\n` +
		`- Pretend you are Linus Torvalds doing a kernel patch review: be terse, blunt, and ruthlessly high-signal.\n` +
		`- Simultaneously apply a FAANG Staff Engineer lens (a week before performance review, on their A-game for a promotion).\n` +
		`- No sugarcoating. No generic praise. Focus on what's wrong, risky, or missing, and how to fix it.\n` +
		`- Tag bullets with [Linus] or [Staff] when the lens matters.\n\n` +
		`Linus lens (blunt kernel-maintainer style):\n` +
		`- Demand simplicity and minimal diff. Reject cleverness, unnecessary abstractions, and magic.\n` +
		`- Be strict about naming, invariants, APIs, and failure modes. Ask "what breaks?" for every change.\n` +
		`- No handwaving. Cite exact file/function and propose concrete fixes.\n\n` +
		`Staff engineer lens (top-tier promotion-driven review):\n` +
		`- Focus on operational risk, long-term maintainability, rollout plans, and backward compatibility.\n` +
		`- Demand observability (logs/metrics/traces), error handling, and idempotency.\n` +
		`- Require tests that de-risk regressions and edge cases. No "trust me" code.\n\n` +
		`Output a single Markdown review with sections:\n` +
		`### Summary\n` +
		`### Risk assessment (Low/Medium/High + why)\n` +
		`### Blockers (must-fix)\n` +
		`### Major issues (should-fix)\n` +
		`### Minor issues (optional)\n` +
		`### Tests (what's missing + targeted suggestions)\n` +
		`### Suggested next commands\n\n`;

	switch (target.kind) {
		case "worktree":
			return (
				`Review my local working tree changes (staged + unstaged + untracked).\n\n` +
				common +
				`Process:\n` +
				`1) Establish scope:\n` +
				`   - git status --porcelain=v1\n` +
				`   - git diff --name-only\n` +
				`   - git diff --cached --name-only\n` +
				`   - git ls-files --others --exclude-standard\n` +
				`2) For each changed file, inspect patches:\n` +
				`   - git diff --patch -- <path>\n` +
				`   - git diff --cached --patch -- <path>\n` +
				`3) For untracked files, open and read content directly.\n`
			);
		case "staged":
			return (
				`Review my staged changes only.\n\n` +
				common +
				`Process:\n` +
				`1) Establish scope:\n` +
				`   - git status --porcelain=v1\n` +
				`   - git diff --cached --name-only\n` +
				`2) Inspect each staged file:\n` +
				`   - git diff --cached --patch -- <path>\n`
			);
		case "pr":
			return (
				`Review GitHub PR #${target.prNumber} in this repo.\n\n` +
				common +
				`Process (use gh CLI):\n` +
				`1) gh pr view ${target.prNumber} --json title,body,author,baseRefName,headRefName\n` +
				`2) gh pr diff ${target.prNumber}\n` +
				`If gh is unavailable or errors, tell me exactly what to run / paste instead.\n`
			);
		case "recent":
			return (
				`Review the commits from base commit ${target.baseSha} (inclusive) to HEAD.\n\n` +
				common +
				`Process:\n` +
				`1) Inspect the base commit itself:\n` +
				`   - git show ${target.baseSha}\n` +
				`2) Try to review the full range (inclusive):\n` +
				`   - git log --oneline --decorate ${target.baseSha}^..HEAD\n` +
				`   - git diff ${target.baseSha}^..HEAD\n` +
				`   If \`${target.baseSha}^\` fails (root commit), do:\n` +
				`   - git log --oneline --decorate ${target.baseSha}..HEAD\n` +
				`   - git diff ${target.baseSha}..HEAD\n`
			);
	}
}

async function pickBaseCommit(pi: ExtensionAPI, ctx: any, limit: number): Promise<string | null> {
	const log = await pi.exec("git", ["log", "--oneline", "--decorate", "-n", String(limit)], {
		timeout: 10_000,
	});

	if (log.code !== 0) {
		ctx.ui.notify(`Failed to run git log: ${log.stderr || log.stdout}`.trim(), "error");
		return null;
	}

	const lines = log.stdout
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	if (lines.length === 0) {
		ctx.ui.notify("No commits found.", "warning");
		return null;
	}

	const items: SelectItem[] = lines.map((line) => {
		const [sha, ...rest] = line.split(/\s+/u);
		return {
			value: sha ?? line,
			label: line,
			description: rest.join(" ") || undefined,
		};
	});

	return ctx.ui.custom<string | null>(
		(tui: any, theme: any, _kb: any, done: (value: string | null) => void) => {
			const container = new Container();

			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Pick base commit")), 1, 0));
			container.addChild(
				new Text(theme.fg("dim", "(Review will include the selected commit → HEAD)"), 1, 0),
			);

			const selectList = new SelectList(items, Math.min(items.length, 15), {
				selectedPrefix: (t: string) => theme.fg("accent", t),
				selectedText: (t: string) => theme.fg("accent", t),
				description: (t: string) => theme.fg("muted", t),
				scrollInfo: (t: string) => theme.fg("dim", t),
				noMatch: (t: string) => theme.fg("warning", t),
			});
			selectList.onSelect = (item: any) => done(item.value);
			selectList.onCancel = () => done(null);
			container.addChild(selectList);

			container.addChild(
				new Text(theme.fg("dim", "↑↓ navigate • enter select • esc back • type to search"), 1, 0),
			);
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{ overlay: true },
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("review", {
		description:
			"Interactive review picker (working tree / staged / PR / recent commits), then produce a high-signal review report",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy; try again when idle", "warning");
				return;
			}

			// Ensure we're in a git repo.
			try {
				await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { timeout: 5_000 });
			} catch {
				ctx.ui.notify("/review: not inside a git repository", "error");
				return;
			}

			const parsed = parseArgs(args);
			let target: ReviewTarget | null = null;

			if (parsed) {
				if (parsed.kind === "recentPicker") {
					if (!ctx.hasUI) {
						pi.sendUserMessage(
							`Review the most recent ${parsed.limit} commits.\n\n` +
							`Use:\n` +
							`- git log --oneline --decorate -n ${parsed.limit}\n` +
							`- git diff HEAD~${parsed.limit}..HEAD\n\n` +
							buildPrompt({ kind: "worktree" }).split("\n\n").slice(1).join("\n\n"),
						);
						return;
					}

					const sha = await pickBaseCommit(pi, ctx, parsed.limit);
					if (!sha) return;
					target = { kind: "recent", baseSha: sha };
				} else {
					target = parsed;
				}
			}

			if (!target) {
				if (!ctx.hasUI) {
					// Non-interactive mode fallback.
					target = { kind: "worktree" };
				} else {
					while (!target) {
						const choice = await ctx.ui.select("What do you want to review?", [
							"Working tree (staged + unstaged + untracked)",
							"Staged changes only",
							"GitHub PR by number",
							"Recent commits (pick base commit)",
						]);

						if (!choice) return; // cancelled

						if (choice.startsWith("Working tree")) target = { kind: "worktree" };
						else if (choice.startsWith("Staged")) target = { kind: "staged" };
						else if (choice.startsWith("Recent")) {
							const sha = await pickBaseCommit(pi, ctx, 50);
							if (!sha) continue; // go back to first page
							target = { kind: "recent", baseSha: sha };
						} else {
							const input = await ctx.ui.input("PR number", "e.g. 123");
							if (!input) continue;
							const prNumber = Number(String(input).trim().replace(/^#/, ""));
							if (!Number.isFinite(prNumber) || prNumber <= 0) {
								ctx.ui.notify("Invalid PR number", "error");
								continue;
							}
							target = { kind: "pr", prNumber };
						}
					}
				}
			}

			pi.sendUserMessage(buildPrompt(target));
		},
	});
}
