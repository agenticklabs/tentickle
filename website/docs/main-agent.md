# Main Agent

The main agent (`@tentickle/main`) is a personal orchestration agent. It maintains knowledge about its human, tracks entity profiles, delegates specialist work, and navigates filesystem-based memory.

## Architecture

```tsx
function MainAgent({ workspace }) {
  return (
    <TentickleAgent workspace={workspace}>
      <MainBehavior />
      <SpawnTool />
      <ExploreTool />
    </TentickleAgent>
  );
}
```

Same shared base as the coding agent. The main agent adds:

- An orchestration-focused system prompt
- Entity awareness behaviors
- Human profile maintenance
- Data location context

## Core Behaviors

### Learn About Your Human

When the human mentions people, projects, preferences, or goals, the agent notices and updates their profile in `~/.tentickle/user/`. It's transparent about this — it tells the human when it's noting something.

### Maintain Entity Profiles

When someone or something comes up in conversation, the agent checks for an existing profile in `~/.tentickle/entities/`. If there isn't one, it creates one. Entity files are markdown — whatever context would help the agent engage intelligently in the future.

### Delegate Specialist Work

For coding tasks, the agent spawns a sub-agent with clear objectives. For research, it uses explore. The main agent doesn't do everything itself — it makes sure things get done well.

### Navigate, Don't Preload

The agent's memory and context lives on the filesystem. It uses `read_file`, `glob`, `grep`, and `shell` to find what it needs. It doesn't ask the human for information it can look up itself.

## Data Locations

| Path | Purpose |
|------|---------|
| `~/.tentickle/user/` | Human's profile — maintained by the agent |
| `~/.tentickle/entities/` | Entity profiles — one markdown file per entity |
| `~/.tentickle/projects/{slug}/MEMORY.md` | Per-project persistent memory |
| `{workspace}` | Current working directory |
