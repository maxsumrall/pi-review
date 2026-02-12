import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type ReviewTarget =
	| { kind: "worktree" }
	| { kind: "staged" }
	| { kind: "pr"; prNumber: number }
	| { kind: "recent"; baseSha: string };

type ParsedTarget = ReviewTarget | { kind: "recentPicker"; limit: number };

type ReviewSuiteStage =
	| { kind: "review"; id: string; promptName: string; label: string }
	| { kind: "synthesize"; id: string; promptName: string; label: string };

const STAGE_DONE_MARKER = "[[PI_REVIEW_STAGE_DONE]]";

const DEFAULT_SUITE_STAGES: ReviewSuiteStage[] = [
	{ kind: "review", id: "overall", promptName: "review-overall", label: "Overall" },
	{ kind: "review", id: "linus", promptName: "review-linus", label: "Linus" },
	{ kind: "review", id: "staff", promptName: "review-staff", label: "Staff" },
	{ kind: "synthesize", id: "synthesize", promptName: "review-synthesize", label: "Synthesis" },
];

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

function stripFrontmatter(content: string): string {
	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?([\s\S]*)$/);
	return match ? match[1].trim() : content.trim();
}

function renderVars(template: string, vars: Record<string, string>): string {
	let out = template;
	for (const [k, v] of Object.entries(vars)) {
		out = out.replaceAll(`{{${k}}}`, v);
	}
	return out;
}

function loadPromptText(promptName: string): string {
	// Allow user override in ~/.pi/agent/prompts/<name>.md for easy tweaking
	const userPath = join(homedir(), ".pi", "agent", "prompts", `${promptName}.md`);
	if (existsSync(userPath)) {
		return stripFrontmatter(readFileSync(userPath, "utf-8"));
	}

	// Fallback: load from this package's prompts/ directory
	const pkgPath = join(__dirname, "prompts", `${promptName}.md`);
	if (existsSync(pkgPath)) {
		return stripFrontmatter(readFileSync(pkgPath, "utf-8"));
	}

	return "";
}

