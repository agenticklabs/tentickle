import type { AgentickClient } from "@agentick/client";
import { createConnector, type ConnectorConfig } from "@agentick/connector";
import { IMessagePlatform } from "@agentick/connector-imessage";

export interface ConnectorHandle {
  stop(): Promise<void>;
}

/**
 * Start connectors based on environment variables.
 * Each connector is opt-in: only starts if its required env vars are set.
 *
 * Note: Telegram is now a GatewayPlugin, wired in packages/cli.
 * Only client-side connectors (iMessage) remain here.
 */
export async function startConnectors(
  client: AgentickClient,
  connectorConfig: {
    [connector: string]: Partial<ConnectorConfig>;
  } = {},
): Promise<ConnectorHandle[]> {
  const handles: ConnectorHandle[] = [];

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
