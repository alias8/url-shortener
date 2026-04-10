Great question — and the honest answer is: the naive implementation you described is trivial. Interviewers don't care about that part. They use it as a launching pad
to probe much harder problems.

Here's what they're actually testing:

  ---
Scale changes everything

At 100 requests/day your design works fine. At billions of redirects/day (like bit.ly), every assumption breaks:

- DB lookup on every redirect — your Postgres can't handle millions of reads/sec. Now you need a caching layer (Redis). How do you cache? What's the eviction policy?
  What happens on a cache miss?
- Single DB — becomes a bottleneck. Do you shard? How? By short code prefix? By hash range?
- Single server — needs to be a fleet behind a load balancer. Now your short code generator must be unique across many servers simultaneously — no more "just check if
  it exists."

  ---
The short code generation problem is actually hard at scale

If you have 10 servers all generating random codes and checking for collisions, you get race conditions. Two servers can generate the same code at the same time, both
check the DB, both see "not taken," both write — now you have a duplicate.

Solutions have real trade-offs:
- UUID — no collisions but ugly/long
- Counter in DB — bottleneck, single point of failure
- Pre-allocated ranges — each server gets a range (server 1 gets 1–1000, server 2 gets 1001–2000). How do you manage that?
- Zookeeper/distributed counter — operational complexity

  ---
Other rabbit holes interviewers go down

- 301 vs 302 redirect — 301 is permanent (browser caches it, you lose analytics). 302 is temporary (browser always asks your server, you can track clicks). Which do
  you use and why?
- Custom aliases — user wants short.ly/my-brand. Now you need uniqueness guarantees on user input.
- Expiration — URLs that expire after N days. How do you clean them up efficiently? Cron job? TTL in Redis?
- Analytics — count clicks, track geographic location, referrer. Now every redirect needs to write data too. How do you do that without slowing the redirect?
- Abuse prevention — someone shortens a malicious URL. Do you scan it? Block it?
- Hot URLs — one URL gets tweeted by a celebrity and gets 10M hits in an hour. Does your cache handle that?

  ---
The URL shortener is a Trojan horse. The toy version takes 20 minutes. The production version is a distributed systems course.
