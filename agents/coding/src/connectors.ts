import type { AgentickClient } from "@agentick/client";
import { createConnector, type ConnectorConfig } from "@agentick/connector";
import { Logger } from "@agentick/core";
import { TelegramPlatform } from "@agentick/connector-telegram";
import { IMessagePlatform } from "@agentick/connector-imessage";

const logger = Logger.for("TentickleConnectors");

interface ConnectorHandle {
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
  logger.info(`[connector] Starting connectors`);

  // Telegram
  const telegramToken = process.env["TELEGRAM_BOT_TOKEN"];
  if (telegramToken) {
    logger.info(`[connector] Telegram bot starting for ${telegramToken}`);

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
    logger.info("[connector] Telegram bot started");
  }

  // iMessage (macOS only)
  const imessageHandle = process.env["IMESSAGE_HANDLE"];
  if (imessageHandle && process.platform === "darwin") {
    logger.info(`[connector] iMessage bridge starting for ${imessageHandle}`);

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
    logger.info(`[connector] iMessage bridge started for ${imessageHandle}`);
  }

  return handles;
}
