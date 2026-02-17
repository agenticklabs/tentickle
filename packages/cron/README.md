# @tentickle/cron

Scheduled jobs and heartbeat for tentickle agents. File-based trigger
system that decouples scheduling from process lifecycle.

## Architecture

```
CronService
  JobStore        .tentickle/jobs/*.json      (CRUD + file persistence)
  Scheduler       node-cron timers            (fires → writes trigger file)
  TriggerWatcher  fs.watch on triggers/       (reads trigger → sends to session)
```

When a timer fires, the scheduler writes a trigger file. The watcher picks
it up and sends an **event-role message** to the target session via
`client.session(target).send()`. The model sees it as a `SystemEvent`, not
a user turn.

External sources (system crontab, scripts) can also write trigger files
directly — no IPC needed.

## Usage

```typescript
import { CronService, createScheduleTool, bindCronStore } from "@tentickle/cron";

// In main.ts — after client creation
const cronService = new CronService({
  dataDir: ".tentickle",
  client,
  defaultTarget: "tui",
});
bindCronStore(cronService.store);
await cronService.start();

// Optional: ensure heartbeat job exists
cronService.ensureHeartbeat({ cron: "*/5 * * * *", target: "tui" });
```

```tsx
// In agent component — add ScheduleTool to tree
const cronStore = getCronStore();
const ScheduleTool = useMemo(
  () => cronStore ? createScheduleTool(cronStore) : null,
  [cronStore],
);

// JSX:
{ScheduleTool && <ScheduleTool />}
```

## ScheduleTool

Agent-facing tool for managing jobs:

| Action    | Required fields        | Description            |
|-----------|------------------------|------------------------|
| `add`     | name, cron, prompt     | Create a job           |
| `list`    | —                      | List all jobs          |
| `remove`  | id                     | Delete a job           |
| `enable`  | id                     | Enable a disabled job  |
| `disable` | id                     | Disable a job          |

The tool's `render` function puts active jobs in the model's context so it
can see what's already scheduled and avoid duplicates.

## Heartbeat

Heartbeat is a recurring job that reads a file (default:
`.tentickle/HEARTBEAT.md`) and sends its contents to the agent. If the
file is empty or missing, the trigger is skipped — no wasted model call.

```typescript
cronService.ensureHeartbeat({
  cron: "*/5 * * * *",
  target: "tui",
  heartbeatFile: ".tentickle/HEARTBEAT.md",
});
```

## Trigger format

```json
{
  "jobId": "remind-user",
  "jobName": "Remind User",
  "target": "telegram",
  "prompt": "Time to take a break",
  "firedAt": "2024-01-01T00:00:00.000Z",
  "oneshot": false
}
```

External trigger (no process needed):
```bash
echo '{"target":"telegram","prompt":"wake up","jobId":"manual","jobName":"manual","firedAt":"'$(date -u +%FT%TZ)'","oneshot":true}' \
  > .tentickle/triggers/$(date +%s)-manual.json
```

## Event messages

Triggers are delivered as `role: "event"` messages with metadata:

```json
{
  "role": "event",
  "content": [{ "type": "text", "text": "..." }],
  "metadata": {
    "source": { "type": "cron" },
    "event_type": "cron_trigger",
    "job_id": "remind-user",
    "job_name": "Remind User",
    "fired_at": "2024-01-01T00:00:00.000Z"
  }
}
```

## Crash recovery

- Jobs persist as JSON files in `<dataDir>/jobs/`.
- Pending triggers persist in `<dataDir>/triggers/`.
- On startup, `TriggerWatcher` drains all pending triggers before watching.
- If `send()` fails, the trigger file is preserved for retry on next start.
- Oneshot jobs are deleted only after successful delivery.

## Tests

```bash
pnpm test -- packages/cron
```

74 tests across 5 files covering: CRUD operations, file persistence, crash
recovery, malformed input, concurrent operations, fs.watch deduplication,
large backlogs, send failures, oneshot timing, heartbeat pre-filter, and
the full ScheduleTool handler.
