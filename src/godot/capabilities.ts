// Capability record validation (spec 2.1 steps 5-6; design section 0 Q2).
// All five fields REQUIRED: a missing field is INVALID_FORMAT (loud).
// Pin check (addon SHOULD equal 4.1.11, Godot SHOULD be >= 4.5) warns
// and sets the drift flag without aborting (proposal risk R1).

import { EnvelopeError } from "./mcpErrors.js";

export const PIN_ADDON_VERSION = "4.1.11";
export const MIN_GODOT_MAJOR = 4;
export const MIN_GODOT_MINOR = 5;

export interface CapabilityRecord {
  addon_version: string;
  godot_version: string;
  project_path: string;
  project_name: string;
  server_version_received: string;
}

export const CAPABILITY_FIELDS = [
  "addon_version",
  "godot_version",
  "project_path",
  "project_name",
  "server_version_received",
] as const;

export interface CapabilityLog {
  warn: (message: string) => void;
}

// Throws EnvelopeError(INVALID_FORMAT) naming the first missing field.
export function validateCapabilities(raw: unknown): CapabilityRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EnvelopeError("INVALID_FORMAT", "INVALID_FORMAT: capability record must be an object", {
      retryable: false,
    });
  }
  const record = raw as Record<string, unknown>;
  for (const field of CAPABILITY_FIELDS) {
    if (typeof record[field] !== "string") {
      throw new EnvelopeError(
        "INVALID_FORMAT",
        `INVALID_FORMAT: capability record is missing field "${field}"`,
        { retryable: false },
      );
    }
  }
  return {
    addon_version: record["addon_version"] as string,
    godot_version: record["godot_version"] as string,
    project_path: record["project_path"] as string,
    project_name: record["project_name"] as string,
    server_version_received: record["server_version_received"] as string,
  };
}

function godotBelowMinimum(version: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (match?.[1] === undefined || match?.[2] === undefined) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < MIN_GODOT_MAJOR || (major === MIN_GODOT_MAJOR && minor < MIN_GODOT_MINOR);
}

// Returns true when drift is suspected; always warns, never throws.
export function checkProtocolDrift(record: CapabilityRecord, log?: CapabilityLog): boolean {
  let drift = false;
  if (record.addon_version !== PIN_ADDON_VERSION) {
    drift = true;
    log?.warn(
      `godot-mcp-server: addon_version "${record.addon_version}" differs from pin ${PIN_ADDON_VERSION} (protocol_drift_suspected)`,
    );
  }
  if (godotBelowMinimum(record.godot_version)) {
    drift = true;
    log?.warn(
      `godot-mcp-server: godot_version "${record.godot_version}" is below minimum 4.5 (protocol_drift_suspected)`,
    );
  }
  return drift;
}

// Legacy vanilla peers answer only heartbeat: degraded record shape
// (spec 2.2 step 1). Echoes a server_version when the peer sent one.
export function degradedLegacyRecord(serverVersionEcho: unknown): CapabilityRecord {
  return {
    addon_version: "unknown-legacy",
    godot_version: "unknown",
    project_path: "unknown",
    project_name: "unknown",
    server_version_received: typeof serverVersionEcho === "string" ? serverVersionEcho : "absent",
  };
}
