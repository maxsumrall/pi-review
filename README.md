<p>
  <img src="assets/banner.png" alt="pi-review banner" width="1100">
</p>

# pi-review

A pi extension that adds interactive review commands for generating high-signal code review prompts.

## What it does

### `/review`

Interactive picker to choose what to review, then runs a multi-stage review suite:

- Working tree (staged + unstaged + untracked)
- Staged changes only
- GitHub PR by number
- Recent commits (pick a base commit)

It runs these stages and then synthesizes the results:

1) Overall review
2) Linus-style blunt review
3) Staff engineer (FAANG) risk-focused review
4) Final synthesis report (deduplicated + prioritized)

Stages are designed to be tweakable via prompt templates.

To interrupt/cancel mid-run, just type anything.

## Usage

In pi:

- `/review` → opens an interactive picker
- `/review staged` → staged-only
- `/review worktree` → working tree
- `/review 123` or `/review #123` → PR 123 (uses `gh`)
- `/review recent` or `/review recent 100` → pick base commit from last N commits

## Prompt templates (tweak the stages)

This package ships its stage prompts in `prompts/` (but they are not exposed as standalone `/...` commands).

The review suite loads prompts in this order:

1) `~/.pi/agent/prompts/<name>.md` (user override)
2) the package default in `prompts/<name>.md`

So to customize a stage, copy and edit one of these:

- `review-overall.md`
- `review-linus.md`
- `review-staff.md`
- `review-synthesize.md`

## Install

### From npm (recommended)

```bash
pi install npm:pi-review
```

Update to latest (if you installed without a version pin):

```bash
pi update
```

Pin a specific version:

```bash
pi install npm:pi-review@0.1.0
```

### From git

```bash
pi install https://github.com/maxsumrall/pi-review
```

Or project-local (shared via `.pi/settings.json`):

```bash
pi install -l https://github.com/maxsumrall/pi-review
```

### Local dev

From a checkout:

```bash
pi install .
# or for one-off testing
pi -e .
```

## Releasing new versions (maintainers)

This repo includes a GitHub Action that publishes to npm **only when you trigger it**.

1) Add an npm automation token as repo secret `NPM_TOKEN`
2) In GitHub: Actions → **Release (npm)** → Run workflow
   - choose `patch`, `minor`, `major`, or an explicit `x.y.z`

The workflow will:
- bump `package.json` version
- create a git tag
- push tag + commit
- `npm publish`

## Notes

- If you already have a local `review` extension in `~/.pi/agent/extensions/`, disable/remove one copy to avoid duplicate `/review` registration (`pi config`).
- This package declares `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` as peer dependencies (they come with pi).
