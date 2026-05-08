import { RING_CENTER, RING_RADIUS } from "../config/constants.js";
import { createSvgElement } from "../core/svg.js";

const RING_INNER_EDGE = RING_RADIUS - 28;
const TEXT_RADIUS = RING_INNER_EDGE - 16;
const LINE_COUNT = 64;
const LINE_OUTER_RADIUS = TEXT_RADIUS - 28;
const LINE_BASE_LENGTH = 60;
const LINE_MAX_LENGTH = 220;
const TEXT_FONT_SIZE = 20;
const CHAR_WIDTH_FACTOR = 0.58;
const SEPARATOR = " · ";
const ROTATION_SPEED = 0.18;
const BPM = 92;
const BEAT_PERIOD = 60 / BPM;
const lineOffsets = Array.from({ length: LINE_COUNT }, () => Math.random() * Math.PI * 2);
const lineFreqs = Array.from({ length: LINE_COUNT }, () => 0.7 + Math.random() * 1.4);

const NEON_COLORS = [
	[57, 255, 20],   // green  #39ff14
	[0, 212, 255],   // blue   #00d4ff
	[250, 255, 0],   // yellow #faff00
	[255, 7, 58],    // red    #ff073a
];
const COLOR_HOLD_SECONDS = 10;

function pseudoRandom(seed) {
	const x = Math.sin(seed * 12.9898) * 43758.5453;
	return x - Math.floor(x);
}

function getCurrentLineColor(t) {
	const total = NEON_COLORS.length * COLOR_HOLD_SECONDS;
	const phase = ((t % total) + total) % total;
	const idx = Math.floor(phase / COLOR_HOLD_SECONDS);
	const local = (phase % COLOR_HOLD_SECONDS) / COLOR_HOLD_SECONDS;
	const a = NEON_COLORS[idx];
	const b = NEON_COLORS[(idx + 1) % NEON_COLORS.length];
	const r = Math.round(a[0] * (1 - local) + b[0] * local);
	const g = Math.round(a[1] * (1 - local) + b[1] * local);
	const bl = Math.round(a[2] * (1 - local) + b[2] * local);
	return `rgb(${r},${g},${bl})`;
}

let rhythmLayer = null;
let charNodes = [];
let lineNodes = [];
let currentGenreName = "";
let active = false;
let rotation = 0;
let startTime = 0;
let rafId = null;

export function setupRhythmMode(svg) {
	if (rhythmLayer) return;
	rhythmLayer = createSvgElement("g");
	rhythmLayer.setAttribute("id", "rhythm-mode");
	rhythmLayer.setAttribute("visibility", "hidden");
	svg.appendChild(rhythmLayer);
}

export function showRhythmMode(genreName) {
	if (!rhythmLayer) return;
	active = true;
	currentGenreName = String(genreName || "").trim();
	rotation = 0;
	startTime = performance.now();
	rebuildContents();
	rhythmLayer.setAttribute("visibility", "visible");
	if (rafId) cancelAnimationFrame(rafId);
	rafId = requestAnimationFrame(animate);
}

export function hideRhythmMode() {
	active = false;
	if (rafId) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
	if (!rhythmLayer) return;
	rhythmLayer.setAttribute("visibility", "hidden");
	rhythmLayer.replaceChildren();
	charNodes = [];
	lineNodes = [];
}

function rebuildContents() {
	if (!rhythmLayer) return;
	rhythmLayer.replaceChildren();
	charNodes = [];
	lineNodes = [];

	if (!currentGenreName) return;

	// Build curved text repeated around the inner ring edge
	const unit = currentGenreName + SEPARATOR;
	const charWidth = TEXT_FONT_SIZE * CHAR_WIDTH_FACTOR;
	const circumference = 2 * Math.PI * TEXT_RADIUS;
	const unitArc = unit.length * charWidth;
	const repetitions = Math.max(1, Math.round(circumference / unitArc));
	const fullText = unit.repeat(repetitions);

	for (const ch of fullText) {
		const node = createSvgElement("text");
		node.setAttribute("class", "rhythm-curved-label");
		node.setAttribute("text-anchor", "middle");
		node.setAttribute("dominant-baseline", "central");
		node.textContent = ch;
		rhythmLayer.appendChild(node);
		charNodes.push(node);
	}

	// Build 64 radial lines pointing inward from inside the ring
	for (let i = 0; i < LINE_COUNT; i++) {
		const line = createSvgElement("line");
		line.setAttribute("class", "rhythm-line");
		line.setAttribute("stroke-linecap", "round");
		rhythmLayer.appendChild(line);
		lineNodes.push(line);
	}
}

function animate() {
	if (!active) return;

	const now = performance.now();
	const t = (now - startTime) / 1000;

	// Rotate the curved label
	rotation = (rotation + ROTATION_SPEED) % 360;
	const rotRad = (rotation * Math.PI) / 180;

	const totalChars = charNodes.length;
	if (totalChars > 0) {
		const stepRad = (Math.PI * 2) / totalChars;
		const startRad = -Math.PI / 2 + rotRad;
		for (let i = 0; i < totalChars; i++) {
			const angleRad = startRad + i * stepRad;
			const x = RING_CENTER.x + TEXT_RADIUS * Math.cos(angleRad);
			const y = RING_CENTER.y + TEXT_RADIUS * Math.sin(angleRad);
			const tangentDeg = (angleRad * 180) / Math.PI + 90;
			const node = charNodes[i];
			node.setAttribute("x", String(x));
			node.setAttribute("y", String(y));
			node.setAttribute("transform", `rotate(${tangentDeg} ${x} ${y})`);
		}
	}

	const beatPhase = (t / BEAT_PERIOD) % 1;
	const beatPulse = Math.pow(1 - beatPhase, 2);
	const beatIndex = Math.floor(t / BEAT_PERIOD);
	const beatStrength = 0.65 + 0.7 * pseudoRandom(beatIndex);

	const lineColor = getCurrentLineColor(t);

	for (let i = 0; i < lineNodes.length; i++) {
		const angleRad = (i / LINE_COUNT) * Math.PI * 2 - Math.PI / 2;
		const noise =
			Math.sin(t * 1.4 + lineOffsets[i]) * 0.32 +
			Math.sin(t * 2.6 * lineFreqs[i] + lineOffsets[i] * 1.3) * 0.22 +
			Math.sin(t * 4.1 + lineOffsets[i] * 0.6) * 0.14;
		const level = beatPulse * beatStrength * 0.55 + (noise + 0.5) * 0.45;
		const length = LINE_BASE_LENGTH + level * LINE_MAX_LENGTH;

		const x1 = RING_CENTER.x + LINE_OUTER_RADIUS * Math.cos(angleRad);
		const y1 = RING_CENTER.y + LINE_OUTER_RADIUS * Math.sin(angleRad);
		const innerR = Math.max(20, LINE_OUTER_RADIUS - length);
		const x2 = RING_CENTER.x + innerR * Math.cos(angleRad);
		const y2 = RING_CENTER.y + innerR * Math.sin(angleRad);

		const line = lineNodes[i];
		line.setAttribute("x1", String(x1));
		line.setAttribute("y1", String(y1));
		line.setAttribute("x2", String(x2));
		line.setAttribute("y2", String(y2));
		line.setAttribute("stroke", lineColor);
	}

	rafId = requestAnimationFrame(animate);
}
