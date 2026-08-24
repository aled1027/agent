/**
 * Bounded-concurrency map helper.
 *
 * Copied from pi-subagents/src/runs/shared/parallel-utils.ts:85-105. We
 * deliberately do not depend on the pi-subagents package directly because
 * (a) it is a peer/optional dependency for many users, and (b) the helper
 * is small enough to vendor.
 *
 * Concurrency cap is a hard ceiling, regardless of how many workers the
 * caller asks for. We do this so a misconfigured user cannot accidentally
 * spawn dozens of `pi` processes and pin the CPU.
 */

/** Hard upper bound on parallel workers. */
export const MAX_PARALLEL_CONCURRENCY = 4;

/**
 * Apply `fn` to each item in `items` with at most `limit` items in flight
 * at any time. Result order matches input order. Errors from `fn` propagate
 * via the returned promise (we do not swallow them — the caller decides
 * how to recover).
 */
export async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const safeLimit = Math.max(1, Math.min(MAX_PARALLEL_CONCURRENCY, Math.floor(limit) || 1));
	const results: R[] = new Array(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i] as T, i);
		}
	}

	const workers = Array.from({ length: Math.min(safeLimit, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}
