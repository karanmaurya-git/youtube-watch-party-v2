/** Sliding-window limiter: allows `limit` hits per `windowMs`. One instance per user/action. */
export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = [];
  }

  allow(now = Date.now()) {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
