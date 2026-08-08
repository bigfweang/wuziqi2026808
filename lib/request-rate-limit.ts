type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  scope: string;
  userLimit: number;
  ipLimit: number;
  globalLimit: number;
  windowMs?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

declare global {
  var __pixelGomokuRateLimits: Map<string, RateLimitBucket> | undefined;
}

const DEFAULT_WINDOW_MS = 60_000;
const MAX_BUCKETS = 5_000;

const buckets = globalThis.__pixelGomokuRateLimits ?? new Map<string, RateLimitBucket>();
globalThis.__pixelGomokuRateLimits = buckets;

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (forwarded || realIp || "unknown").slice(0, 128);
}

function pruneExpired(now: number) {
  if (buckets.size < MAX_BUCKETS) return true;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  return buckets.size < MAX_BUCKETS;
}

export function consumeRequestLimit(
  request: Request,
  userId: string | undefined,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  if (!pruneExpired(now)) {
    return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  const policies = [
    { key: `${options.scope}:global`, limit: options.globalLimit },
    ...(userId ? [{ key: `${options.scope}:user:${userId}`, limit: options.userLimit }] : []),
    { key: `${options.scope}:ip:${clientAddress(request)}`, limit: options.ipLimit },
  ];

  let retryAfterSeconds = 0;
  for (const policy of policies) {
    const bucket = buckets.get(policy.key);
    if (bucket && bucket.resetAt > now && bucket.count >= policy.limit) {
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((bucket.resetAt - now) / 1000));
    }
  }
  if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };

  for (const policy of policies) {
    const bucket = buckets.get(policy.key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(policy.key, { count: 1, resetAt: now + windowMs });
    } else {
      bucket.count += 1;
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
