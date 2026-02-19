import type { AgentickClient } from "@agentick/client";
import { createConnector, type ConnectorConfig } from "@agentick/connector";
import { TelegramPlatform } from "@agentick/connector-telegram";
import { IMessagePlatform } from "@agentick/connector-imessage";

export interface ConnectorHandle {
  stop(): Promise<void>;
}

/**
 * Start connectors based on environment variables.
 * Each connector is opt-in: only starts if its required env vars are set.
 */
export async function startConnectors(
  client: AgentickClient,
  connectorConfig: {
    [connector: string]: Partial<ConnectorConfig>;
  } = {},
): Promise<ConnectorHandle[]> {
  const handles: ConnectorHandle[] = [];

  // Telegram
  const telegramToken = process.env["TELEGRAM_BOT_TOKEN"];
  if (telegramToken) {
    const allowedUsers = process.env["TELEGRAM_USER_ID"]
      ? [parseInt(process.env["TELEGRAM_USER_ID"], 10)]
      : undefined;

    const connector = createConnector(
      client,
      new TelegramPlatform({
        token: telegramToken,
        allowedUsers,
      }),
      {
        sessionId: "telegram",
        contentPolicy: "summarized",
        deliveryStrategy: "debounced",
        debounceMs: 2000,
        renderMode: "message",
        ...(connectorConfig["telegram"] || {}),
      },
    );

    await connector.start();
    handles.push(connector);
  }

  // iMessage (macOS only)
  const imessageHandle = process.env["IMESSAGE_HANDLE"];
  if (imessageHandle && process.platform === "darwin") {
    const connector = createConnector(
      client,
      new IMessagePlatform({
        handle: imessageHandle,
      }),
      {
        sessionId: "imessage",
        contentPolicy: "summarized",
        deliveryStrategy: "on-idle",
        renderMode: "message",
        ...(connectorConfig["imessage"] || {}),
      },
    );

    await connector.start();
    handles.push(connector);
  }

  return handles;
}
