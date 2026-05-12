import { RING_CENTER, RING_RADIUS, LABEL_RADIUS_INNER, LABEL_RADIUS_OUTER } from "../config/constants.js";
import { ringLabels } from "../data/genres.js";
import { createSvgElement, polarToCartesian } from "../core/svg.js";
import { getUsers, getSuperGenres } from "../core/state.js";
import { getAnchorAngle } from "./bridges.js";
import { computeCooccurrence, computeIntersectionCooccurrence } from "../data/musicbrainz/cooccurrence.js";

let bridgeLayer = null;
let connectionLinesLayer = null;
let lastActiveKey = "";
let lastSettingsKey = "";
let pendingRunToken = 0;
let preloadToken = 0;
const preloadedBySettings = new Map();
const preloadedIntersections = new Map(); // intersectionKey -> data
const MAP_SETTINGS_KEY = "hcid_map_display_settings";
const MB_SETTINGS_KEY = "hcid_mb_cooccurrence_settings";
const LABEL_VISIBILITY_KEY = "hcid_genre_dot_label_visibility";
let genreDotLabelVisibilityMode = "selected";

// State tracking for bridge dots: dotElement -> { parentGenreIds: [id1, id2, ...], type: "direct" | "intersection" }
const dotMetadata = new WeakMap();

let activeCurvedDot = null;
let curvedLabelRotation = 0;
let curvedLabelLayer = null;
let curvedCharNodes = [];
const CURVED_LABEL_GAP = 8;
const CURVED_ROTATION_SPEED = 0.4;
const CURVED_CHAR_WIDTH = 5;
const CURVED_SEPARATOR = " · ";

function getDebugNode(id) {
	return document.getElementById(id);
}

/**
 * Mix two colors (hex format) by averaging their RGB values
 * e.g., "#d64949" (red) + "#f1bf4c" (yellow) = greenish color
 */
