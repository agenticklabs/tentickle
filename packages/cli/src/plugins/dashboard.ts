/**
 * Dashboard Plugin
 *
 * Exposes gateway-wide overview methods and forwards lifecycle events
 * to transport clients subscribed to `$plugin:dashboard`.
 */

import type { GatewayPlugin, PluginContext, GatewayEvents } from "@agentick/gateway";

export function dashboardPlugin(): GatewayPlugin {
  let ctx: PluginContext;
  const cleanup: Array<() => void> = [];

  return {
    id: "dashboard",

    async initialize(pluginCtx) {
      ctx = pluginCtx;

      ctx.registerMethod("dashboard:overview", async () => {
        const [status, sessions] = await Promise.all([
          ctx.invoke("status", {}),
          ctx.invoke("sessions", {}),
        ]);
        return { ...(status as object), ...(sessions as object) };
      });

      ctx.registerMethod("dashboard:session", async (params: Record<string, unknown>) => {
        const sessionId = params.sessionId as string;
        const messageLimit = (params.messageLimit as number) ?? 50;
        const [status, history, tools] = await Promise.all([
          ctx.invoke("status", { sessionId }),
          ctx.invoke("history", { sessionId, limit: messageLimit }),
          ctx.invoke("tool-catalog", { sessionId }),
        ]);
        return { status, history, tools };
      });

      const forward = <K extends keyof GatewayEvents>(event: K, opts?: { as?: string }) => {
        const eventName = opts?.as ?? event;
        const handler = (data: GatewayEvents[K]) => ctx.broadcast(eventName, data);
        ctx.on(event, handler);
        cleanup.push(() => ctx.off(event, handler));
      };

      forward("session:created");
      forward("session:closed");
      forward("session:message");
      forward("client:connected");
      forward("client:disconnected");
    },

    async destroy() {
      for (const fn of cleanup) fn();
      cleanup.length = 0;
      ctx.unregisterMethod("dashboard:overview");
      ctx.unregisterMethod("dashboard:session");
    },
  };
}
