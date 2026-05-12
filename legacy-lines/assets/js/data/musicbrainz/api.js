import {
	MUSICBRAINZ_API_BASE,
	MUSICBRAINZ_CACHE_TTL_MS,
	MUSICBRAINZ_FETCH_TIMEOUT_MS,
	MUSICBRAINZ_GENRE_CACHE_KEY,
} from "../../config/musicbrainz.js";

function readGenreCache() {
	try {
		const rawCache = localStorage.getItem(MUSICBRAINZ_GENRE_CACHE_KEY);
		if (!rawCache) {
			return null;
		}

		const parsedCache = JSON.parse(rawCache);
		if (!parsedCache || !Array.isArray(parsedCache.genreNames)) {
			return null;
		}

		if (typeof parsedCache.fetchedAt !== "number") {
			return null;
		}

		if (Date.now() - parsedCache.fetchedAt > MUSICBRAINZ_CACHE_TTL_MS) {
			return null;
		}

		return parsedCache.genreNames;
	} catch {
		return null;
	}
}

function writeGenreCache(genreNames) {
	try {
		localStorage.setItem(
			MUSICBRAINZ_GENRE_CACHE_KEY,
			JSON.stringify({
				fetchedAt: Date.now(),
				genreNames,
			})
		);
	} catch {
		// Cache ist nur ein Optimierungs-Pfad.
	}
}

async function fetchTextWithTimeout(url) {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(() => controller.abort(), MUSICBRAINZ_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				Accept: "text/plain",
			},
		});

		if (!response.ok) {
			throw new Error(`MusicBrainz request failed with status ${response.status}`);
		}

		return await response.text();
	} finally {
		window.clearTimeout(timeoutId);
	}
}

export async function loadMusicBrainzGenreNames({ forceRefresh = false, useCache = true } = {}) {
	if (useCache && !forceRefresh) {
		const cachedGenreNames = readGenreCache();
		if (cachedGenreNames && cachedGenreNames.length > 0) {
			return cachedGenreNames;
		}
	}

	const genreListUrl = `${MUSICBRAINZ_API_BASE}/genre/all?fmt=txt`;
	const rawList = await fetchTextWithTimeout(genreListUrl);
	const genreNames = rawList
		.split(/\r?\n/)
		.map((entry) => entry.trim())
		.filter(Boolean);

	if (genreNames.length > 0) {
		writeGenreCache(genreNames);
	}

	return genreNames;
}
