import { RING_CENTER, RING_RADIUS } from "../config/constants.js";
import { createSvgElement } from "../core/svg.js";
import { setTrackChangeListener, getCurrentTrack } from "./audioPlayer.js";

const RING_INNER_EDGE = RING_RADIUS - 28;
const TEXT_RADIUS = RING_INNER_EDGE - 16;
const TEXT_FONT_SIZE = 20;
const CHAR_WIDTH_FACTOR = 0.58;
const SEPARATOR = " · ";
const ROTATION_SPEED = 0.18;

// ── BPM & beat ──
let bpm = 92;
let beatPeriod = 60 / bpm;

export function setRhythmBPM(newBpm) {
	bpm = Math.max(30, Math.min(300, Number(newBpm) || 92));
	beatPeriod = 60 / bpm;
}

export function getRhythmBPM() {
	return bpm;
}

// ── Bubble parameters ──
const BUBBLE_SPAWN_RADIUS = TEXT_RADIUS - 60;       // spawn area outer boundary
const BUBBLE_SPAWN_INNER = 40;                       // spawn area inner boundary
// ── Gradients & Filters ──
function ensureRhythmGradients() {
	const defs = document.getElementById("ring-defs");
	if (!defs) return;
	if (defs.querySelector("#bubble-grad-blue-1")) return;

	// Helper to create radial gradients
	const makeGrad = (id, c1, c2, c3) => {
		const g = createSvgElement("radialGradient");
		g.setAttribute("id", id);
		g.innerHTML = `
			<stop offset="0%" stop-color="${c1}" stop-opacity="0.5" />
			<stop offset="55%" stop-color="${c2}" stop-opacity="0.7" />
			<stop offset="100%" stop-color="${c3}" stop-opacity="1" />
		`;
		defs.appendChild(g);
	};

	// Theme Blue Variants (brighter & more saturated)
	makeGrad("bubble-grad-blue-1", "#22ffff", "#00e0ff", "#00c8ff");
	makeGrad("bubble-grad-blue-2", "#33eeff", "#0099ff", "#0066ff");
	makeGrad("bubble-grad-blue-3", "#99ffff", "#00ccff", "#0055ff");

	// Theme Purple Variants (brighter & more saturated)
	makeGrad("bubble-grad-purple-1", "#e8d0ff", "#a855f7", "#9333ea");
	makeGrad("bubble-grad-purple-2", "#f0e0ff", "#c77dff", "#7c3aed");
	makeGrad("bubble-grad-purple-3", "#e8b8ff", "#a020f0", "#6d28d9");

	// Ambient Glow Gradient (soft center glow)
	const glowGrad = createSvgElement("radialGradient");
	glowGrad.setAttribute("id", "bubble-ambient-glow");
	glowGrad.innerHTML = `
		<stop offset="0%" stop-color="currentColor" stop-opacity="0.15" />
		<stop offset="70%" stop-color="currentColor" stop-opacity="0.05" />
		<stop offset="100%" stop-color="currentColor" stop-opacity="0" />
	`;
	defs.appendChild(glowGrad);

	// Super Blur Filter (slightly reduced for small bubble visibility)
	const filter = createSvgElement("filter");
	filter.setAttribute("id", "bubble-super-blur");
	filter.setAttribute("x", "-50%");
	filter.setAttribute("y", "-50%");
	filter.setAttribute("width", "200%");
	filter.setAttribute("height", "200%");
	filter.innerHTML = `<feGaussianBlur in="SourceGraphic" stdDeviation="20" />`;
	defs.appendChild(filter);
}

// ── State ──
let rhythmLayer = null;
let charNodes = [];
let bubbles = [];           // persistent bubble objects
let bubbleGroup = null;
let currentGenreName = "";
let currentTrackInfo = null;
let active = false;
let rotation = 0;
let startTime = 0;
let rafId = null;
let globalBeatPhase = 0;
let lastAnimTime = 0;

// ── Persistent breathing bubble ──
class Bubble {
	constructor(parentGroup, cx, cy, baseRadius, phaseOffset, breathSpeed, gradientId) {
		this.cx = cx;
		this.cy = cy;
		this.baseRadius = baseRadius;
		this.phaseOffset = phaseOffset;
		this.breathSpeed = breathSpeed;

		this.element = createSvgElement("circle");
		this.element.setAttribute("class", "rhythm-bubble");
		this.element.setAttribute("cx", String(cx));
		this.element.setAttribute("cy", String(cy));
		this.element.setAttribute("r", String(baseRadius));
		this.element.setAttribute("fill", `url(#${gradientId})`);
		this.element.setAttribute("opacity", "0.95");
		parentGroup.appendChild(this.element);
	}