function mixColors(color1, color2) {
	const hex1 = color1.replace("#", "");
	const hex2 = color2.replace("#", "");

	const r1 = parseInt(hex1.substring(0, 2), 16);
	const g1 = parseInt(hex1.substring(2, 4), 16);
	const b1 = parseInt(hex1.substring(4, 6), 16);

	const r2 = parseInt(hex2.substring(0, 2), 16);
	const g2 = parseInt(hex2.substring(2, 4), 16);
	const b2 = parseInt(hex2.substring(4, 6), 16);

	const rMix = Math.round((r1 + r2) / 2);
	const gMix = Math.round((g1 + g2) / 2);
	const bMix = Math.round((b1 + b2) / 2);

	return "#" + [rMix, gMix, bMix].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Get the color for an intersection bridge
 * For genres A and B, mix their user colors
 */
function getIntersectionColor(superGenreIdA, superGenreIdB, users) {
	const superGenres = getSuperGenres();
	const sgA = superGenres[superGenreIdA];
	const sgB = superGenres[superGenreIdB];

	let colorA = "#ffffff";
	let colorB = "#ffffff";

	if (sgA?.activeUserId !== null && sgA?.activeUserId !== undefined) {
		colorA = users[sgA.activeUserId]?.color ?? "#ffffff";
	}
	if (sgB?.activeUserId !== null && sgB?.activeUserId !== undefined) {
		colorB = users[sgB.activeUserId]?.color ?? "#ffffff";
	}

	return mixColors(colorA, colorB);
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function getCollisionGap() {
	const gapNode = getDebugNode("map-collision-gap");
	return clamp(Number(gapNode?.value || 100), 0, 100);
}

function getRadiusScalingType() {
	const scalingNode = getDebugNode("map-radius-scaling");
	return scalingNode?.value || "count";
}

function loadMapSettings() {
	try {
		const raw = localStorage.getItem(MAP_SETTINGS_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return { collisionGap: 100, radiusScaling: "connections", generationIterations: 1 };
}

function saveMapSettings({ collisionGap, radiusScaling, generationIterations } = {}) {
	try {
		const existing = loadMapSettings();
		const toSave = {
			collisionGap: typeof collisionGap === "number" ? collisionGap : existing.collisionGap,
			radiusScaling: typeof radiusScaling === "string" ? radiusScaling : existing.radiusScaling,
			generationIterations: typeof generationIterations === "number" ? generationIterations : existing.generationIterations,
		};
		localStorage.setItem(MAP_SETTINGS_KEY, JSON.stringify(toSave));
	} catch {}
}

function loadMbSettings() {
	try {
		const raw = localStorage.getItem(MB_SETTINGS_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return { entityType: "release", maxEntities: 100, topN: 6 };
}

function loadLabelVisibilityMode() {
	try {
		const raw = localStorage.getItem(LABEL_VISIBILITY_KEY);
		if (raw === "all" || raw === "selected") {
			return raw;
		}
	} catch {}
	return "selected";
}

function saveLabelVisibilityMode(mode) {
	try {
		localStorage.setItem(LABEL_VISIBILITY_KEY, mode === "all" ? "all" : "selected");
	} catch {}
}

function saveMbSettings({ entityType, maxEntities, topN } = {}) {
	try {
		const existing = loadMbSettings();
		const toSave = {
			entityType: typeof entityType === "string" ? entityType : existing.entityType,
			maxEntities: typeof maxEntities === "number" ? maxEntities : existing.maxEntities,
			topN: typeof topN === "number" ? topN : existing.topN,
		};
		localStorage.setItem(MB_SETTINGS_KEY, JSON.stringify(toSave));
	} catch {}
}

function getPrimaryGenreName(genreId) {
	const entry = ringLabels[genreId];
	if (Array.isArray(entry) && entry.length > 0) {
		return String(entry[0]).trim().toLowerCase();
	}
	return "";
}

function getAllSuperGenreNames() {
	return ringLabels
		.map((entry) => (Array.isArray(entry) && entry.length > 0 ? String(entry[0]).trim().toLowerCase() : ""))
		.filter(Boolean);
}

function getBridgeSettings() {
	const entityNode = getDebugNode("debug-entity");
	const maxNode = getDebugNode("debug-max");
	const topNNode = getDebugNode("debug-topn");
	const generationIterationsNode = getDebugNode("map-generation-iterations");

	const entityType = entityNode?.value || "release";
	const maxEntities = clamp(Number(maxNode?.value || 300), 10, 2000);
	const topN = clamp(Number(topNNode?.value || 6), 1, 40);
	// optional debug knobs (may not be in markup) for candidate pool and minimal support
	const topKNode = getDebugNode("debug-topk");
	const minSupportNode = getDebugNode("debug-minsupport");
	const topK = clamp(Number(topKNode?.value || 100), 5, 200);
	const min_support = clamp(Number(minSupportNode?.value || 1), 0, 100);
	const generationIterations = clamp(Number(generationIterationsNode?.value || 1), 1, 20);

	return {
		entityType,
		maxEntities,
		topN,
		topK,
		min_support,
		generationIterations,
	};
}

function getAnchorPosition(genreId) {
	const angle = getAnchorAngle(genreId, ringLabels.length);
	return {
		angle,
		...polarToCartesian(RING_CENTER.x, RING_CENTER.y, RING_RADIUS - 120, angle),
	};
}

function clampInsideRing(point, margin = 34) {
	// Determine an inner maximum radius so dots stay inside the visible inner area
	// Shift the outer limit further inward by about half of the white ring width
	const whiteWidth = Math.max(0, LABEL_RADIUS_OUTER - LABEL_RADIUS_INNER);
	const halfWhite = whiteWidth / 2;
	const maxRadius = Math.max(0, LABEL_RADIUS_INNER - halfWhite - margin);
	const dx = point.x - RING_CENTER.x;
	const dy = point.y - RING_CENTER.y;
	const dist = Math.hypot(dx, dy) || 0.0001;

	if (dist <= maxRadius) {
		return point;
	}

	const ux = dx / dist;
	const uy = dy / dist;
	return {
		x: RING_CENTER.x + ux * maxRadius,
		y: RING_CENTER.y + uy * maxRadius,
	};
}

function isSuperGenreDot(item) {
	return item?._groupId !== undefined && item.name === ringLabels[item._groupId]?.[0]?.toUpperCase();
}

function placeGenreDots(anchorAngle, anchorPoint, items) {
	const spread = 84;
	const minAngle = anchorAngle - spread / 2;
	const slotStep = items.length > 1 ? spread / (items.length - 1) : 0;

	return items.map((item, index) => {
		const row = Math.floor(index / 6);
		const localIndex = index % 6;
		const localAngle = minAngle + (items.length > 1 ? index * slotStep : spread / 2);
		const radius = 58 + row * 34 + localIndex * 1.2;
		const p = polarToCartesian(anchorPoint.x, anchorPoint.y, radius, localAngle);
		return {
			...item,
			position: clampInsideRing(p),
			// will be filled later
			_el: null,
			target: null,
		};
	});
}

// Legacy export for backwards compatibility
const placeBridgeDots = placeGenreDots;

function renderGenreDot(container, item, strokeColor) {
	const circle = createSvgElement("circle");
	circle.setAttribute("class", "genre-dot");
	circle.setAttribute("cx", String(item.position.x));
	circle.setAttribute("cy", String(item.position.y));
	circle.setAttribute("r", String(item.radius));
	circle.setAttribute("fill", "#ffffff");
	circle.setAttribute("stroke", strokeColor);
	circle.setAttribute("stroke-width", "2");

	const title = createSvgElement("title");
	title.textContent = `${item.name}: ${item.count} / ${item.totalSampled} (${(item.entity_share * 100).toFixed(1)}%)`;
	circle.appendChild(title);

	const text = createSvgElement("text");
	text.setAttribute("class", "genre-dot-label");
	text.setAttribute("x", String(item.position.x + item.radius + 3));
	text.setAttribute("y", String(item.position.y + 4));
	text.textContent = item.name;
	text.style.display = genreDotLabelVisibilityMode === "all" ? "" : "none";
	circle.__labelNode = text;
	text.__dotNode = circle;

	container.appendChild(circle);
	container.appendChild(text);

	circle.__curvedText = String(item.name || "");

	return { circle, text };
}

// Legacy export for backwards compatibility
const renderBridgeDot = renderGenreDot;

function updateDebugOutput(html) {
	const results = getDebugNode("debug-results");
	if (!results) {
		return;
	}
	results.innerHTML = html;
}

function getActiveSuperGenres() {
	return getSuperGenres().filter((superGenre) => superGenre.active);
}

// Legacy export for backwards compatibility
const getActiveGenres = getActiveSuperGenres;

function getSettingsKey(settings) {
	return `${settings.entityType}|${settings.maxEntities}|${settings.topN}`;
}

export function updateGenreDotLabelVisibility(selectedDotEl = null) {
	const labels = bridgeLayer ? bridgeLayer.querySelectorAll(".genre-dot-label") : document.querySelectorAll(".genre-dot-label");
	labels.forEach((label) => {
		label.style.display = genreDotLabelVisibilityMode === "all" ? "" : "none";
	});

	if (genreDotLabelVisibilityMode !== "selected" || !selectedDotEl) {
		if (curvedLabelLayer) {
			curvedLabelLayer.replaceChildren();
		}
		curvedCharNodes = [];
		activeCurvedDot = null;
		return;
	}

	const baseText = selectedDotEl.__curvedText || (selectedDotEl.__labelNode?.textContent) || "";
	if (!baseText) {
		return;
	}

	const dotR = Number(selectedDotEl.getAttribute('r')) || 8;
	const labelR = dotR + CURVED_LABEL_GAP;
	const circumference = 2 * Math.PI * labelR;
	const unit = baseText + CURVED_SEPARATOR;
	const unitArc = unit.length * CURVED_CHAR_WIDTH;
	const repetitions = Math.max(1, Math.round(circumference / unitArc));
	const fullText = unit.repeat(repetitions);

	if (activeCurvedDot !== selectedDotEl || curvedCharNodes.length !== fullText.length) {
		if (curvedLabelLayer) {
			curvedLabelLayer.replaceChildren();
		}
		curvedCharNodes = [];
		if (curvedLabelLayer) {
			for (const ch of fullText) {
				const charNode = createSvgElement("text");
				charNode.setAttribute("class", "genre-dot-curved-label");
				charNode.setAttribute("text-anchor", "middle");
				charNode.setAttribute("dominant-baseline", "central");
				charNode.textContent = ch;
				curvedLabelLayer.appendChild(charNode);
				curvedCharNodes.push(charNode);
			}
		}
		activeCurvedDot = selectedDotEl;
	}

	const cx = Number(selectedDotEl.getAttribute('cx')) || 0;
	const cy = Number(selectedDotEl.getAttribute('cy')) || 0;

	curvedLabelRotation = (curvedLabelRotation + CURVED_ROTATION_SPEED) % 360;
	const rotationRadians = (curvedLabelRotation * Math.PI) / 180;

	const totalChars = curvedCharNodes.length;
	if (totalChars === 0) return;

	const stepRadians = (Math.PI * 2) / totalChars;
	const startRadians = -Math.PI / 2 + rotationRadians;

	for (let i = 0; i < totalChars; i++) {
		const radians = startRadians + i * stepRadians;
		const x = cx + labelR * Math.cos(radians);
		const y = cy + labelR * Math.sin(radians);
		const tangentDeg = (radians * 180) / Math.PI + 90;
		const node = curvedCharNodes[i];
		node.setAttribute('x', String(x));
		node.setAttribute('y', String(y));
		node.setAttribute('transform', `rotate(${tangentDeg} ${x} ${y})`);
	}
}

/**
 * Calculate genre-dot position based on co-occurrence to all active super-genres
 * - 100% co-occurrence → positioned at ring (near super-genre label, RING_RADIUS - 40)
 * - 0% co-occurrence → positioned halfway between ring and circle center
 * - X% → weighted position between ring and halfway point
 */
function getRandomPositionInsideRing() {
	// Spread initial positions widely so dots don't cluster at center
	const maxR = 280;
	const r = Math.sqrt(Math.random()) * maxR;
	const a = Math.random() * Math.PI * 2;
	return {
		x: RING_CENTER.x + Math.cos(a) * r,
		y: RING_CENTER.y + Math.sin(a) * r,
	};
}

function getCachedDatasetForSettings(settingsKey) {
	return preloadedBySettings.get(settingsKey) ?? null;
}

async function getOrLoadCooccurrenceDataset(sourceName, settings, { forceRefresh = false } = {}) {
	const settingsKey = getSettingsKey(settings);
	let dataset = getCachedDatasetForSettings(settingsKey);
	if (!dataset) {
		dataset = new Map();
		preloadedBySettings.set(settingsKey, dataset);
	}

	if (!forceRefresh && dataset.has(sourceName)) {
		return dataset.get(sourceName);
	}

	try {
		const out = await computeCooccurrence(sourceName, {
			entityType: settings.entityType,
			maxEntities: settings.maxEntities,
			forceRefresh,
		});
		// Only cache successful results so failures get retried on next call
		if (out && out.totalSampled > 0) {
			dataset.set(sourceName, out);
		}
		return out;
	} catch (error) {
		// Don't cache errors — let the next call retry
		return {
			genre: sourceName,
			entityType: settings.entityType,
			totalSampled: 0,
			totalTagMentions: 0,
			results: [],
			error: String(error?.message || error),
		};
	}
}

function getPointAngle(point) {
	return Math.atan2(point.y - RING_CENTER.y, point.x - RING_CENTER.x);
}

function getPositionAlongAnchor(angle, minRadius = 80, maxRadius = RING_RADIUS - 120, angularSpread = 55) {
	const r = minRadius + Math.random() * Math.max(0, maxRadius - minRadius);
	const jitteredAngle = angle + (Math.random() - 0.5) * angularSpread;
	return polarToCartesian(RING_CENTER.x, RING_CENTER.y, r, jitteredAngle);
}

async function preloadAllSuperGenres(settings, { forceRefresh = false } = {}) {
	const settingsKey = getSettingsKey(settings);
	const existingDataset = getCachedDatasetForSettings(settingsKey);
	if (existingDataset && existingDataset.size > 0 && !forceRefresh) {
		return existingDataset;
	}

	const currentPreloadToken = ++preloadToken;
	const genreNames = getAllSuperGenreNames();
	const dataset = new Map();
	preloadedBySettings.set(settingsKey, dataset);

	for (let index = 0; index < genreNames.length; index++) {
		if (currentPreloadToken !== preloadToken) {
			return dataset;
		}

		const genreName = genreNames[index];
		updateDebugOutput(
			`<p class="muted">Vorab-Laden: ${index + 1}/${genreNames.length} (${genreName}) für ${settings.entityType}, ${settings.maxEntities} Entities …</p>`
		);

		try {
			const out = await computeCooccurrence(genreName, {
				entityType: settings.entityType,
				maxEntities: settings.maxEntities,
				forceRefresh,
			});
			// Only cache if data was actually retrieved
			if (out && out.totalSampled > 0) {
				dataset.set(genreName, out);
			}
		} catch {
			// Don't cache errors — showGenresForSuperGenre will retry on demand
		}
	}

	if (currentPreloadToken === preloadToken) {
		updateDebugOutput(
			`<p class="muted">Vorab-Laden abgeschlossen: ${genreNames.length} Super-Genres (${settings.entityType}, ${settings.maxEntities} Entities).</p>`
		);
	}

	return dataset;
}

async function renderNestedGeneration(container, sourceItem, settings, depth, maxDepth, color, ancestry, runToken) {
	if (depth > maxDepth || runToken !== pendingRunToken) {
		return;
	}

	const normalizedSourceName = String(sourceItem.name || "").trim().toLowerCase();
	if (!normalizedSourceName || ancestry.has(normalizedSourceName)) {
		return;
	}

	const out = await getOrLoadCooccurrenceDataset(normalizedSourceName, settings);
	if (!out || !Array.isArray(out.results) || out.results.length === 0) {
		return;
	}

	const top = out.results.slice(0, settings.topN);
	const scaled = withScaledRadius(
		top.map((item) => ({ ...item, totalSampled: out.totalSampled }))
	);

	// Place items along the radial axis between super-genre label and center
	const placed = scaled.map((item) => ({
		...item,
		position: getRandomPositionInsideRing(),
		radius: item.radius || 8,
	}));

	const childGroup = createSvgElement("g");
	childGroup.setAttribute("class", "nested-generation-group");
	childGroup.setAttribute("data-generation-depth", String(depth));
	childGroup.setAttribute("data-generation-source", normalizedSourceName);
	container.appendChild(childGroup);

	const nextAncestry = new Set(ancestry);
	nextAncestry.add(normalizedSourceName);

	for (let index = 0; index < placed.length; index++) {
		if (runToken !== pendingRunToken) {
			return;
		}

		const item = placed[index];
		item._metrics = {
			count: scaled[index].count,
			entity_share: scaled[index].entity_share,
			tag_share: scaled[index].tag_share,
		};
		const els = renderGenreDot(childGroup, item, color);
		item._el = els;

		if (depth < maxDepth) {
			await renderNestedGeneration(childGroup, item, settings, depth + 1, maxDepth, color, nextAncestry, runToken);
		}
	}
}

async function renderGroupForGenre(dataset, superGenre, settings, users, runToken) {
	const sourceGenreName = getPrimaryGenreName(superGenre.id);
	if (!sourceGenreName) return `<li><strong>unknown</strong>: ungültiges Super-Genre</li>`;

	const existingGroup = bridgeLayer?.querySelector(`.supergenre-group[data-supergenre-id='${superGenre.id}']`);
	if (existingGroup) {
		return `<li><strong>${sourceGenreName}</strong>: bereits vorhanden</li>`;
	}

	const out = dataset.get(sourceGenreName);
	if (!out) {
		return `<li><strong>${sourceGenreName}</strong>: noch nicht vorab geladen</li>`;
	}

	const top = out.results.slice(0, settings.topN);
	const scaled = withScaledRadius(
		top.map((item) => ({ ...item, totalSampled: out.totalSampled }))
	);

	const activeUser = superGenre.activeUserId !== null ? users[superGenre.activeUserId] : null;
	const color = activeUser?.color ?? "#ffffff";
	const anchor = getAnchorPosition(superGenre.id);

	// Place items along the radial axis from the super-genre label towards center
	const placed = scaled.map((item) => ({
		...item,
		position: getRandomPositionInsideRing(),
		radius: item.radius || 8,
	}));

	const group = createSvgElement("g");
	group.setAttribute("class", "supergenre-group");
	group.setAttribute("data-supergenre-id", String(superGenre.id));

	placed.forEach((item, idx) => {
		item._groupId = superGenre.id;
		// preserve the original metrics for later rescaling
		item._metrics = {
			count: scaled[idx].count,
			entity_share: scaled[idx].entity_share,
			tag_share: scaled[idx].tag_share,
		};
		const els = renderGenreDot(group, item, color);
		item._el = els;
	});

	group.__items = placed;
	bridgeLayer.appendChild(group);

	const allItems = getDisplayedItems();
	bridgeLayer.__animatedItems = allItems;
	computeAndStartAnimation(allItems, getActiveSuperGenres(), settings);

	if (settings.generationIterations > 1) {
		const ancestry = new Set([sourceGenreName]);
		for (const item of placed) {
			if (runToken !== pendingRunToken) {
				break;
			}
			await renderNestedGeneration(group, item, settings, 2, settings.generationIterations, color, ancestry, runToken);
		}
	}

	return `<li><strong>${sourceGenreName}</strong>: ${placed.length} Top-Tags aus ${out.totalSampled} ${settings.entityType}s</li>`;
}

/**
 * Render intersection/bridge genres for two active super-genres
 * Shows the top genres that appear in the co-occurrence data of BOTH genres
 */
async function renderIntersectionGroupForGenres(superGenreA, superGenreB, settings, users, runToken) {
	const sourceGenreNameA = getPrimaryGenreName(superGenreA.id);
	const sourceGenreNameB = getPrimaryGenreName(superGenreB.id);

	if (!sourceGenreNameA || !sourceGenreNameB) {
		return `<li><strong>unknown</strong>: ungültige Super-Genres für Brücke</li>`;
	}

	const existingGroup = bridgeLayer?.querySelector(
		`.intersection-group[data-supergenre-a='${superGenreA.id}'][data-supergenre-b='${superGenreB.id}']`
	);
	if (existingGroup) {
		return `<li><strong>${sourceGenreNameA} ↔ ${sourceGenreNameB}</strong>: bereits vorhanden</li>`;
	}

	// Generate a unique key for this intersection pair (include relevant MB params)
	const intersectionKey = `${sourceGenreNameA}|${sourceGenreNameB}|${settings.entityType}|${settings.maxEntities}|topK=${settings.topK||20}|min_support=${settings.min_support||1}|topN=${settings.topN}`;

	// Check cache
	let intersectionData = preloadedIntersections.get(intersectionKey);
	if (!intersectionData) {
		try {
			intersectionData = await computeIntersectionCooccurrence(sourceGenreNameA, sourceGenreNameB, {
				entityType: settings.entityType,
				maxEntities: settings.maxEntities,
				topK: settings.topK || 20,
				min_support: settings.min_support || 1,
				topN: settings.topN,
			});
			preloadedIntersections.set(intersectionKey, intersectionData);
		} catch (error) {
			return `<li><strong>${sourceGenreNameA} ↔ ${sourceGenreNameB}</strong>: Fehler (${String(error?.message || error)})</li>`;
		}
	}

	const intersection = intersectionData?.intersection || [];
	if (!intersection.length) {
		return `<li><strong>${sourceGenreNameA} ↔ ${sourceGenreNameB}</strong>: Keine gemeinsamen Top-Genres</li>`;
	}

	// Mix colors from both user colors
	const color = getIntersectionColor(superGenreA.id, superGenreB.id, users);

	// Normalize intersection items to expected fields (count_avg, entity_share_avg, tag_share_avg)
	const normalizedIntersection = intersection.map((item) => {
		if (item.count_avg !== undefined) {
			return { name: item.name, count_avg: item.count_avg, entity_share_avg: item.entity_share_avg, tag_share_avg: item.tag_share_avg };
		}
		if (item.count_joint !== undefined) {
			return { name: item.name, count_avg: item.count_joint, entity_share_avg: item.entity_share, tag_share_avg: item.tag_share };
		}
		// fallback: combine count_a/count_b if present
		if (item.count_a !== undefined && item.count_b !== undefined) {
			return { name: item.name, count_avg: (item.count_a + item.count_b) / 2, entity_share_avg: (item.entity_share_a || 0 + item.entity_share_b || 0) / 2, tag_share_avg: 0 };
		}
		return { name: item.name, count_avg: item.count || 0, entity_share_avg: item.entity_share || 0, tag_share_avg: item.tag_share || 0 };
	});

	// Scale radii based on intersection metrics
	const scaled = withScaledRadius(
		normalizedIntersection.map((item) => ({
			...item,
			count: item.count_avg,
			entity_share: item.entity_share_avg,
			tag_share: item.tag_share_avg,
		}))
	);

	// Place items randomly inside ring
	const placed = scaled.map((item) => ({
		...item,
		position: getRandomPositionInsideRing(),
		radius: item.radius || 8,
	}));

	// Create group for intersection
	const group = createSvgElement("g");
	group.setAttribute("class", "intersection-group");
	group.setAttribute("data-supergenre-a", String(superGenreA.id));
	group.setAttribute("data-supergenre-b", String(superGenreB.id));

	placed.forEach((item, idx) => {
		item._groupId = null; // intersection items don't have a single groupId
		item._parentGenreIds = [superGenreA.id, superGenreB.id];
		item._isIntersection = true;
		item._metrics = {
			count: scaled[idx].count,
			entity_share: scaled[idx].entity_share,
			tag_share: scaled[idx].tag_share,
		};
		const els = renderGenreDot(group, item, color);
		item._el = els;
		
		// Track metadata for this dot
		if (els.circle) {
			dotMetadata.set(els.circle, { 
				parentGenreIds: item._parentGenreIds, 
				type: "intersection" 
			});
		}
	});

	group.__items = placed;
	group.__parentGenreIds = [superGenreA.id, superGenreB.id];
	bridgeLayer.appendChild(group);

	return `<li><strong>${sourceGenreNameA} ↔ ${sourceGenreNameB}</strong>: ${placed.length} gemeinsame Top-Genres</li>`;
}

function withScaledRadius(items, minRadius = 4, maxRadius = 14) {
	if (!items.length) {
		return [];
	}

	const scalingType = getRadiusScalingType();

	// "equal" mode: all items same size
	if (scalingType === "equal") {
		const fixed = (minRadius + maxRadius) / 2;
		return items.map((item) => ({ ...item, radius: fixed }));
	}

	// determine which property to scale by
	let property;
	switch (scalingType) {
		case "entity_share":
			property = "entity_share";
			break;
		case "tag_share":
			property = "tag_share";
			break;
		case "connections":
			property = "connections";
			break;
		case "count":
		default:
			property = "count";
	}

	// get min/max for the chosen property
	let values;
	if (property === 'connections') {
		// compute connection strength per item (sum of entity_share of its cooccurrences)
		values = items.map((item) => {
			if (item && Array.isArray(item._cooccurrences) && item._cooccurrences.length) {
				// limit to topN where possible
				const settings = getBridgeSettings();
				const topN = Math.max(1, Number(settings.topN || item._cooccurrences.length));
				return item._cooccurrences.slice(0, topN).reduce((s, r) => s + (Number(r.entity_share) || 0), 0);
			}
			// fallback to entity_share or count
			if (item && item._metrics && typeof item._metrics.entity_share !== 'undefined') return item._metrics.entity_share;
			if (typeof item.entity_share !== 'undefined') return item.entity_share;
			return Number(item.count || 0) / 100; // scale-count fallback
		});
	} else {
		values = items.map((item) => {
			// support items that store original metrics under _metrics
			if (item && item._metrics && typeof item._metrics[property] !== 'undefined') return item._metrics[property];
			return item[property];
		});
	}
	const minVal = Math.min(...values);
	const maxVal = Math.max(...values);

	if (minVal === maxVal) {
		const fixed = (minRadius + maxRadius) / 2;
		return items.map((item) => ({ ...item, radius: fixed }));
	}

	// scale linearly
	return items.map((item) => {
		let val;
		if (property === 'connections') {
			if (item && Array.isArray(item._cooccurrences) && item._cooccurrences.length) {
				const settings = getBridgeSettings();
				const topN = Math.max(1, Number(settings.topN || item._cooccurrences.length));
				val = item._cooccurrences.slice(0, topN).reduce((s, r) => s + (Number(r.entity_share) || 0), 0);
			} else if (item && item._metrics && typeof item._metrics.entity_share !== 'undefined') {
				val = item._metrics.entity_share;
			} else if (typeof item.entity_share !== 'undefined') {
				val = item.entity_share;
			} else {
				val = Number(item.count || 0) / 100;
			}
		} else {
			val = (item && item._metrics && typeof item._metrics[property] !== 'undefined') ? item._metrics[property] : item[property];
		}
		const t = (val - minVal) / (maxVal - minVal);
		return {
			...item,
			radius: minRadius + t * (maxRadius - minRadius),
		};
	});
}

export async function updateCooccurrenceBridges({ forceRefresh = false } = {}) {
	if (!bridgeLayer) {
		return;
	}

	const settings = getBridgeSettings();
	const activeSuperGenres = getActiveSuperGenres();
	const activeKey = activeSuperGenres.map((superGenre) => superGenre.id).sort((a, b) => a - b).join(",");
	const settingsKey = getSettingsKey(settings);
	const shouldResetGroups = forceRefresh || settingsKey !== lastSettingsKey;

	if (!forceRefresh && activeKey === lastActiveKey && settingsKey === lastSettingsKey) {
		return;
	}

	lastActiveKey = activeKey;
	lastSettingsKey = settingsKey;
	const runToken = ++pendingRunToken;
	if (shouldResetGroups) {
		bridgeLayer.replaceChildren();
	}
	if (connectionLinesLayer) {
		connectionLinesLayer.replaceChildren();
	}
	if (curvedLabelLayer) {
		curvedLabelLayer.replaceChildren();
	}
	curvedCharNodes = [];
	activeCurvedDot = null;

	if (forceRefresh) {
		await preloadAllSuperGenres(settings, { forceRefresh: true });
	}

	const dataset = getCachedDatasetForSettings(settingsKey);
	if (!dataset || dataset.size === 0) {
		void preloadAllSuperGenres(settings);
		updateDebugOutput('<p class="muted">Vorab-Laden läuft im Hintergrund. Anzeige nutzt nur vorab geladene Daten.</p>');
		return;
	}

	if (!activeSuperGenres.length) {
		updateDebugOutput('<p class="muted">Kein aktives Ring-Super-Genre. Aktiviere ein Super-Genre durch Eintritt in den Ring.</p>');
		return;
	}

	const dots = getUsers();
	const outputChunks = [];

	for (const superGenre of activeSuperGenres) {
		const sourceGenreName = getPrimaryGenreName(superGenre.id);
		if (!sourceGenreName) {
			continue;
		}

		try {
			if (runToken !== pendingRunToken) return;
			const chunk = await renderGroupForGenre(dataset, superGenre, settings, dots, runToken);
			outputChunks.push(chunk);
		} catch (error) {
			outputChunks.push(`<li><strong>${sourceGenreName}</strong>: Fehler (${String(error?.message || error)})</li>`);
		}
	}

	// Render intersection/bridge genres for all pairs of active super-genres
	const activeSuperGenreIds = activeSuperGenres.map((sg) => sg.id);
	for (let i = 0; i < activeSuperGenreIds.length; i++) {
		for (let j = i + 1; j < activeSuperGenreIds.length; j++) {
			if (runToken !== pendingRunToken) return;

			const superGenreA = activeSuperGenres[i];
			const superGenreB = activeSuperGenres[j];

			try {
				const chunk = await renderIntersectionGroupForGenres(superGenreA, superGenreB, settings, dots, runToken);
				outputChunks.push(chunk);
			} catch (error) {
				const nameA = getPrimaryGenreName(superGenreA.id);
				const nameB = getPrimaryGenreName(superGenreB.id);
				outputChunks.push(`<li><strong>${nameA} ↔ ${nameB}</strong>: Fehler (${String(error?.message || error)})</li>`);
			}
		}
	}

	const allItems = getDisplayedItems();
	bridgeLayer.__animatedItems = allItems;
	computeAndStartAnimation(allItems, activeSuperGenres, settings);

	if (!outputChunks.length) {
		updateDebugOutput('<p class="muted">Keine Brücken-Dots mit den aktuellen Einstellungen gefunden.</p>');
		return;
	}

	updateDebugOutput(`<ul>${outputChunks.join("")}</ul>`);
}

// update radii of all displayed items without changing positions (only updates visual size)
function updateAllRadii() {
	if (!bridgeLayer) return;

	const groups = bridgeLayer.querySelectorAll('.supergenre-group, .intersection-group');
	groups.forEach((group) => {
		const items = group.__items || [];
		if (!items.length) return;

		// recalculate radii based on current scaling settings
		const scaled = withScaledRadius(items);

		// update each item and its SVG circle
		scaled.forEach((newItem, idx) => {
			const oldItem = items[idx];
			if (!oldItem) return;

			const newRadius = newItem.radius;
			oldItem.radius = newRadius;

			// update circle radius in DOM
			if (oldItem._el && oldItem._el.circle) {
				oldItem._el.circle.setAttribute('r', String(newRadius));
			}

			// update text position (label should move with radius change)
			if (oldItem._el && oldItem._el.text) {
				const currentX = oldItem.current?.x ?? oldItem.position?.x ?? 0;
				const currentY = oldItem.current?.y ?? oldItem.position?.y ?? 0;
				oldItem._el.text.setAttribute('x', String(currentX + newRadius + 3));
				oldItem._el.text.setAttribute('y', String(currentY + 4));
			}
		});
	});
}

/**
 * Called when a super-genre is deactivated.
 * Removes all groups and dots related to this genre (both direct and intersection).
 */
export function onSuperGenreDeactivated(deactivatedSuperGenreId) {
	if (!bridgeLayer) return;

	// Remove direct group for this genre
	const directGroup = bridgeLayer.querySelector(
		`.supergenre-group[data-supergenre-id="${deactivatedSuperGenreId}"]`
	);
	if (directGroup && directGroup.parentNode) {
		directGroup.parentNode.removeChild(directGroup);
	}

	// Remove all intersection groups that involve this genre
	const intersectionGroups = Array.from(bridgeLayer.querySelectorAll('.intersection-group'));
	intersectionGroups.forEach((group) => {
		const genreA = Number(group.getAttribute('data-supergenre-a'));
		const genreB = Number(group.getAttribute('data-supergenre-b'));

		if (genreA === deactivatedSuperGenreId || genreB === deactivatedSuperGenreId) {
			if (group.parentNode) {
				group.parentNode.removeChild(group);
			}
		}
	});
}

export function setupCooccurrenceBridges(layer) {
	bridgeLayer = layer;
	genreDotLabelVisibilityMode = loadLabelVisibilityMode();

	const parent = layer.parentNode;
	if (parent) {
		if (connectionLinesLayer && connectionLinesLayer.parentNode) {
			connectionLinesLayer.parentNode.removeChild(connectionLinesLayer);
		}
		connectionLinesLayer = createSvgElement("g");
		connectionLinesLayer.setAttribute("class", "cooccurrence-connection-lines");
		parent.insertBefore(connectionLinesLayer, layer);

		if (curvedLabelLayer && curvedLabelLayer.parentNode) {
			curvedLabelLayer.parentNode.removeChild(curvedLabelLayer);
		}
		curvedLabelLayer = createSvgElement("g");
		curvedLabelLayer.setAttribute("class", "curved-label-layer");
		curvedLabelLayer.style.pointerEvents = "none";
		parent.appendChild(curvedLabelLayer);
	}

	const runButton = getDebugNode("debug-run");
	if (runButton) {
		runButton.addEventListener("click", () => {
			void updateCooccurrenceBridges({ forceRefresh: true });
		});
	}

	const settingIds = ["debug-entity", "debug-max", "debug-topn"];

	// initialize MB debug controls from saved settings
	const mbSaved = loadMbSettings();
	const entNode = getDebugNode("debug-entity");
	const maxNode = getDebugNode("debug-max");
	const topNode = getDebugNode("debug-topn");
	if (entNode) entNode.value = mbSaved.entityType || entNode.value;
	if (maxNode) maxNode.value = String(mbSaved.maxEntities ?? maxNode.value);
	if (topNode) topNode.value = String(mbSaved.topN ?? topNode.value);

	settingIds.forEach((id) => {
		const node = getDebugNode(id);
		if (!node) {
			return;
		}

		node.addEventListener("change", () => {
			// persist MB debug settings
			const settings = getBridgeSettings();
			saveMbSettings({ entityType: settings.entityType, maxEntities: settings.maxEntities, topN: settings.topN });

			void preloadAllSuperGenres(settings).then(() => {
				void updateCooccurrenceBridges();
			});
		});
	});

	// Map Display Settings: radius scaling and collision gap
	const mapGenerationIterations = getDebugNode("map-generation-iterations");
	const mapRadiusScaling = getDebugNode("map-radius-scaling");
	const mapCollisionGap = getDebugNode("map-collision-gap");

	// initialize controls from saved settings
	const mapSettings = loadMapSettings();
	if (mapGenerationIterations) mapGenerationIterations.value = String(mapSettings.generationIterations ?? mapGenerationIterations.value);
	if (mapRadiusScaling) mapRadiusScaling.value = mapSettings.radiusScaling || mapRadiusScaling.value;
	if (mapCollisionGap) mapCollisionGap.value = String(mapSettings.collisionGap ?? mapCollisionGap.value);

	if (mapGenerationIterations) {
		mapGenerationIterations.addEventListener("change", () => {
			saveMapSettings({
				collisionGap: Number(mapCollisionGap?.value || 65),
				radiusScaling: mapRadiusScaling?.value,
				generationIterations: Number(mapGenerationIterations.value || 1),
			});
		});
	}

	if (mapRadiusScaling) {
		mapRadiusScaling.addEventListener("change", () => {
			// persist and update radii only
			saveMapSettings({
				collisionGap: Number(mapCollisionGap?.value || 65),
				radiusScaling: mapRadiusScaling.value,
				generationIterations: Number(mapGenerationIterations?.value || 1),
			});
			updateAllRadii();
		});
	}

	if (mapCollisionGap) {
		mapCollisionGap.addEventListener("change", () => {
			// persist collision gap; animation loop reads value dynamically
			saveMapSettings({
				collisionGap: Number(mapCollisionGap.value || 65),
				radiusScaling: mapRadiusScaling?.value,
				generationIterations: Number(mapGenerationIterations?.value || 1),
			});
		});
	}

	const mapLabelVisibility = getDebugNode("map-genre-dot-label-visibility");
	if (mapLabelVisibility) {
		mapLabelVisibility.value = genreDotLabelVisibilityMode;
		mapLabelVisibility.addEventListener("change", () => {
			genreDotLabelVisibilityMode = mapLabelVisibility.value === "all" ? "all" : "selected";
			saveLabelVisibilityMode(genreDotLabelVisibilityMode);
			updateGenreDotLabelVisibility();
		});
	}

	updateGenreDotLabelVisibility();

    

	const initialSettings = getBridgeSettings();
	void preloadAllSuperGenres(initialSettings).then(() => {
		void updateCooccurrenceBridges();
	});
}

// ----------------------- animation helpers -----------------------
let animating = false;
let recomputeTimeoutId = null;
let lastRecomputeTime = 0;
let animationFrameCount = 0;
const MAX_ANIMATION_FRAMES = 540;

function computeAndStartAnimation(placedItems, activeGenres, settings) {
	placedItems.forEach((item) => {
		if (!item.current) {
			item.current = { x: item.position.x, y: item.position.y };
		}
		if (!item.velocity) {
			item.velocity = { x: 0, y: 0 };
		}
	});

	void loadCooccurrencesForGenreDots(placedItems, settings).then(() => {
		// Restart animation after co-occurrence data loads so attraction forces take effect
		animationFrameCount = Math.min(animationFrameCount, Math.floor(MAX_ANIMATION_FRAMES * 0.3));
		if (!animating) {
			animating = true;
			requestAnimationFrame(stepAnimation);
		}
	});

	if (!animating) {
		animating = true;
		animationFrameCount = 0;
		requestAnimationFrame(stepAnimation);
	}
}

async function loadCooccurrencesForGenreDots(placedItems, settings) {
	const movable = placedItems.filter((item) => !isSuperGenreDot(item));
	for (const item of movable) {
		if (item._cooccurrenceMap) {
			continue;
		}
		const normalized = String(item.name || "").trim().toLowerCase();
		if (!normalized) {
			item._cooccurrenceMap = new Map();
			continue;
		}

		const out = await getOrLoadCooccurrenceDataset(normalized, settings);
		const results = Array.isArray(out?.results) ? out.results : [];
		item._cooccurrences = results;
		item._cooccurrenceMap = new Map(
			results.map((entry) => [String(entry?.name || "").trim().toLowerCase(), entry])
		);
	}
}

function getSuperGenreAnchorPoint(superGenreId) {
	const angle = getAnchorAngle(superGenreId, ringLabels.length);
	return polarToCartesian(RING_CENTER.x, RING_CENTER.y, RING_RADIUS - 40, angle);
}

function computeTargetForItem(item, sgInfos) {
	if (!sgInfos.length) return { x: RING_CENTER.x, y: RING_CENTER.y };

	let sumX = 0;
	let sumY = 0;
	let sumW = 0;
	sgInfos.forEach((sg) => {
		let w = 0;
		if (item._groupId === sg.id) {
			w = Number(item._metrics?.entity_share) || Number(item.entity_share) || 0;
		} else if (item._cooccurrenceMap) {
			const rel = item._cooccurrenceMap.get(sg.name);
			w = Number(rel?.entity_share) || 0;
		}
		sumW += w;
		const angleRad = (sg.angle * Math.PI) / 180;
		sumX += w * Math.cos(angleRad);
		sumY += w * Math.sin(angleRad);
	});

	if (sumW < 0.001) return { x: RING_CENTER.x, y: RING_CENTER.y };

	const dirMag = Math.hypot(sumX, sumY);
	const dirX = dirMag > 0 ? sumX / dirMag : 0;
	const dirY = dirMag > 0 ? sumY / dirMag : 0;
	const meanW = sumW / sgInfos.length;

	const TARGET_MIN_R = 110;
	const TARGET_MAX_R = LABEL_RADIUS_INNER - 110;
	// Linear scaling: distance directly proportional to co-occurrence strength
	// Math.sqrt helps spread the lower weights out more evenly
	const scaled = Math.min(1, Math.sqrt(meanW * 3));
	const radius = TARGET_MIN_R + scaled * (TARGET_MAX_R - TARGET_MIN_R);

	return {
		x: RING_CENTER.x + dirX * radius,
		y: RING_CENTER.y + dirY * radius,
	};
}

function calculateNetworkForces(placedItems) {
	const damping = 0.82;
	const maxSpeed = 8;
	const repulsionStrength = 350;
	const targetSpringK = 0.03;
	const attractionStrength = 1.5;
	const sameGroupAttraction = 2.0;
	const SIZE_THRESHOLD = 9; // midpoint of minRadius(4) and maxRadius(14)
	const smallSmallAttraction = 0.8; // gentle pull between small nodes
	const smallLargeRepulsion = 4.0; // push between small and large nodes

	const activeSuperGenres = getActiveSuperGenres();
	const sgInfos = activeSuperGenres
		.map((sg) => {
			const name = getPrimaryGenreName(sg.id);
			if (!name) return null;
			const angle = getAnchorAngle(sg.id, ringLabels.length);
			return { id: sg.id, name, angle };
		})
		.filter(Boolean);

	const movable = placedItems.filter((item) => !isSuperGenreDot(item));

	movable.forEach((item) => {
		if (!item.velocity) item.velocity = { x: 0, y: 0 };
		item.velocity.x *= damping;
		item.velocity.y *= damping;

		const target = computeTargetForItem(item, sgInfos);
		item._target = target;
		item.velocity.x += (target.x - item.current.x) * targetSpringK;
		item.velocity.y += (target.y - item.current.y) * targetSpringK;
	});

	for (let i = 0; i < movable.length; i++) {
		for (let j = i + 1; j < movable.length; j++) {
			const a = movable[i];
			const b = movable[j];
			const dx = b.current.x - a.current.x;
			const dy = b.current.y - a.current.y;
			const dist = Math.hypot(dx, dy) || 0.0001;
			const minDist = (a.radius || 8) + (b.radius || 8) + 24;

			// Check mutual co-occurrence strength
			const aToB = a._cooccurrenceMap?.get(String(b.name || "").trim().toLowerCase());
			const bToA = b._cooccurrenceMap?.get(String(a.name || "").trim().toLowerCase());
			const coocStrength = Math.max(Number(aToB?.entity_share || 0), Number(bToA?.entity_share || 0));

			// Reduce repulsion between genres that co-occur (up to 90% reduction)
			const repulsionScale = 1 - clamp(coocStrength * 0.9, 0, 0.9);

			// Same-group bonus: genres from the same Super Genre attract each other (spring-like)
			const sameGroup = a._groupId !== undefined && a._groupId === b._groupId;
			if (sameGroup && dist > minDist) {
				const sgf = sameGroupAttraction * dist * 0.0001;
				a.velocity.x += (dx / dist) * sgf;
				a.velocity.y += (dy / dist) * sgf;
				b.velocity.x -= (dx / dist) * sgf;
				b.velocity.y -= (dy / dist) * sgf;
			}

			if (dist < minDist * 2.5) {
				const force = (repulsionStrength * repulsionScale) / (dist * dist);
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				a.velocity.x -= fx;
				a.velocity.y -= fy;
				b.velocity.x += fx;
				b.velocity.y += fy;
			}

			// Mutual attraction: co-occurring genres pull toward each other
			if (coocStrength > 0.01) {
				const af = coocStrength * attractionStrength;
				const afx = (dx / dist) * af;
				const afy = (dy / dist) * af;
				a.velocity.x += afx;
				a.velocity.y += afy;
				b.velocity.x -= afx;
				b.velocity.y -= afy;
			}

			// Size-dependent forces: small-small attract, small-large repel
			const aSmall = (a.radius || 8) < SIZE_THRESHOLD;
			const bSmall = (b.radius || 8) < SIZE_THRESHOLD;
			if (aSmall && bSmall && dist > minDist && dist < minDist * 5) {
				// Both small: gentle attraction to form clusters
				const ssf = smallSmallAttraction / (dist * 0.5);
				a.velocity.x += (dx / dist) * ssf;
				a.velocity.y += (dy / dist) * ssf;
				b.velocity.x -= (dx / dist) * ssf;
				b.velocity.y -= (dy / dist) * ssf;
			} else if (aSmall !== bSmall && dist < minDist * 4) {
				// One small, one large: extra repulsion to push them apart
				const slr = smallLargeRepulsion / (dist * dist) * 80;
				a.velocity.x -= (dx / dist) * slr * (aSmall ? 1 : -1);
				a.velocity.y -= (dy / dist) * slr * (aSmall ? 1 : -1);
				b.velocity.x += (dx / dist) * slr * (aSmall ? 1 : -1);
				b.velocity.y += (dy / dist) * slr * (aSmall ? 1 : -1);
			}
		}
	}

	movable.forEach((item) => {
		const speed = Math.hypot(item.velocity.x, item.velocity.y);
		if (speed > maxSpeed) {
			item.velocity.x = (item.velocity.x / speed) * maxSpeed;
			item.velocity.y = (item.velocity.y / speed) * maxSpeed;
		}
	});
}

function renderConnectionLines(placedItems, activeGenres) {
	if (!connectionLinesLayer) {
		return;
	}

	connectionLinesLayer.replaceChildren();
	const movable = placedItems.filter((item) => !isSuperGenreDot(item));

	for (let i = 0; i < movable.length; i++) {
		for (let j = i + 1; j < movable.length; j++) {
			const a = movable[i];
			const b = movable[j];
			const aToB = a._cooccurrenceMap?.get(String(b.name || "").trim().toLowerCase());
			const bToA = b._cooccurrenceMap?.get(String(a.name || "").trim().toLowerCase());
			const strength = clamp(
				Math.max(Number(aToB?.entity_share || 0), Number(bToA?.entity_share || 0)),
				0,
				1
			);
			if (strength <= 0) {
				continue;
			}

			const line = createSvgElement("line");
			line.setAttribute("x1", String(a.current.x));
			line.setAttribute("y1", String(a.current.y));
			line.setAttribute("x2", String(b.current.x));
			line.setAttribute("y2", String(b.current.y));
			line.setAttribute("stroke", "#aaa");
			line.setAttribute("stroke-width", String(0.3 + strength * 0.9));
			line.setAttribute("opacity", String(0.04 + strength * 0.1));
			connectionLinesLayer.appendChild(line);
		}
	}
}

function updateVisualPositions(items) {
	items.forEach((item) => {
		if (item._el && item._el.circle) {
			item._el.circle.setAttribute('cx', String(item.current.x));
			item._el.circle.setAttribute('cy', String(item.current.y));
		}
		if (item._el && item._el.text) {
			item._el.text.setAttribute('x', String(item.current.x + item.radius + 3));
			item._el.text.setAttribute('y', String(item.current.y + 4));
		}
	});
}

function getDisplayedItems() {
	if (!bridgeLayer) return [];
	const groups = bridgeLayer.querySelectorAll('.supergenre-group, .intersection-group');
	const all = [];
	groups.forEach((g) => {
		const items = g.__items || [];
		items.forEach((it) => all.push(it));
	});
	return all;
}

export async function showGenresForSuperGenre(superGenreId) {
	if (!bridgeLayer) return;
	const settings = getBridgeSettings();
	const sourceGenreName = getPrimaryGenreName(superGenreId);
	if (!sourceGenreName) return;

	// avoid duplicate group
	if (bridgeLayer.querySelector(`.supergenre-group[data-supergenre-id='${superGenreId}']`)) {
		return;
	}

	// Load data on demand: uses localStorage cache or fetches from MusicBrainz API
	const out = await getOrLoadCooccurrenceDataset(sourceGenreName, settings);

	// After async load: verify super-genre is still active and no duplicate appeared
	const superGenre = getSuperGenres().find((g) => g.id === superGenreId);
	if (!superGenre?.active) return;
	if (bridgeLayer.querySelector(`.supergenre-group[data-supergenre-id='${superGenreId}']`)) {
		return;
	}

	if (!out || !Array.isArray(out.results) || out.results.length === 0) {
		updateDebugOutput(`<p class="muted">${sourceGenreName}: keine Daten gefunden.</p>`);
		return;
	}

	const top = out.results.slice(0, settings.topN);
	const scaled = withScaledRadius(
		top.map((item) => ({ ...item, totalSampled: out.totalSampled }))
	);

	const users = getUsers();
	const activeUser = superGenre && superGenre.activeUserId !== null ? users[superGenre.activeUserId] : null;
	const color = activeUser?.color ?? '#ffffff';
	const anchor = getAnchorPosition(superGenreId);
	const placed = scaled.map((item) => ({
		...item,
		position: getRandomPositionInsideRing(),
		radius: item.radius || 8,
	}));

	const group = createSvgElement('g');
	group.setAttribute('class', 'supergenre-group');
	group.setAttribute('data-supergenre-id', String(superGenreId));

	placed.forEach((item) => {
		item._groupId = superGenreId;
		item._metrics = {
			count: item.count,
			entity_share: item.entity_share,
			tag_share: item.tag_share,
		};
		const els = renderGenreDot(group, item, color);
		item._el = els;
	});
	group.__items = placed;
	bridgeLayer.appendChild(group);

	const allItems = getDisplayedItems();
	bridgeLayer.__animatedItems = allItems;
	const activeSuperGenres = getActiveSuperGenres();
	if (activeSuperGenres.length > 0) {
		computeAndStartAnimation(allItems, activeSuperGenres, settings);
	}

	if (settings.generationIterations > 1) {
		const ancestry = new Set([sourceGenreName]);
		for (const item of placed) {
			await renderNestedGeneration(group, item, settings, 2, settings.generationIterations, color, ancestry, runToken);
		}
	}
}

export function hideGenresForSuperGenre(superGenreId) {
	if (!bridgeLayer) return;
	const node = bridgeLayer.querySelector(`.supergenre-group[data-supergenre-id='${superGenreId}']`);
	if (!node) return;
	// remove items from animated list
	const items = node.__items || [];
	const animated = bridgeLayer.__animatedItems || [];
	bridgeLayer.__animatedItems = animated.filter((it) => !items.includes(it));
	node.remove();
	if (connectionLinesLayer) {
		connectionLinesLayer.replaceChildren();
	}

	// recompute targets if there is at least one active super-genre
	const activeSuperGenres = getActiveSuperGenres();
	const settings = getBridgeSettings();
	if (activeSuperGenres.length > 0) {
		const allItems = getDisplayedItems();
		bridgeLayer.__animatedItems = allItems;
		computeAndStartAnimation(allItems, activeSuperGenres, settings);
	}
}

export function recomputeTargetsForAllDisplayed() {
	if (!bridgeLayer) return;
	const activeGenres = getActiveGenres();
	const settings = getBridgeSettings();
	if (activeGenres.length === 0) return;

    // debounce: max 1 recompute every 100ms
    const now = Date.now();
    if (now - lastRecomputeTime < 100) {
        if (recomputeTimeoutId) clearTimeout(recomputeTimeoutId);
        recomputeTimeoutId = setTimeout(() => {
            lastRecomputeTime = Date.now();
            const allItems = getDisplayedItems();
            bridgeLayer.__animatedItems = allItems;
            computeAndStartAnimation(allItems, activeGenres, settings);
        }, 100);
        return;
    }

    lastRecomputeTime = now;
    const allItems = getDisplayedItems();
    bridgeLayer.__animatedItems = allItems;
    computeAndStartAnimation(allItems, activeGenres, settings);
}

/**
 * Update all genre-dot positions based on co-occurrence to active super-genres
 * Called after super-genres change (activate/deactivate)
 */
export function updateGenreDotPositions() {
	if (!bridgeLayer) return;

	const activeSuperGenres = getActiveSuperGenres();
	const settings = getBridgeSettings();
	const allItems = getDisplayedItems();
	bridgeLayer.__animatedItems = allItems;
	if (activeSuperGenres.length > 0) {
		computeAndStartAnimation(allItems, activeSuperGenres, settings);
	}
}

function detectAndResolveCollisions(items) {
	const gap = getCollisionGap();
	// Resolve only a fraction of overlap per frame so the target spring
	// physics is not overpowered by the position-snapping collision push.
	const resolveFactor = 0.35;
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = items[i];
			const b = items[j];
			if (isSuperGenreDot(a) || isSuperGenreDot(b)) {
				continue;
			}
			const dx = b.current.x - a.current.x;
			const dy = b.current.y - a.current.y;
			const dist = Math.hypot(dx, dy);
			const minDist = a.radius + b.radius + gap;
			if (dist < minDist && dist > 0.0001) {
				const overlap = minDist - dist;
				const ux = dx / dist;
				const uy = dy / dist;
				const push = (overlap / 2) * resolveFactor;
				a.current.x -= ux * push;
				a.current.y -= uy * push;
				b.current.x += ux * push;
				b.current.y += uy * push;
			}
		}
	}

	// Keep all genre-dots inside the ring after collision resolution.
	items.forEach((item) => {
		if (isSuperGenreDot(item)) {
			return;
		}
		item.current = clampInsideRing(item.current, item.radius + 6);
	});
}

function stepAnimation() {
	const animated = bridgeLayer.__animatedItems || [];
	if (!animated.length) {
		animating = false;
		if (connectionLinesLayer) {
			connectionLinesLayer.replaceChildren();
		}
		return;
	}

	const activeGenres = getActiveSuperGenres();
	calculateNetworkForces(animated);

	animated.forEach((item) => {
		if (!item.current) {
			item.current = { x: item.position.x, y: item.position.y };
		}
		if (isSuperGenreDot(item)) {
			return;
		}
		if (!item.velocity) {
			item.velocity = { x: 0, y: 0 };
		}

		item.current.x += item.velocity.x;
		item.current.y += item.velocity.y;
	});

	detectAndResolveCollisions(animated);
	animated.forEach((item) => {
		if (isSuperGenreDot(item)) {
			return;
		}
		item.current = clampInsideRing(item.current, item.radius + 6);
	});

	renderConnectionLines(animated, activeGenres);
	updateVisualPositions(animated);

	animationFrameCount++;
	const hasMovable = animated.some((item) => !isSuperGenreDot(item));
	if (hasMovable && activeGenres.length > 0 && animationFrameCount < MAX_ANIMATION_FRAMES) {
		requestAnimationFrame(stepAnimation);
	} else {
		animating = false;
		if (!activeGenres.length && connectionLinesLayer) {
			connectionLinesLayer.replaceChildren();
		}
	}
}
