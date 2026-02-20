import { launchTUI } from "@tentickle/tui";
import { createCodingApp } from "./index.js";

await launchTUI({ createApp: createCodingApp });
