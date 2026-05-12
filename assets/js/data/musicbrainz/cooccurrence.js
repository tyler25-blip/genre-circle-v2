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
const STATIC_JSON_URL = new URL("../../../data/cooccurrence.json", import.meta.url).href;

let staticDataPromise = null;
function loadStaticCooccurrence() {
	if (!staticDataPromise) {
		staticDataPromise = fetch(STATIC_JSON_URL)
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
	}
	return staticDataPromise;
}

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

	// Static prefetched JSON: cheaper than live API and survives MB outages.
	// Only used when the requested settings match what the prefetch was run with.
	if (!forceRefresh) {
		const staticData = await loadStaticCooccurrence();
		if (
			staticData?.settings?.entityType === entityType &&
			staticData?.settings?.maxEntities === maxEntities
		) {
			const cached = staticData.data?.[normalized];
			if (cached) {
				if (useCache) {
					try { localStorage.setItem(key, JSON.stringify(cached)); } catch {}
				}
				return cached;
			}
		}
	}
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

/**
 * Compute co-occurrence by sampling entities that have BOTH genreNameA AND genreNameB
 * This is a heavier query but yields direct joint statistics for true bridge discovery.
 */
export async function computeJointCooccurrence(genreNameA, genreNameB, {
	entityType = "release",
	maxEntities = 300,
	perPage = 100,
	rateMs = DEFAULT_RATE_MS,
	useCache = true,
	forceRefresh = false,
} = {}) {
	const key = storageKeyFor(`${genreNameA}__${genreNameB}`, entityType, maxEntities);
	if (useCache && !forceRefresh) {
		try {
			const raw = localStorage.getItem(key);
			if (raw) return JSON.parse(raw);
		} catch {}
	}

	const normalizedA = normalizeTagName(genreNameA);
	const normalizedB = normalizeTagName(genreNameB);

	let offset = 0;
	let collected = 0;
	const coCounts = new Map();
	let totalEntities = 0;
	let totalTagMentions = 0;

	while (collected < maxEntities) {
		const limit = Math.min(perPage, maxEntities - collected);
		const params = new URLSearchParams({
			query: `tag:"${normalizedA}" AND tag:"${normalizedB}"`,
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
			const candidates = new Set();
			if (Array.isArray(item.genres)) {
				for (const g of item.genres) if (g?.name) candidates.add(normalizeTagName(g.name));
			}
			if (Array.isArray(item.tags)) {
				for (const t of item.tags) if (t?.name) candidates.add(normalizeTagName(t.name));
			}
			// remove the original two genres
			candidates.delete(normalizedA);
			candidates.delete(normalizedB);

			for (const c of candidates) {
				coCounts.set(c, (coCounts.get(c) || 0) + 1);
				totalTagMentions += 1;
			}

			collected++;
			if (collected >= maxEntities) break;
		}

		offset += items.length;
		if (items.length < limit) break;
		await sleep(rateMs);
	}

	const results = Array.from(coCounts.entries()).map(([name, count]) => ({
		name,
		count,
		entity_share: totalEntities > 0 ? count / totalEntities : 0,
		tag_share: totalTagMentions > 0 ? count / totalTagMentions : 0,
	})).sort((a,b) => b.count - a.count || b.entity_share - a.entity_share || a.name.localeCompare(b.name));

	const out = {
		genres: [normalizeTagName(genreNameA), normalizeTagName(genreNameB)],
		entityType,
		totalSampled: totalEntities,
		totalTagMentions,
		results,
	};

	if (out.totalSampled > 0) {
		try { localStorage.setItem(key, JSON.stringify(out)); } catch {}
	}

	return out;
}

/**
 * Compute the intersection of co-occurrences from two genres using Jaccard Similarity
 * Returns the top genres that appear in both genre A and genre B
 *
 * Jaccard(A,B) = |A ∩ B| / |A ∪ B|
 * This gives us a measure of how similar the co-occurrence patterns are
 */
export async function computeIntersectionCooccurrence(genreNameA, genreNameB, {
	entityType = "release",
	maxEntities = 300,
	// candidate pool size from each side (union of topK from A and B)
	topK = 20,
	// how many intersection genres to return
	topN = 5,
	// minimal absolute cooccurrence count required on both sides
	min_support = 1,
	useCache = true,
} = {}) {
	if (!["artist", "release", "recording"].includes(entityType)) {
		throw new Error("entityType must be artist, release or recording");
	}

	const normalizedA = normalizeTagName(genreNameA);
	const normalizedB = normalizeTagName(genreNameB);

	// Get co-occurrence data for both genres
	const [dataA, dataB] = await Promise.all([
		computeCooccurrence(normalizedA, { entityType, maxEntities, useCache }),
		computeCooccurrence(normalizedB, { entityType, maxEntities, useCache }),
	]);

	if (!dataA?.results?.length || !dataB?.results?.length) {
		return {
			genreA: normalizedA,
			genreB: normalizedB,
			intersection: [],
			jaccard_similarities: [],
		};
	}

	// Build maps for quick lookup
	const mapA = new Map(); // name -> item
	const mapB = new Map();
	dataA.results.forEach((it) => mapA.set(it.name, it));
	dataB.results.forEach((it) => mapB.set(it.name, it));

	// Candidate pool: union of topK from both results (by count)
	const candidates = new Map();
	const takeTop = (arr, k) => (Array.isArray(arr) ? arr.slice(0, k) : []);
	for (const it of takeTop(dataA.results, topK)) candidates.set(it.name, true);
	for (const it of takeTop(dataB.results, topK)) candidates.set(it.name, true);

	const scored = [];
	for (const name of candidates.keys()) {
		const a = mapA.get(name) || { count: 0, entity_share: 0, tag_share: 0 };
		const b = mapB.get(name) || { count: 0, entity_share: 0, tag_share: 0 };

		const countA = a.count || 0;
		const countB = b.count || 0;

		// enforce minimal absolute cooccurrence on both sides
		if (Math.min(countA, countB) < min_support) continue;

		// Use Laplace smoothing so items absent on one side still get a small non-zero score
		const lap = 1; // smoothing count
		const totalA = dataA.totalSampled || 0;
		const totalB = dataB.totalSampled || 0;
		const sA = a.entity_share || (totalA > 0 ? (countA + lap) / (totalA + lap * 2) : (countA + lap) / (1 + lap * 2));
		const sB = b.entity_share || (totalB > 0 ? (countB + lap) / (totalB + lap * 2) : (countB + lap) / (1 + lap * 2));

		// Weighted Jaccard style per-candidate score: combine ratio and absolute overlap
		const ratio = Math.max(sA, sB) > 0 ? Math.min(sA, sB) / Math.max(sA, sB) : 0; // balance
		const overlap = Math.min(sA, sB); // absolute joint prevalence (smoothed)

		// final score: overlap * ratio (favors balanced AND non-trivial overlap)
		const score = overlap * ratio;

		scored.push({
			name,
			count_a: countA,
			count_b: countB,
			entity_share_a: sA,
			entity_share_b: sB,
			score,
		});
	}

	// sort by score desc, then by combined counts
	scored.sort((x, y) => (y.score - x.score) || (y.count_a + y.count_b) - (x.count_a + x.count_b));

	// If we already have enough scored items, return topN
	if (scored.length >= topN) {
		return {
			genreA: normalizedA,
			genreB: normalizedB,
			intersection: scored.slice(0, topN),
			scoring: scored.map((it) => ({ name: it.name, score: it.score })),
		};
	}

	// Otherwise, attempt to fill remaining slots with joint sampling results
	try {
		const joint = await computeJointCooccurrence(normalizedA, normalizedB, { entityType, maxEntities, perPage: 100, rateMs: DEFAULT_RATE_MS, useCache });
		const jointResults = Array.isArray(joint.results) ? joint.results : [];

		// merge unique names from scored and jointResults, prefer scored order, then joint order
		const seen = new Set(scored.map((s) => s.name));
		const merged = [...scored];
		for (const it of jointResults) {
			if (merged.length >= topN) break;
			if (!seen.has(it.name)) {
				merged.push({ name: it.name, count_avg: it.count, entity_share_avg: it.entity_share, tag_share_avg: it.tag_share, score: 0.0 });
				seen.add(it.name);
			}
		}

		return {
			genreA: normalizedA,
			genreB: normalizedB,
			intersection: merged.slice(0, topN),
			scoring: merged.map((it) => ({ name: it.name, score: it.score || 0 })),
			jointFallback: jointResults.length > 0,
		};
	} catch (e) {
		return {
			genreA: normalizedA,
			genreB: normalizedB,
			intersection: scored.slice(0, topN),
			scoring: scored.map((it) => ({ name: it.name, score: it.score })),
			jointFallback: false,
			error: String(e?.message || e),
		};
	}
}


/* Usage example (in browser console):
computeCooccurrence("rock", { entityType: "release", maxEntities: 300 }).then(console.log)
computeIntersectionCooccurrence("rock", "blues", { entityType: "release", maxEntities: 300 }).then(console.log)

Notes:
- To compute P(A|B) (reverse) you need to sample entities for B separately and compute symmetric stats.
- For more robust measures use Jaccard, PMI, or weighted artist/release aggregations.
*/
