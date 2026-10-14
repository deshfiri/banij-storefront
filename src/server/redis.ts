import "server-only";
import { createClient, type RedisClientType } from "redis";
import { env } from "./env";

/**
 * One connection per server process to the storefront's own Redis. Keys are namespaced `bsf:` and,
 * wherever data belongs to a website, carry that website's key (D30 §5).
 */
const globalForRedis = globalThis as unknown as { __bsfRedis?: Promise<RedisClientType> };

export function redis(): Promise<RedisClientType> {
  if (!globalForRedis.__bsfRedis) {
    const client: RedisClientType = createClient({ url: env.redisUrl });
    client.on("error", (error: unknown) => {
      console.error("[storefront] redis error", error instanceof Error ? error.message : error);
    });
    globalForRedis.__bsfRedis = client.connect().then(() => client);
    globalForRedis.__bsfRedis.catch(() => {
      globalForRedis.__bsfRedis = undefined;
    });
  }
  return globalForRedis.__bsfRedis;
}

export const keys = {
  host: (host: string) => `bsf:registry:host:${host}`,
  website: (websiteKey: string) => `bsf:registry:website:${websiteKey}`,
  site: (websiteKey: string) => `bsf:t:${websiteKey}:site`,
  cacheVersion: (websiteKey: string) => `bsf:t:${websiteKey}:cachev`,
  cache: (websiteKey: string, version: string, name: string) =>
    `bsf:t:${websiteKey}:c:${version}:${name}`,
  cart: (websiteKey: string, cartId: string) => `bsf:t:${websiteKey}:cart:${cartId}`,
  attempt: (websiteKey: string, cartId: string) => `bsf:t:${websiteKey}:attempt:${cartId}`,
  attemptLock: (websiteKey: string, cartId: string) => `bsf:t:${websiteKey}:attemptlock:${cartId}`,
  session: (websiteKey: string, sessionId: string) => `bsf:t:${websiteKey}:session:${sessionId}`,
  webhookSeen: (websiteKey: string, deliveryId: string) =>
    `bsf:t:${websiteKey}:webhook:${deliveryId}`,
};
