# Configuration

Tentickle uses a layered settings system. Each layer overrides the one above it.

## Layers

| Layer | Path | Committed? |
|-------|------|-----------|
| Global | `~/.tentickle/settings.json` | N/A |
| Project | `.tentickle/settings.json` | Yes |
| Project Local | `.tentickle/settings.local.json` | No (gitignore this) |

## Settings

```json
{
  "agent": "coding",
  "provider": "openai",
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1"
}
```

| Field | Description |
|-------|-------------|
| `agent` | Which agent to use (`coding`, `main`) |
| `provider` | Model provider: `openai`, `google`, `apple` |
| `model` | Model name within the provider |
| `baseUrl` | Provider endpoint override |

## Environment Variables

Environment variables are the primary configuration method. They override settings files.

```bash
# OpenAI (default)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# Google
GOOGLE_API_KEY=...
GOOGLE_MODEL=gemini-2.5-flash
USE_GOOGLE_MODEL=true

# Apple Foundation Models (macOS only, on-device)
USE_APPLE_MODEL=true

# OpenAI-compatible (Grok, Ollama, etc.)
OPENAI_BASE_URL=https://api.x.ai/v1
```

## Connectors

Connectors are opt-in via environment variables:

```bash
# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=123456789

# iMessage (macOS only)
IMESSAGE_HANDLE=+1234567890
```

Each connector creates its own session. The TUI, Telegram, and iMessage all talk to the same app instance.
