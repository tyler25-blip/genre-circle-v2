const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const FADE_DURATION_MS = 700;
const VOLUME = 0.7;

const trackCache = new Map();
let audioA = null;
let audioB = null;
let activeAudio = null;
let inactiveAudio = null;
let enabled = false;
let currentGenre = null;
let pendingGenre = null;
let currentTrackList = null;
let currentTrackIndex = 0;
let pendingToken = 0;

export function setupAudioPlayer() {
	if (audioA) return;
	audioA = new Audio();
	audioB = new Audio();
	audioA.preload = "none";
	audioB.preload = "none";
	audioA.volume = 0;
	audioB.volume = 0;
	activeAudio = audioA;
	inactiveAudio = audioB;

	[audioA, audioB].forEach((a) => {
		a.addEventListener("ended", () => {
			if (a === activeAudio && enabled) {
				playNextInList();
			}
		});
	});
}

export function setEnabled(value) {
	const next = Boolean(value);
	if (next === enabled) return;
	enabled = next;
	if (!enabled) {
		fadeAudioOut(activeAudio);
		fadeAudioOut(inactiveAudio);
	} else if (pendingGenre) {
		const g = pendingGenre;
		pendingGenre = null;
		const stale = currentGenre;
		currentGenre = null;
		playGenre(g);
		if (currentGenre === null) currentGenre = stale;
	}
}

export function isEnabled() {
	return enabled;
}

export async function playGenre(name) {
	const trimmed = String(name || "").trim();
	if (!trimmed) {
		if (currentGenre !== null) {
			currentGenre = null;
			currentTrackList = null;
			fadeAudioOut(activeAudio);
			fadeAudioOut(inactiveAudio);
		}
		pendingGenre = null;
		return;
	}

	if (trimmed === currentGenre) return;

	if (!enabled) {
		pendingGenre = trimmed;
		return;
	}

	currentGenre = trimmed;
	pendingGenre = null;
	const myToken = ++pendingToken;

	let urls = trackCache.get(trimmed);
	if (!urls) {
		urls = await fetchPreviewUrls(trimmed);
		if (myToken !== pendingToken) return;
		trackCache.set(trimmed, urls);
	}
	if (myToken !== pendingToken) return;
	if (!urls || urls.length === 0) return;

	currentTrackList = urls;
	currentTrackIndex = Math.floor(Math.random() * urls.length);
	playUrl(urls[currentTrackIndex]);
}

async function fetchPreviewUrls(name) {
	const tryNames = [];
	tryNames.push(name);
	const lastWord = name.split(/\s+/).filter(Boolean).pop();
	if (lastWord && lastWord !== name) tryNames.push(lastWord);

	for (const term of tryNames) {
		try {
			const params = new URLSearchParams({
				term,
				entity: "song",
				limit: "12",
				media: "music",
			});
			const res = await fetch(`${ITUNES_SEARCH_URL}?${params.toString()}`);
			if (!res.ok) continue;
			const json = await res.json();
			const urls = (json.results || [])
				.map((t) => t.previewUrl)
				.filter(Boolean);
			if (urls.length > 0) return urls;
		} catch (e) {
			console.warn("audio fetch failed for", term, e);
		}
	}
	return [];
}

function playUrl(url) {
	if (!url || !inactiveAudio) return;

	inactiveAudio.src = url;
	inactiveAudio.volume = 0;
	const playPromise = inactiveAudio.play();
	if (playPromise && typeof playPromise.catch === "function") {
		playPromise.catch((e) => console.warn("audio play blocked:", e));
	}

	crossfadeBetween(activeAudio, inactiveAudio);
	[activeAudio, inactiveAudio] = [inactiveAudio, activeAudio];
}

function crossfadeBetween(fromAudio, toAudio) {
	const startTime = performance.now();
	const startFromVol = fromAudio ? fromAudio.volume : 0;

	function step() {
		const elapsed = performance.now() - startTime;
		const progress = Math.min(1, elapsed / FADE_DURATION_MS);
		if (fromAudio) fromAudio.volume = Math.max(0, startFromVol * (1 - progress));
		if (toAudio) toAudio.volume = VOLUME * progress;

		if (progress < 1) {
			requestAnimationFrame(step);
		} else {
			if (fromAudio && !fromAudio.paused) fromAudio.pause();
			if (fromAudio) fromAudio.volume = 0;
		}
	}
	requestAnimationFrame(step);
}

function fadeAudioOut(audio) {
	if (!audio || audio.paused) return;
	const startVol = audio.volume;
	const startTime = performance.now();

	function step() {
		const elapsed = performance.now() - startTime;
		const progress = Math.min(1, elapsed / FADE_DURATION_MS);
		audio.volume = Math.max(0, startVol * (1 - progress));

		if (progress < 1) {
			requestAnimationFrame(step);
		} else {
			audio.pause();
			audio.volume = 0;
		}
	}
	requestAnimationFrame(step);
}

function playNextInList() {
	if (!currentTrackList || currentTrackList.length === 0) return;
	currentTrackIndex = (currentTrackIndex + 1) % currentTrackList.length;
	playUrl(currentTrackList[currentTrackIndex]);
}
