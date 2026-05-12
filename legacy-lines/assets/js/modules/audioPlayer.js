const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const FADE_DURATION_MS = 700;
const VOLUME = 0.7;
const MAX_PLAY_RETRIES = 3;

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
let crossfadeRafId = null;
let playRetryCount = 0;

let currentTrackInfo = null;
let trackChangeListener = null;

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
		setCurrentTrackInfo(null);
	} else if (pendingGenre) {
		const g = pendingGenre;
		pendingGenre = null;
		currentGenre = null;
		playGenre(g);
	}
}

export function isEnabled() {
	return enabled;
}

export function setTrackChangeListener(fn) {
	trackChangeListener = typeof fn === "function" ? fn : null;
}

export function getCurrentTrack() {
	return currentTrackInfo;
}

function setCurrentTrackInfo(info) {
	if (!info && !currentTrackInfo) return;
	if (info && currentTrackInfo &&
		info.name === currentTrackInfo.name &&
		info.artist === currentTrackInfo.artist) return;
	currentTrackInfo = info;
	if (trackChangeListener) {
		try { trackChangeListener(currentTrackInfo); } catch (e) { console.warn("trackChangeListener error:", e); }
	}
}

export async function playGenre(name) {
	const trimmed = String(name || "").trim();
	if (!trimmed) {
		if (currentGenre !== null) {
			currentGenre = null;
			currentTrackList = null;
			fadeAudioOut(activeAudio);
			fadeAudioOut(inactiveAudio);
			setCurrentTrackInfo(null);
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

	let tracks = trackCache.get(trimmed);
	if (!tracks) {
		tracks = await fetchPreviewTracks(trimmed);
		if (myToken !== pendingToken) return;
		// Only cache non-empty results so a transient empty fetch can be retried
		if (tracks && tracks.length > 0) {
			trackCache.set(trimmed, tracks);
		}
	}
	if (myToken !== pendingToken) return;
	if (!tracks || tracks.length === 0) return;

	currentTrackList = tracks;
	currentTrackIndex = Math.floor(Math.random() * tracks.length);
	playRetryCount = 0;
	playTrack(tracks[currentTrackIndex]);
}

async function fetchPreviewTracks(name) {
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
			const tracks = (json.results || [])
				.filter((t) => t && t.previewUrl)
				.map((t) => ({
					url: t.previewUrl,
					name: String(t.trackName || "").trim(),
					artist: String(t.artistName || "").trim(),
				}));
			if (tracks.length > 0) return tracks;
		} catch (e) {
			console.warn("audio fetch failed for", term, e);
		}
	}
	return [];
}

function playTrack(track) {
	if (!track || !track.url || !inactiveAudio) return;

	inactiveAudio.src = track.url;
	inactiveAudio.volume = 0;
	const playPromise = inactiveAudio.play();
	if (playPromise && typeof playPromise.then === "function") {
		playPromise.then(() => {
			playRetryCount = 0;
			setCurrentTrackInfo({ name: track.name, artist: track.artist });
		}).catch((e) => {
			console.warn("audio play failed:", e);
			if (playRetryCount < MAX_PLAY_RETRIES) {
				playRetryCount++;
				playNextInList();
			}
		});
	} else {
		setCurrentTrackInfo({ name: track.name, artist: track.artist });
	}

	crossfadeBetween(activeAudio, inactiveAudio);
	[activeAudio, inactiveAudio] = [inactiveAudio, activeAudio];
}

function crossfadeBetween(fromAudio, toAudio) {
	// Cancel any in-flight crossfade so concurrent fades cannot fight each other
	if (crossfadeRafId) {
		cancelAnimationFrame(crossfadeRafId);
		crossfadeRafId = null;
	}
	const startTime = performance.now();
	const startFromVol = fromAudio ? fromAudio.volume : 0;

	function step() {
		const elapsed = performance.now() - startTime;
		const progress = Math.min(1, elapsed / FADE_DURATION_MS);
		if (fromAudio) fromAudio.volume = Math.max(0, startFromVol * (1 - progress));
		if (toAudio) toAudio.volume = VOLUME * progress;

		if (progress < 1) {
			crossfadeRafId = requestAnimationFrame(step);
		} else {
			crossfadeRafId = null;
			if (fromAudio && !fromAudio.paused) fromAudio.pause();
			if (fromAudio) fromAudio.volume = 0;
		}
	}
	crossfadeRafId = requestAnimationFrame(step);
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
	playTrack(currentTrackList[currentTrackIndex]);
}
