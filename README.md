# pi-review

A pi extension that adds an interactive `/review` command for generating a high-signal code review prompt.

## What it does

`/review` lets you pick what to review:

- Working tree (staged + unstaged + untracked)
- Staged changes only
- GitHub PR by number
- Recent commits (pick a base commit)

Then it injects a structured review prompt into the chat.

## Usage

In pi:

- `/review` → opens an interactive picker
- `/review staged` → staged-only
- `/review worktree` → working tree
- `/review 123` or `/review #123` → PR 123 (uses `gh`)
- `/review recent` or `/review recent 100` → pick base commit from last N commits

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
pi install https://github.com/<you>/pi-review
```

Or project-local (shared via `.pi/settings.json`):

```bash
pi install -l https://github.com/<you>/pi-review
```

### Local dev

From a checkout:

```bash
pi install .
# or for one-off testing
pi -e .
```

## Notes

- If you already have a local `review` extension in `~/.pi/agent/extensions/`, disable/remove one copy to avoid duplicate `/review` registration (`pi config`).
- This package declares `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` as peer dependencies (they come with pi).