	update(phase, t) {
		// Calculate progress within current beat
		const localPhase = phase % 1.0; 

		// Punch effect: 
		let punch = 0;
		if (localPhase < 0.05) {
			// Extremely rapid contraction
			punch = localPhase / 0.05;
		} else {
			// Super fast elastic expansion
			const p = (localPhase - 0.05) / 0.95;
			punch = Math.exp(-p * 30) * Math.cos(p * Math.PI * 2);
		}

		// The stronger the breathSpeed, the harder it punches
		// Reduced amplitude for faster, subtler tremor
		const punchIntensity = 0.2 * this.breathSpeed; 
		const radiusScale = 1 - (punch * punchIntensity);

		// Faster organic drift
		const organicDrift = Math.sin(t * 1.8 + this.phaseOffset * 10) * 0.15;
		
		const currentRadius = this.baseRadius * (radiusScale + organicDrift);
		
		// Slight jitter during the peak of the punch
		let jitterX = 0;
		let jitterY = 0;
		if (punch > 0.3) {
			jitterX = (Math.random() - 0.5) * 8 * punch;
			jitterY = (Math.random() - 0.5) * 8 * punch;
		}

		this.element.setAttribute("cx", String(this.cx + jitterX));
		this.element.setAttribute("cy", String(this.cy + jitterY));
		this.element.setAttribute("r", String(Math.max(1, currentRadius)));
		
		// Opacity flashes
		const baseOpacity = 0.85;
		const flash = punch * 0.2;
		this.element.setAttribute("opacity", String(Math.max(0.4, Math.min(1, baseOpacity + flash))));
	}

	remove() {
		if (this.element.parentNode) {
			this.element.parentNode.removeChild(this.element);
		}
	}
}

// ── Label helpers ──
function buildLabelText() {
	const parts = [];
	if (currentGenreName) parts.push(currentGenreName);
	if (currentTrackInfo?.name) parts.push(currentTrackInfo.name);
	if (currentTrackInfo?.artist) parts.push(currentTrackInfo.artist);
	return parts.join(" · ");
}

// ── Lifecycle ──
export function setupRhythmMode(svg) {
	if (rhythmLayer) return;
	rhythmLayer = createSvgElement("g");
	rhythmLayer.setAttribute("id", "rhythm-mode");
	rhythmLayer.setAttribute("visibility", "hidden");
	svg.appendChild(rhythmLayer);

	setTrackChangeListener((info) => {
		currentTrackInfo = info;
		if (active) rebuildContents();
	});
	currentTrackInfo = getCurrentTrack();
}

export function showRhythmMode(genreName) {
	if (!rhythmLayer) return;
	active = true;
	currentGenreName = String(genreName || "").trim();
	currentTrackInfo = getCurrentTrack();
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
	bubbles.forEach((b) => b.remove());
	bubbles = [];
	bubbleGroup = null;
}

function rebuildContents() {
	if (!rhythmLayer) return;
	rhythmLayer.replaceChildren();
	charNodes = [];
	bubbles.forEach((b) => b.remove());
	bubbles = [];

	const labelText = buildLabelText();
	if (!labelText) return;

	// Build curved text repeated around the inner ring edge
	const unit = labelText + SEPARATOR;
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

	// Bubbles group
	ensureRhythmGradients();
	bubbleGroup = createSvgElement("g");
	bubbleGroup.setAttribute("class", "rhythm-bubbles-group");
	bubbleGroup.setAttribute("filter", "url(#bubble-super-blur)");
	rhythmLayer.appendChild(bubbleGroup);

	// Create persistent bubbles evenly distributed across angles
	// 3 large, 4 medium, 7 small (14 total)
	const tiers = [
		...Array(3).fill({ type: 'large', min: 100, max: 130 }), 
		...Array(4).fill({ type: 'medium', min: 40, max: 60 }), 
		...Array(7).fill({ type: 'small', min: 18, max: 30 })   
	];

	// Pick ONE primary color theme (blue or purple only)
	const themeRoll = Math.random();
	let themePrefix = "bubble-grad-blue";
	let ambientColor = "#00ccff";
	if (themeRoll > 0.5) {
		themePrefix = "bubble-grad-purple";
		ambientColor = "#a855f7";
	}

	// Add ambient glow layer behind everything (uses radial gradient for natural falloff)
	const ambientGlow = createSvgElement("circle");
	ambientGlow.setAttribute("cx", String(RING_CENTER.x));
	ambientGlow.setAttribute("cy", String(RING_CENTER.y));
	ambientGlow.setAttribute("r", String(BUBBLE_SPAWN_RADIUS * 1.1));
	ambientGlow.setAttribute("fill", `url(#bubble-ambient-glow)`);
	ambientGlow.style.color = ambientColor;
	ambientGlow.setAttribute("opacity", "1");
	bubbleGroup.appendChild(ambientGlow);

	let largeCount = 0;
	let othersCount = 0;
	const totalOthers = 11; // 4 medium + 7 small
	const largeBaseOffset = Math.random() * Math.PI * 2; // Fixed rotation for the triangle of large bubbles

	for (let i = 0; i < tiers.length; i++) {
		const tier = tiers[i];
		let angle;

		if (tier.type === 'large') {
			// Lock large bubbles to be exactly 120 degrees apart
			angle = largeBaseOffset + (largeCount * (Math.PI * 2) / 3);
			largeCount++;
		} else {
			// Distribute others evenly in the remaining space with slight jitter
			const angleSlice = (Math.PI * 2) / totalOthers;
			angle = (othersCount * angleSlice) + ((Math.random() - 0.5) * angleSlice * 0.8);
			othersCount++;
		}

		// Force a wider spread on radius
		// Large bubbles: force them to different radial bands (inner/mid/outer)
		let r;
		if (tier.type === 'large') {
			// Each large bubble gets its own radial band
			const bandIndex = largeCount - 1; // 0, 1, 2
			const totalBands = 3;
			const bandSize = (BUBBLE_SPAWN_RADIUS - BUBBLE_SPAWN_INNER) / totalBands;
			r = BUBBLE_SPAWN_INNER + bandIndex * bandSize + Math.random() * bandSize;
		} else {
			const isOuter = i % 2 === 0;
			const rSpan = (BUBBLE_SPAWN_RADIUS - BUBBLE_SPAWN_INNER) / 2;
			const rBase = isOuter ? (BUBBLE_SPAWN_INNER + rSpan) : BUBBLE_SPAWN_INNER;
			r = rBase + Math.random() * rSpan;
		}

		const cx = RING_CENTER.x + Math.cos(angle) * r;
		const cy = RING_CENTER.y + Math.sin(angle) * r;

		const baseRadius = tier.min + Math.random() * (tier.max - tier.min);

		const phaseOffset = Math.random(); 
		const breathSpeed = 0.8 + Math.random() * 0.5; // faster baseline
		
		// Randomly pick one of the 3 gradient variants for this theme
		const variant = Math.floor(Math.random() * 3) + 1;
		const gradientId = `${themePrefix}-${variant}`;

		const bubble = new Bubble(bubbleGroup, cx, cy, baseRadius, phaseOffset, breathSpeed, gradientId);
		bubbles.push(bubble);
	}
}

