/**
 * Health-check parsing & live/recorded mode selection.
 *
 * The Worker's `/api/health` returns:
 *   { ok, hasAi, hasLoader, hasCfApiToken, defaultModel, time }
 *
 * The slide goes "live" only if both `ok` and `hasAi` are true. Anything
 * else (network failure, no binding, error response) falls back to the
 * pre-recorded run that's baked into the bundle.
 */

export interface HealthPayload {
  ok: boolean;
  hasAi: boolean;
  hasLoader: boolean;
  hasCfApiToken: boolean;
  defaultModel?: string;
  time?: string;
}

export type DemoMode = "live" | "recorded";

/** Returns true when the Worker is up and the AI binding is available. */
export function isHealthOk(payload: unknown): payload is HealthPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Partial<HealthPayload>;
  return p.ok === true && p.hasAi === true;
}

/** Decide whether to go live or play the recording. */
export function selectMode(payload: unknown): DemoMode {
  return isHealthOk(payload) ? "live" : "recorded";
}