function buildScopePrompt(target: ReviewTarget): string {
	const common =
		`You are doing a high-signal code review.\n\n` +
		`Review priorities (in order):\n` +
		`1) Correctness / logic errors\n` +
		`2) Security / auth / secrets\n` +
		`3) Error handling & observability (logs/metrics)\n` +
		`4) Data correctness (schemas/migrations/serialization)\n` +
		`5) Performance / concurrency / idempotency\n` +
		`6) Tests (missing/weak tests)\n\n`;

	switch (target.kind) {
		case "worktree":
			return (
				common +
				`Review my local working tree changes (staged + unstaged + untracked).\n\n` +
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
				common +
				`Review my staged changes only.\n\n` +
				`Process:\n` +
				`1) Establish scope:\n` +
				`   - git status --porcelain=v1\n` +
				`   - git diff --cached --name-only\n` +
				`2) Inspect each staged file:\n` +
				`   - git diff --cached --patch -- <path>\n`
			);
		case "pr":
			return (
				common +
				`Review GitHub PR #${target.prNumber} in this repo.\n\n` +
				`Process (use gh CLI):\n` +
				`1) gh pr view ${target.prNumber} --json title,body,author,baseRefName,headRefName\n` +
				`2) gh pr diff ${target.prNumber}\n` +
				`If gh is unavailable or errors, say exactly what to run / paste instead.\n`
			);
		case "recent":
			return (
				common +
				`Review the commits from base commit ${target.baseSha} (inclusive) to HEAD.\n\n` +
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

function buildSinglePrompt(target: ReviewTarget): string {
	// Kept for backwards compatibility / reference. The extension always runs the suite.
	const common =
		`Hard rules for this run:\n` +
		`- Do NOT implement changes. Do NOT edit files. Review only.\n` +
		`- If you spot an issue, propose a fix in prose or small patch snippets, but don't apply it.\n\n` +
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

	return `${buildScopePrompt(target)}\n\n${common}`;
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

async function ensureGitRepo(pi: ExtensionAPI, ctx: any, commandName: string): Promise<boolean> {
	const res = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { timeout: 5_000 });
	if (res.code !== 0) {
		ctx.ui.notify(`/${commandName}: not inside a git repository`, "error");
		return false;
	}
	return true;
}

async function resolveTarget(pi: ExtensionAPI, ctx: any, args: string): Promise<ReviewTarget | null> {
	const parsed = parseArgs(args);
	let target: ReviewTarget | null = null;

	if (parsed) {
		if (parsed.kind === "recentPicker") {
			if (!ctx.hasUI) {
				// Non-interactive mode fallback.
				return { kind: "worktree" };
			}

			const sha = await pickBaseCommit(pi, ctx, parsed.limit);
			if (!sha) return null;
			target = { kind: "recent", baseSha: sha };
		} else {
			target = parsed;
		}
	}

	if (target) return target;

	if (!ctx.hasUI) return { kind: "worktree" };

	while (!target) {
		const choice = await ctx.ui.select("What do you want to review?", [
			"Working tree (staged + unstaged + untracked)",
			"Staged changes only",
			"GitHub PR by number",
			"Recent commits (pick base commit)",
		]);

		if (!choice) return null; // cancelled

		if (choice.startsWith("Working tree")) target = { kind: "worktree" };
		else if (choice.startsWith("Staged")) target = { kind: "staged" };
		else if (choice.startsWith("Recent")) {
			const sha = await pickBaseCommit(pi, ctx, 50);
			if (!sha) continue;
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

	return target;
}

function getLastAssistantText(messages: any[]): string {
	const assistantMessages = messages.filter((m) => m.role === "assistant");
	const last = assistantMessages[assistantMessages.length - 1];
	if (!last) return "";
	const parts = Array.isArray(last.content) ? last.content : [];
	const text = parts
		.filter((p: any) => p?.type === "text" && typeof p.text === "string")
		.map((p: any) => p.text)
		.join("\n")
		.trim();
	return text;
}

export default function (pi: ExtensionAPI) {
	// --- Review suite state (multi-stage) ---
	let suiteActive = false;
	let suiteTarget: ReviewTarget | null = null;
	let suiteStageIndex = 0;
	let suiteReports: Array<{ stageId: string; stageLabel: string; text: string }> = [];
	let suiteFreshContext = true;
	let suiteBoundaryCount = -1;
	let boundaryNeedsCapture = false;

	function currentStage(): ReviewSuiteStage | null {
		return DEFAULT_SUITE_STAGES[suiteStageIndex] ?? null;
	}

	function updateSuiteStatus(ctx: ExtensionContext) {
		if (!suiteActive) {
			ctx.ui.setStatus("pi-review", undefined);
			return;
		}

		const stage = currentStage();
		const label = stage ? stage.label : "?";
		const progress = `${suiteStageIndex + 1}/${DEFAULT_SUITE_STAGES.length}`;
		const fresh = suiteFreshContext ? " | fresh" : "";
		ctx.ui.setStatus("pi-review", `Review suite: ${label} (${progress})${fresh}`);
	}

	function endSuite(ctx: ExtensionContext, reason: string) {
		suiteActive = false;
		suiteTarget = null;
		suiteStageIndex = 0;
		suiteReports = [];
		suiteBoundaryCount = -1;
		boundaryNeedsCapture = false;
		updateSuiteStatus(ctx);
		ctx.ui.notify(`Review suite ended: ${reason}`, "info");
	}

	function buildStagePrompt(target: ReviewTarget, stage: ReviewSuiteStage): string {
		if (stage.kind === "synthesize") {
			const reportsText = suiteReports
				.map(
					(r) =>
						`## ${r.stageLabel}\n\n` +
						"```\n" +
						r.text.trim() +
						"\n```\n",
				)
				.join("\n");

			const tmpl = loadPromptText(stage.promptName);
			return renderVars(tmpl, { REPORTS: reportsText });
		}

		const scope = buildScopePrompt(target).trim();
		const tmpl = loadPromptText(stage.promptName);
		return renderVars(tmpl, { SCOPE: scope });
	}

	function sendCurrentStagePrompt(ctx: ExtensionContext) {
		if (!suiteTarget) {
			endSuite(ctx, "internal error: missing target");
			return;
		}

		const stage = currentStage();
		if (!stage) {
			endSuite(ctx, "done");
			return;
		}

		const prompt = buildStagePrompt(suiteTarget, stage);
		if (!prompt.trim()) {
			endSuite(ctx, `missing prompt template: ${stage.promptName}`);
			return;
		}

		updateSuiteStatus(ctx);
		pi.sendUserMessage(prompt);
	}

	// Strip prior stage outputs from context for stages 2..N (except synthesis)
	pi.on("context", async (event) => {
		if (!suiteActive || !suiteFreshContext) return;

		const stage = currentStage();
		if (!stage || stage.kind !== "review") return;
		if (suiteStageIndex === 0) return;

		const messages = event.messages;
		if (!Array.isArray(messages) || messages.length === 0) return;

		if (boundaryNeedsCapture) {
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].role === "user") {
					suiteBoundaryCount = i;
					break;
				}
			}
			boundaryNeedsCapture = false;
		}

		if (suiteBoundaryCount < 0) return;

		let lastUserIdx = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx < 0) return;
		if (suiteBoundaryCount >= lastUserIdx) return;

		const preSuite = messages.slice(0, suiteBoundaryCount);
		const currentIterationMsgs = messages.slice(lastUserIdx);

		const assembled: typeof messages = [...preSuite];
		assembled.push({
			role: "user",
			content: [
				{
					type: "text",
					text:
						`[Review suite stage ${stage.label}. Prior stage outputs are intentionally hidden. Review with fresh eyes.]`,
				},
			],
			timestamp: Date.now(),
		} as any);
		assembled.push(...currentIterationMsgs);

		return { messages: assembled };
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!suiteActive) return;

		const stage = currentStage();
		if (!stage) {
			endSuite(ctx, "done");
			return;
		}

		const text = getLastAssistantText(event.messages || []);
		if (!text) {
			endSuite(ctx, "aborted (no assistant output) ");
			return;
		}

		if (stage.kind === "review") {
			const cleaned = text.replaceAll(STAGE_DONE_MARKER, "").trim();
			suiteReports.push({ stageId: stage.id, stageLabel: stage.label, text: cleaned });
		}

		// Advance
		suiteStageIndex += 1;

		if (suiteStageIndex >= DEFAULT_SUITE_STAGES.length) {
			endSuite(ctx, "complete");
			return;
		}

		sendCurrentStagePrompt(ctx);
	});

	pi.on("input", async (event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" as const };

		// Let users interrupt the suite by typing anything.
		if (suiteActive && event.source === "interactive") {
			endSuite(ctx, "user interrupted");
			return { action: "continue" as const };
		}

		return { action: "continue" as const };
	});

	// --- Commands ---
	pi.registerCommand("review", {
		description:
			"Interactive review picker (working tree / staged / PR / recent commits), then run a multi-stage review (overall → linus → staff → synthesis).",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy; try again when idle", "warning");
				return;
			}

			if (!(await ensureGitRepo(pi, ctx, "review"))) return;

			// Backwards compatible: allow old "/review suite ..." usage, but ignore the word.
			const cleanedArgs = String(args || "")
				.trim()
				.replace(/^(suite|multi)\b\s*/i, "");

			const target = await resolveTarget(pi, ctx, cleanedArgs);
			if (!target) return;

			if (suiteActive) {
				ctx.ui.notify("A review suite is already running. Type anything to interrupt it.", "warning");
				return;
			}

			suiteActive = true;
			suiteTarget = target;
			suiteStageIndex = 0;
			suiteReports = [];
			suiteFreshContext = true;
			suiteBoundaryCount = -1;
			boundaryNeedsCapture = true;

			ctx.ui.notify("Review started", "info");
			sendCurrentStagePrompt(ctx);
		},
	});
}
