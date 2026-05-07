/*
 * PoC: genre co-occurrence sampler for MusicBrainz
 * - computeCooccurrence(genre, options)
 * - uses MusicBrainz WS2 search (query=tag:"genre") to sample entities
 * - tallies other tags/genres found on those entities and returns P(B|A)
 *
 * Notes:
 * - MusicBrainz enforces rate limits; this code uses a 1100ms delay between requests.
 * - Results are an empirical sample and depend on the chosen entity type (artist/release/recording).
 * - Caching is done in localStorage under a simple key to avoid repeated heavy crawling.
 */

const MB_BASE = "https://musicbrainz.org/ws/2";
const DEFAULT_RATE_MS = 1100; // be polite with MusicBrainz

function sleep(ms) {
	return new Promise((res) => setTimeout(res, ms));
}

async function fetchJsonWithTimeout(url, timeout = 15000) {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	try {
		const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(id);
	}
}

function normalizeTagName(tag) {
	return String(tag).trim().toLowerCase();
}

function storageKeyFor(genre, entityType, max) {
	return `mb_coocc_${entityType}_${genre}_${max}`.replace(/\s+/g, "_");
}

export async function computeCooccurrence(genreName, {
	entityType = "release", // "artist" | "release" | "recording"
	maxEntities = 300,
	perPage = 100, // MB allows up to 100 for many endpoints
	rateMs = DEFAULT_RATE_MS,
	useCache = true,
	forceRefresh = false,
} = {}) {
	if (!["artist", "release", "recording"].includes(entityType)) {
		throw new Error("entityType must be artist, release or recording");
	}

	const key = storageKeyFor(genreName, entityType, maxEntities);
	if (useCache && !forceRefresh) {
		try {
			const raw = localStorage.getItem(key);
			if (raw) return JSON.parse(raw);
		} catch {}
	}

	const normalized = normalizeTagName(genreName);
	let offset = 0;
	let collected = 0;
	const coCounts = new Map();
	let totalEntities = 0;
	let totalTagMentions = 0;

	while (collected < maxEntities) {
		const limit = Math.min(perPage, maxEntities - collected);
		const params = new URLSearchParams({
			query: `tag:"${normalized}"`,
			limit: String(limit),
			offset: String(offset),
			fmt: "json",
		});
		const url = `${MB_BASE}/${entityType}?${params.toString()}`;

		let json;
		try {
			json = await fetchJsonWithTimeout(url);
		} catch (e) {
			console.warn("fetch error", e);
			break;
		}

		const listKey = `${entityType}s`;
		const items = Array.isArray(json[listKey]) ? json[listKey] : [];
		if (!items.length) break;

		for (const item of items) {
			totalEntities++;
			// Collect candidate genres/tags from both 'genres' and 'tags' if present
			const candidates = new Set();
			if (Array.isArray(item.genres)) {
				for (const g of item.genres) if (g?.name) candidates.add(normalizeTagName(g.name));
			}
			if (Array.isArray(item.tags)) {
				for (const t of item.tags) if (t?.name) candidates.add(normalizeTagName(t.name));
			}

			// remove the original genre itself
			candidates.delete(normalized);

			for (const c of candidates) {
				coCounts.set(c, (coCounts.get(c) || 0) + 1);
				totalTagMentions += 1;
			}

			collected++;
			if (collected >= maxEntities) break;
		}

		// Pagination
		offset += items.length;
		if (items.length < limit) break; // no more
		await sleep(rateMs);
	}

	// Build result array
	const results = Array.from(coCounts.entries())
		.map(([name, count]) => ({
			name,
			count,
			entity_share: totalEntities > 0 ? count / totalEntities : 0,
			tag_share: totalTagMentions > 0 ? count / totalTagMentions : 0,
		}))
		.sort((a, b) => b.count - a.count || b.entity_share - a.entity_share || a.name.localeCompare(b.name));

	const out = {
		genre: normalized,
		entityType,
		totalSampled: totalEntities,
		totalTagMentions,
		results,
	};

	// Only cache if we actually got data; empty results could be a transient failure
	if (out.totalSampled > 0) {
		try {
			localStorage.setItem(key, JSON.stringify(out));
		} catch {}
	}

	return out;
}

/* Usage example (in browser console):
computeCooccurrence("rock", { entityType: "release", maxEntities: 300 }).then(console.log)

Notes:
- To compute P(A|B) (reverse) you need to sample entities for B separately and compute symmetric stats.
- For more robust measures use Jaccard, PMI, or weighted artist/release aggregations.
*/
