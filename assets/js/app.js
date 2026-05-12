import { getDomRefs } from "./core/dom.js";
import { setupDraggableUsers } from "./modules/drag.js";
import { setupCentroid, notifyCentroidTargets, getCurrentActivatedGenreName, setGenreChangeListener } from "./modules/centroid.js";
import { renderLabels } from "./modules/labels.js";
import { renderRing } from "./modules/ring.js";
import { renderHighlights, updateHighlights } from "./modules/highlights.js";
import { ParticleSystem } from "./modules/particles.js";
import { setupSidebarMenu } from "./modules/sidebar.js";
import { getUsers } from "./core/state.js";
import { isPointInCircle } from "./utils/geometry.js";
import { setupCooccurrenceBridges } from "./modules/cooccurrence-bridges.js";
import { setupRhythmMode, showRhythmMode, hideRhythmMode, setRhythmBPM } from "./modules/rhythm.js";
import { setupAudioPlayer, setEnabled as setAudioEnabled, isEnabled as isAudioEnabled, playGenre as playGenreAudio } from "./modules/audioPlayer.js";

async function init() {
	// startup
	const { svg, defs, ringBaseGroup, genreTreesGroup, ringHighlightsGroup, ringLabelsGroup, particlesGroup, centroidGroup, draggableDotsGroup } = getDomRefs();
	const statusElement = document.getElementById("musicbrainz-status");
	if (!svg || !defs || !ringBaseGroup || !genreTreesGroup || !ringHighlightsGroup || !ringLabelsGroup || !particlesGroup || !draggableDotsGroup || !statusElement) {
		return;
	}

	// Setup sidebar menu
	setupSidebarMenu();

	const particleSystem = new ParticleSystem(svg, particlesGroup);

	// Centroid rendering (lines + centroid dot)
	setupCentroid(svg, centroidGroup);
	// initial target calculation (in case some dots start inside)
	notifyCentroidTargets();

	renderRing(ringBaseGroup);
	renderHighlights(ringHighlightsGroup);
	renderLabels(defs, ringLabelsGroup);
	setupDraggableUsers(svg, draggableDotsGroup);
	setupCooccurrenceBridges(genreTreesGroup);
	setupRhythmMode(svg);
	statusElement.hidden = true;

	let currentMode = "map";
	const mapHideableGroups = [genreTreesGroup, centroidGroup, particlesGroup, draggableDotsGroup];
	const mapBtn = document.getElementById("mode-map-btn");
	const rhythmBtn = document.getElementById("mode-rhythm-btn");

	function setModeButtons(mode) {
		if (mapBtn) mapBtn.classList.toggle("is-active", mode === "map");
		if (rhythmBtn) rhythmBtn.classList.toggle("is-active", mode === "rhythm");
	}

	const bpmPanel = document.getElementById("bpm-control-panel");

	function enterRhythmMode() {
		if (currentMode === "rhythm") return;
		currentMode = "rhythm";
		const genreName = getCurrentActivatedGenreName();
		mapHideableGroups.forEach((g) => { if (g) g.style.display = "none"; });
		const curvedLabelLayer = svg.querySelector(".curved-label-layer");
		if (curvedLabelLayer) curvedLabelLayer.style.display = "none";
		const connLines = svg.querySelector(".cooccurrence-connection-lines");
		if (connLines) connLines.style.display = "none";
		if (bpmPanel) bpmPanel.style.display = "flex";
		showRhythmMode(genreName);
		setModeButtons("rhythm");
	}

	function exitRhythmMode() {
		if (currentMode === "map") return;
		currentMode = "map";
		hideRhythmMode();
		mapHideableGroups.forEach((g) => { if (g) g.style.display = ""; });
		const curvedLabelLayer = svg.querySelector(".curved-label-layer");
		if (curvedLabelLayer) curvedLabelLayer.style.display = "";
		const connLines = svg.querySelector(".cooccurrence-connection-lines");
		if (connLines) connLines.style.display = "";
		if (bpmPanel) bpmPanel.style.display = "none";
		setModeButtons("map");
	}

	if (mapBtn) mapBtn.addEventListener("click", exitRhythmMode);
	if (rhythmBtn) rhythmBtn.addEventListener("click", enterRhythmMode);

	setupAudioPlayer();
	setGenreChangeListener((name) => {
		playGenreAudio(name);
	});

	const musicBtn = document.getElementById("music-toggle-btn");
	if (musicBtn) {
		musicBtn.addEventListener("click", () => {
			const next = !isAudioEnabled();
			setAudioEnabled(next);
			musicBtn.classList.toggle("is-active", next);
			if (next) {
				const cur = getCurrentActivatedGenreName();
				if (cur) playGenreAudio(cur);
			}
		});
	}

	// BPM slider for rhythm mode
	const bpmSlider = document.getElementById("rhythm-bpm");
	const bpmValue = document.getElementById("rhythm-bpm-value");
	if (bpmSlider) {
		bpmSlider.addEventListener("input", () => {
			const val = Number(bpmSlider.value) || 92;
			setRhythmBPM(val);
			if (bpmValue) bpmValue.textContent = String(val);
		});
	}

	// Ambient loop: Alle Users außerhalb des Genre-Rings parallel als Pull-Emitter aktualisieren
	function updateAmbientParticles() {
		const users = getUsers();
		const usersForPullEffect = users
			.filter((user) => !isPointInCircle({ x: user.x, y: user.y }))
			.map((user) => ({
				x: user.x,
				y: user.y,
				color: user.color,
				id: user.id,
			}));

		particleSystem.updatePullEmitters(usersForPullEffect);
		updateHighlights();

		requestAnimationFrame(updateAmbientParticles);
	}

	updateAmbientParticles();
}

// start app and surface any startup errors to the console
init().catch((err) => {
	console.error("app.init: unhandled error", err);
});
