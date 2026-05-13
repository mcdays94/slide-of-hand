/**
 * Cloudflare REST API helpers — backing implementation for the demo's
 * "MCP tools".
 *
 * Both the traditional-MCP loop and the Code Mode loop call into these
 * functions; the only difference between the two demo modes is HOW the
 * LLM is asked to compose them (one tool at a time vs. one TS snippet).
 *
 * The token is held by the Worker and never given to the LLM. In the
 * Code Mode path it's passed via a binding-like proxy, not as a string.
 */

import type { Env } from "../types";

const CF_API = "https://api.cloudflare.com/client/v4";

interface CfList<T> {
  result: T[];
  result_info?: { count: number; total_count: number; page: number };
  success: boolean;
  errors?: { message: string }[];
}

interface CfSingle<T> {
  result: T;
  success: boolean;
  errors?: { message: string }[];
}

/**
 * Cloudflare zoneIds are 32-character lowercase hex strings (no dashes).
 * Models — especially smaller ones like Llama 3.1 8B — like to
 * hallucinate placeholder strings ("your_zone_id", "all", "<zone_id>",
 * "zone_id") or pass UUID-with-dashes form. Validating up-front lets
 * us return a clear, actionable error to the model loop instead of
 * silently falling through to a 404 that the swallow-as-empty WAF
 * branch would lie about as "no rules configured".
 */
const ZONE_ID_RE = /^[a-f0-9]{32}$/;

function assertZoneId(zoneId: string): void {
  if (!ZONE_ID_RE.test(zoneId)) {
    throw new Error(
      `Invalid zoneId ${JSON.stringify(zoneId)} — must be a 32-character lowercase hex id (call listZones() first to get real ids).`,
    );
  }
}

async function cfFetch<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!env.CF_API_TOKEN) {
    throw new Error(
      "CF_API_TOKEN is not set. Run: wrangler secret put CF_API_TOKEN",
    );
  }
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Cloudflare API ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 400)}`,
    );
  }
  return (await res.json()) as T;
}

export interface Zone {
  id: string;
  name: string;
  status: string;
  plan: { name: string };
  name_servers: string[];
  created_on: string;
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

export interface WafRule {
  id: string;
  description?: string;
  action: string;
  enabled: boolean;
  expression?: string;
}

/**
 * MCP "tools" — small, focused surface. Each one is a thin wrapper around
 * a single Cloudflare API endpoint. Schemas (for traditional MCP) and the
 * TypeScript types (for Code Mode) are derived from these signatures.
 */
export const MCP_TOOLS = {
  async listZones(env: Env): Promise<Zone[]> {
    const out: Zone[] = [];
    let page = 1;
    // If CF_ACCOUNT_ID is set, scope /zones to that account so the demo
    // only surfaces zones the presenter recognises (lusostreams in our
    // case). Without this filter, multi-account user tokens (common for
    // Cloudflare staff with tenant access) return zones from every
    // account they've ever been added to — confusing on stage.
    const accountFilter = env.CF_ACCOUNT_ID
      ? `&account.id=${env.CF_ACCOUNT_ID}`
      : "";
    while (true) {
      const r = await cfFetch<CfList<Zone>>(
        env,
        `/zones?per_page=50&page=${page}${accountFilter}`,
      );
      out.push(...r.result);
      if (r.result.length < 50) break;
      page += 1;
      if (page > 6) break; // hard cap so the demo stays snappy
    }
    return out;
  },

  async listDnsRecords(env: Env, zoneId: string): Promise<DnsRecord[]> {
    assertZoneId(zoneId);
    const out: DnsRecord[] = [];
    let page = 1;
    while (true) {
      const r = await cfFetch<CfList<DnsRecord>>(
        env,
        `/zones/${zoneId}/dns_records?per_page=100&page=${page}`,
      );
      out.push(...r.result);
      if (r.result.length < 100) break;
      page += 1;
      if (page > 6) break;
    }
    return out;
  },

  async listCustomWafRules(env: Env, zoneId: string): Promise<WafRule[]> {
    assertZoneId(zoneId);
    // The "http_request_firewall_custom" phase ruleset is where custom
    // WAF rules live. With a VALIDATED zoneId, a 404 here genuinely
    // means "this zone has no custom WAF phase" — a real empty list,
    // not a hallucinated zone. Safe to flatten to [] for the demo.
    try {
      const r = await cfFetch<
        CfSingle<{ rules?: WafRule[]; id: string; phase: string }>
      >(env, `/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`);
      return r.result.rules ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) return [];
      throw err;
    }
  },

  async getZone(env: Env, zoneId: string): Promise<Zone> {
    assertZoneId(zoneId);
    const r = await cfFetch<CfSingle<Zone>>(env, `/zones/${zoneId}`);
    return r.result;
  },
};

/**
 * JSON-Schema descriptions of the MCP tools, in the shape Workers AI
 * function-calling expects (compatible with @cloudflare/ai-utils). These
 * are what the traditional-MCP path injects into every LLM round-trip.
 *
 * Keep these descriptions short — the whole point of the comparison is
 * that the traditional path pays a per-token cost for them.
 */
export const MCP_TOOL_SCHEMAS = [
  {
    name: "listZones",
    description:
      "List all zones on this Cloudflare account. Returns id, name, status, plan, name_servers.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "listDnsRecords",
    description:
      "List DNS records for a single zone. Returns each record's id, type, name, content, ttl, proxied.",
    parameters: {
      type: "object",
      properties: {
        zoneId: { type: "string", description: "The zone id (UUID)." },
      },
      required: ["zoneId"],
    },
  },
  {
    name: "listCustomWafRules",
    description:
      "List the custom WAF rules for a single zone. Returns id, description, action, enabled.",
    parameters: {
      type: "object",
      properties: {
        zoneId: { type: "string", description: "The zone id (UUID)." },
      },
      required: ["zoneId"],
    },
  },
] as const;

/**
 * The TypeScript API surface that Code Mode exposes to the LLM.
 *
 * This is the literal string we paste into the system prompt for the
 * Code Mode column. The LLM writes a function body that calls these
 * methods on a `codemode` object, and we evaluate the body in a sandboxed
 * AsyncFunction with `codemode` bound to the actual MCP_TOOLS proxy.
 */
export const CODE_MODE_TS_API = `/**
 * Available API. Call methods on \`codemode\` to fetch data from the
 * Cloudflare account. \`codemode\` is the only object you have access to.
 * \`fetch()\` and the network are NOT available.
 *
 * Use \`console.log(...)\` to return a result to the user. The string
 * you pass to \`console.log\` is what they will read.
 */

interface Zone {
  id: string;
  name: string;
  status: string;
  plan: { name: string };
  name_servers: string[];
  created_on: string;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

interface WafRule {
  id: string;
  description?: string;
  action: string;
  enabled: boolean;
  expression?: string;
}

declare const codemode: {
  /** All zones on the account. */
  listZones(): Promise<Zone[]>;
  /** DNS records for one zone. */
  listDnsRecords(zoneId: string): Promise<DnsRecord[]>;
  /** Custom WAF rules for one zone. May be empty if none configured. */
  listCustomWafRules(zoneId: string): Promise<WafRule[]>;
  /** A single zone's full record. */
  getZone(zoneId: string): Promise<Zone>;
};
`;
