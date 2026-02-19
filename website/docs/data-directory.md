# Data Directory

Tentickle stores persistent state in `~/.tentickle/`. The directory is scaffolded automatically on first run.

## Structure

```
~/.tentickle/
├── IDENTITY.md                  # Agent's self-authored identity
├── settings.json                # Global settings
├── user/                        # Owner profile
│   └── *.md                     # Markdown files about the human
├── entities/                    # Entity profiles
│   ├── alice.md                 # One file per entity
│   └── project-alpha.md
├── rules/                       # Global rules
│   └── *.md                     # Behavioral constraints
├── skills/                      # Global skill definitions
│   └── */SKILL.md
└── projects/
    └── {workspace-slug}/
        ├── MEMORY.md            # Per-project persistent memory
        └── rules/               # Project-specific rules
            └── *.md
```

## Identity

`~/.tentickle/IDENTITY.md` is the agent's soul document. It writes and maintains this itself — who it is, who its human is, what it values. Loaded as `<Grounding>` at the top of context, priming everything downstream.

## User Profile

`~/.tentickle/user/` contains markdown files the agent writes about its human. Name, goals, communication preferences, current priorities. The agent updates these over time via `write_file`.

## Entity Profiles

`~/.tentickle/entities/` contains one markdown file per entity (person, org, project). The agent creates and maintains these as entities come up in conversation. A lightweight index is rendered to context — the agent reads the full profile with `read_file` when needed.

## Project Memory

`~/.tentickle/projects/{slug}/MEMORY.md` is per-project persistent memory. The agent reads it on startup and writes to it during work. Typical contents: build commands, project structure, verification procedures, patterns discovered.

The workspace slug is the full path with slashes replaced by hyphens.

## Rules

Rules are markdown files that inject behavioral constraints:

- **Global** (`~/.tentickle/rules/*.md`) — apply to all projects
- **Project** (`~/.tentickle/projects/{slug}/rules/*.md`) — project-specific

Project rules with the same filename override global rules. If total content is small (<3000 chars), rules are inlined into context. Otherwise, an index is shown.

## Settings

See [Configuration](./configuration) for the layered settings system.
