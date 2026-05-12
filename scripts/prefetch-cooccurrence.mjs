#!/usr/bin/env node
// Fetches MusicBrainz cooccurrence data for the 12 super-genres
// plus their top sub-genres, then writes a single JSON file to
// assets/data/cooccurrence.json which the app reads at startup.
//
// Usage:  node scripts/prefetch-cooccurrence.mjs
// Re-run if you change app default settings or want fresher data.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MB_BASE = "https://musicbrainz.org/ws/2";
const RATE_MS = 1100; // MB rate limit: 1 req/sec
const USER_AGENT = "GenreCirclePrefetch/1.0 (https://github.com/tyler25-blip/genre-circle-v2)";

const SUPER_GENRES = [
	"blues", "jazz", "rock", "metal", "electronic", "hip-hop",
	"reggae", "pop", "country", "classical", "latin", "world"
];

const ENTITY_TYPE = "release";
const MAX_ENTITIES = 100;
const SUB_GENRE_TOP_N = 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (name) => String(name).trim().toLowerCase();

async function fetchJson(url) {
	const res = await fetch(url, {
		headers: { Accept: "application/json", "User-Agent": USER_AGENT },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return await res.json();
}

async function computeCooccurrence(genreName) {
	const normalized = normalize(genreName);
	const coCounts = new Map();
	let totalEntities = 0;
	let totalTagMentions = 0;
	let offset = 0;
	let collected = 0;

	while (collected < MAX_ENTITIES) {
		const limit = Math.min(100, MAX_ENTITIES - collected);
		const params = new URLSearchParams({
			query: `tag:"${normalized}"`,
			limit: String(limit),
			offset: String(offset),
			fmt: "json",
		});
		const url = `${MB_BASE}/${ENTITY_TYPE}?${params.toString()}`;

		let json;
		try {
			json = await fetchJson(url);
		} catch (e) {
			console.warn(`    fetch error: ${e.message}`);
			break;
		}

		const items = Array.isArray(json[`${ENTITY_TYPE}s`]) ? json[`${ENTITY_TYPE}s`] : [];
		if (!items.length) break;

		for (const item of items) {
			totalEntities++;
			const candidates = new Set();
			if (Array.isArray(item.genres)) {
				for (const g of item.genres) if (g?.name) candidates.add(normalize(g.name));
			}
			if (Array.isArray(item.tags)) {
				for (const t of item.tags) if (t?.name) candidates.add(normalize(t.name));
			}
			candidates.delete(normalized);

			for (const c of candidates) {
				coCounts.set(c, (coCounts.get(c) || 0) + 1);
				totalTagMentions++;
			}

			collected++;
			if (collected >= MAX_ENTITIES) break;
		}

		offset += items.length;
		if (items.length < limit) break;
		await sleep(RATE_MS);
	}

	const results = Array.from(coCounts.entries())
		.map(([name, count]) => ({
			name,
			count,
			entity_share: totalEntities > 0 ? count / totalEntities : 0,
			tag_share: totalTagMentions > 0 ? count / totalTagMentions : 0,
		}))
		.sort((a, b) =>
			b.count - a.count ||
			b.entity_share - a.entity_share ||
			a.name.localeCompare(b.name)
		);

	return {
		genre: normalized,
		entityType: ENTITY_TYPE,
		totalSampled: totalEntities,
		totalTagMentions,
		results,
	};
}

async function main() {
	const allData = {};
	const subGenresToFetch = new Set();

	console.log(`Pass 1: ${SUPER_GENRES.length} super-genres`);
	for (let i = 0; i < SUPER_GENRES.length; i++) {
		const name = SUPER_GENRES[i];
		process.stdout.write(`  [${i + 1}/${SUPER_GENRES.length}] ${name}...`);
		try {
			const out = await computeCooccurrence(name);
			if (out.totalSampled > 0) {
				allData[name] = out;
				out.results.slice(0, SUB_GENRE_TOP_N).forEach((r) => {
					if (!SUPER_GENRES.includes(r.name)) subGenresToFetch.add(r.name);
				});
				console.log(` ok (${out.totalSampled} sampled, ${out.results.length} co-tags)`);
			} else {
				console.log(` no data`);
			}
		} catch (e) {
			console.log(` failed: ${e.message}`);
		}
		await sleep(RATE_MS);
	}

	const subList = Array.from(subGenresToFetch);
	console.log(`\nPass 2: ${subList.length} unique sub-genres`);
	for (let i = 0; i < subList.length; i++) {
		const name = subList[i];
		process.stdout.write(`  [${i + 1}/${subList.length}] ${name}...`);
		try {
			const out = await computeCooccurrence(name);
			if (out.totalSampled > 0) {
				allData[name] = out;
				console.log(` ok`);
			} else {
				console.log(` no data`);
			}
		} catch (e) {
			console.log(` failed: ${e.message}`);
		}
		await sleep(RATE_MS);
	}

	const output = {
		generated_at: new Date().toISOString(),
		settings: { entityType: ENTITY_TYPE, maxEntities: MAX_ENTITIES },
		data: allData,
	};

	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const outPath = path.resolve(__dirname, "../assets/data/cooccurrence.json");
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify(output, null, 2));
	console.log(`\nWrote ${Object.keys(allData).length} genres to ${path.relative(process.cwd(), outPath)}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
