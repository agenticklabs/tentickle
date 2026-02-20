import { launchTUI } from "@tentickle/tui";
import { createMainApp } from "./index.js";

await launchTUI({ createApp: createMainApp });