// ── Animation loop ──
function animate(ts) {
	if (!active) return;

	const now = ts || performance.now();
	const t = (now - startTime) / 1000;
	const dt = lastAnimTime > 0 ? Math.min(0.05, (now - lastAnimTime) / 1000) : 0.016;
	lastAnimTime = now;

	globalBeatPhase += dt / beatPeriod;

	// ── Rotate curved label ──
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

	// ── Physics Repulsion for Bubbles ──
	for (let i = 0; i < bubbles.length; i++) {
		for (let j = i + 1; j < bubbles.length; j++) {
			const b1 = bubbles[i];
			const b2 = bubbles[j];
			const dx = b2.cx - b1.cx;
			const dy = b2.cy - b1.cy;
			const dist = Math.sqrt(dx * dx + dy * dy);
			// Use full radius sum as minimum distance (no overlap allowed)
			const minDist = (b1.baseRadius + b2.baseRadius) * 1.0;
			
			if (dist > 0 && dist < minDist) {
				const force = (minDist - dist) * 0.15; 
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				
				// Push inversely proportional to size area
				const area1 = b1.baseRadius * b1.baseRadius;
				const area2 = b2.baseRadius * b2.baseRadius;
				const totalArea = area1 + area2;
				const mass1 = area1 / totalArea;
				const mass2 = area2 / totalArea;

				b1.cx -= fx * mass2;
				b1.cy -= fy * mass2;
				b2.cx += fx * mass1;
				b2.cy += fy * mass1;
			}
		}
	}

	// ── Update all breathing bubbles with Boundary Force ──
	bubbles.forEach((b) => {
		const dx = b.cx - RING_CENTER.x;
		const dy = b.cy - RING_CENTER.y;
		const dist = Math.sqrt(dx * dx + dy * dy);
		
		// Prevent the bubble's visual edge from reaching the text ring
		const outerLimit = TEXT_RADIUS - 30; // slightly relaxed
		let maxDist = outerLimit - b.baseRadius;
		
		// Prevent impossible boundary conditions (oscillation to NaN)
		if (maxDist < BUBBLE_SPAWN_INNER + 10) {
			maxDist = BUBBLE_SPAWN_INNER + 10;
		}

		if (dist > maxDist) {
			const force = (dist - maxDist) * 0.15; // stronger pushback
			b.cx -= (dx / dist) * force;
			b.cy -= (dy / dist) * force;
		} else if (dist < BUBBLE_SPAWN_INNER && dist > 0) {
			const force = (BUBBLE_SPAWN_INNER - dist) * 0.05;
			b.cx += (dx / dist) * force;
			b.cy += (dy / dist) * force;
		}

		b.update(globalBeatPhase, t);
	});

	rafId = requestAnimationFrame(animate);
}
