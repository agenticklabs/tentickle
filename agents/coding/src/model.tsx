import { openai } from "@agentick/openai";
import { google } from "@agentick/google";
import { useComState, useComputed } from "@agentick/core";
import { Model } from "@agentick/core";
import { apple } from "@agentick/apple";

// Parse Google credentials if provided
const GOOGLE_CREDENTIALS = process.env["GCP_CREDENTIALS"]
  ? JSON.parse(Buffer.from(process.env["GCP_CREDENTIALS"], "base64").toString("utf8"))
  : undefined;

/**
 * Dynamic model component that switches between OpenAI, Google, and Apple Foundation Models.
 *
 * Set USE_APPLE_MODEL=true to use on-device Apple Foundation Models.
 * Bridge binary is auto-compiled by @agentick/apple's postinstall.
 */
export function DynamicModel() {
  const useGoogle = useComState<boolean>("useGoogle", process.env["USE_GOOGLE_MODEL"] === "true");
  const useApple = useComState<boolean>("useApple", process.env["USE_APPLE_MODEL"] === "true");
  const openaiModelName = useComState<string>(
    "openaiModel",
    process.env["OPENAI_MODEL"] || "gpt-4o-mini",
  );
  const googleModelName = useComState<string>(
    "googleModel",
    process.env["GOOGLE_MODEL"] || "gemini-2.5-flash",
  );

  const model = useComputed(() => {
    if (useApple()) {
      return apple();
    }
    if (useGoogle()) {
      return google({
        model: googleModelName(),
        apiKey: process.env["GOOGLE_API_KEY"],
        vertexai: !!process.env["GCP_PROJECT_ID"],
        project: process.env["GCP_PROJECT_ID"],
        location: process.env["GCP_LOCATION"] || "us-central1",
        googleAuthOptions: GOOGLE_CREDENTIALS ? { credentials: GOOGLE_CREDENTIALS } : undefined,
      });
    } else {
      return openai({
        model: openaiModelName(),
        apiKey: process.env["OPENAI_API_KEY"],
        baseURL: process.env["OPENAI_BASE_URL"],
      });
    }
  }, [useGoogle, useApple, googleModelName, openaiModelName]);

  return <Model model={model()} />;
}
