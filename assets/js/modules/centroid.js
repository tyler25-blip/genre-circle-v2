import { createSvgElement } from "../core/svg.js";
import { getUsers } from "../core/state.js";
import { USER_DOT_RADIUS, RING_CENTER, LABEL_RADIUS_SINGLE } from "../config/constants.js";
import { updateGenreDotLabelVisibility } from "./cooccurrence-bridges.js";

let centroidGroup = null;
let linesGroup = null;
let centroidNode = null;

// animated display state
let centroidState = {
	cx: 0,
	cy: 0,
	vx: 0,
	vy: 0,
	visible: false,
};

const userConnectionLines = new Map(); // userId -> { lineNode, x2,y2,vx,vy }

let rafId = null;
let currentActiveUserId = null;

// nearest-genre-dot connection (to genre-dots/cooccurrence items)
let centroidToGenreDotLine = null;
let currentActivatedGenreDot = null; // { el, originalFill }
const centroidSettings = { lineColor: "#ffffff", lineWidth: 2.5 };

let genreChangeListener = null;
let lastReportedGenreName = null;

export function setGenreChangeListener(fn) {
	genreChangeListener = typeof fn === "function" ? fn : null;
}

function notifyGenreChange(name) {
	const next = name || null;
	if (next === lastReportedGenreName) return;
	lastReportedGenreName = next;
	if (genreChangeListener) {
		try { genreChangeListener(next); } catch (e) { console.warn("genreChangeListener error:", e); }
	}
}

// tuning parameters for organic / springy behaviour
const centroidStiffness = 0.015; // how strongly centroid is pulled to target
const centroidDamping = 0.86;
const lineStiffness = 0.045; // lines act like stretchy cords toward user target
const lineDamping = 0.78;

let targetCentroid = { x: 0, y: 0 };

let lastFrameTime = 0;

export function setupCentroid(svg, group) {
	centroidGroup = group;
	if (!centroidGroup) return;
	centroidGroup.replaceChildren();

	linesGroup = createSvgElement("g");
	linesGroup.setAttribute("class", "centroid-lines");
	centroidGroup.appendChild(linesGroup);

	centroidNode = createSvgElement("circle");
	centroidNode.setAttribute("class", "centroid-dot");
	centroidNode.setAttribute("r", String(Math.max(4, USER_DOT_RADIUS - 2)));
	centroidNode.style.display = "none";
	centroidGroup.appendChild(centroidNode);

	// line from centroid to nearest genre-dot
	// styled by centroid settings
	centroidToGenreDotLine = createSvgElement("line");
	centroidToGenreDotLine.setAttribute("class", "centroid-to-genre-dot-line");
	centroidToGenreDotLine.setAttribute("stroke-linecap", "round");
	centroidToGenreDotLine.style.display = "none";
	centroidGroup.appendChild(centroidToGenreDotLine);

	// apply fixed centroid settings
	if (centroidToGenreDotLine) {
		centroidToGenreDotLine.setAttribute("stroke", centroidSettings.lineColor);
		centroidToGenreDotLine.setAttribute("stroke-width", String(centroidSettings.lineWidth));
	}

	// start animation loop
	if (!rafId) {
		lastFrameTime = performance.now();
		rafId = requestAnimationFrame(loop);
	}
}

function ensureLineToUser(user) {
	const id = user.id;
	if (userConnectionLines.has(id)) return userConnectionLines.get(id);

	const line = createSvgElement("line");
	line.setAttribute("class", "centroid-to-user-line");
	line.setAttribute("stroke-linecap", "round");
	// fixed style: all user to centroid lines are white 1px
	line.setAttribute("stroke", "#ffffff");
	line.setAttribute("stroke-width", "1");
	linesGroup.appendChild(line);

	const state = { lineNode: line, x2: user.x, y2: user.y, vx: 0, vy: 0 };
	userConnectionLines.set(id, state);
	return state;
}

export function notifyCentroidTargets(activeUserId = null) {
	currentActiveUserId = typeof activeUserId === 'number' ? activeUserId : null;
	// compute target centroid from users currently in genre ring
	const users = getUsers().filter((u) => Boolean(u.inGenreRing));
	const wasVisible = centroidState.visible;
	if (!users.length) {
		targetCentroid = { x: 0, y: 0 };
		centroidState.visible = false;
		// remove all lines
		userConnectionLines.clear();
		if (linesGroup) linesGroup.replaceChildren();
		if (centroidNode) centroidNode.style.display = "none";
		return;
	}

	const cx = users.reduce((s, u) => s + u.x, 0) / users.length;
	const cy = users.reduce((s, u) => s + u.y, 0) / users.length;
	targetCentroid = { x: cx, y: cy };
	centroidState.visible = true;

	// On first entry: spawn centroid immediately at center
	if (!wasVisible) {
		centroidState.cx = cx;
		centroidState.cy = cy;
		centroidState.vx = 0;
		centroidState.vy = 0;
	}

	// ensure line entries for each user
	const keepIds = new Set();
	users.forEach((u) => {
		ensureLineToUser(u);
		keepIds.add(u.id);
	});

	// remove lines for users that left
	for (const id of Array.from(userConnectionLines.keys())) {
		if (!keepIds.has(id)) {
			const st = userConnectionLines.get(id);
			if (st && st.lineNode && linesGroup) linesGroup.removeChild(st.lineNode);
			userConnectionLines.delete(id);
		}
	}
}

function loop(ts) {
	const now = ts || performance.now();
	const dt = Math.min(48, now - lastFrameTime) || 16; // ms, clamp to avoid jumps
	const s = dt / 1000; // seconds

	// Smooth / spring centroid toward target
	const dx = targetCentroid.x - centroidState.cx;
	const dy = targetCentroid.y - centroidState.cy;
	centroidState.vx = centroidState.vx * centroidDamping + dx * centroidStiffness * dt;
	centroidState.vy = centroidState.vy * centroidDamping + dy * centroidStiffness * dt;
	centroidState.cx += centroidState.vx * s;
	centroidState.cy += centroidState.vy * s;

	// Update centroid node
	if (centroidState.visible && centroidNode) {
		centroidNode.style.display = "";
		centroidNode.setAttribute("cx", String(centroidState.cx));
		centroidNode.setAttribute("cy", String(centroidState.cy));
	} else if (centroidNode) {
		centroidNode.style.display = "none";
	}

	// Find and connect to nearest genre-dot
	if (centroidState.visible) {
		const genreDots = Array.from(document.querySelectorAll('.genre-dot'));
		let nearestGenreDot = null;
		let minDist = Infinity;

		for (const dotEl of genreDots) {
			const dotX = Number(dotEl.getAttribute('cx')) || 0;
			const dotY = Number(dotEl.getAttribute('cy')) || 0;
			const dist = Math.hypot(dotX - centroidState.cx, dotY - centroidState.cy);

			if (dist < minDist) {
				minDist = dist;
				nearestGenreDot = { el: dotEl, x: dotX, y: dotY };
			}
		}

		if (nearestGenreDot) {
			centroidToGenreDotLine.style.display = "";
			centroidToGenreDotLine.setAttribute('x1', String(centroidState.cx));
			centroidToGenreDotLine.setAttribute('y1', String(centroidState.cy));
			centroidToGenreDotLine.setAttribute('x2', String(nearestGenreDot.x));
			centroidToGenreDotLine.setAttribute('y2', String(nearestGenreDot.y));
			centroidToGenreDotLine.setAttribute("stroke", centroidSettings.lineColor);
			centroidToGenreDotLine.setAttribute("stroke-width", String(centroidSettings.lineWidth));

			// Highlight the connected dot by using its stroke color as fill
			if (currentActivatedGenreDot?.el !== nearestGenreDot.el) {
				_restoreGenreDotFill();
				const strokeColor = nearestGenreDot.el.getAttribute('stroke') || '#ffffff';
				const originalFill = nearestGenreDot.el.getAttribute('fill') || '';
				const originalRadius = Number(nearestGenreDot.el.getAttribute('r')) || 8;
				currentActivatedGenreDot = { el: nearestGenreDot.el, originalFill, originalRadius };
				nearestGenreDot.el.setAttribute('fill', strokeColor);
				nearestGenreDot.el.style.fill = strokeColor;
				// increase radius by 15px temporarily
				nearestGenreDot.el.setAttribute('r', String(originalRadius + 15));
			}
			notifyGenreChange(nearestGenreDot.el.__curvedText || null);
			updateGenreDotLabelVisibility(nearestGenreDot.el);
		} else {
			centroidToGenreDotLine.style.display = "none";
			_restoreGenreDotFill();
			updateGenreDotLabelVisibility(null);
			notifyGenreChange(null);
		}
	} else {
		centroidToGenreDotLine.style.display = "none";
		_restoreGenreDotFill();
		updateGenreDotLabelVisibility(null);
		notifyGenreChange(null);
	}

	// Update user to centroid lines
	const users = getUsers().filter((u) => Boolean(u.inGenreRing));
	users.forEach((u) => {
		const st = ensureLineToUser(u);
		const tx = u.x;
		const ty = u.y;
		if (currentActiveUserId !== null && u.id === currentActiveUserId) {
			// If this user is currently being dragged, snap the line endpoint to it (no lag)
			st.x2 = tx;
			st.y2 = ty;
			st.vx = 0;
			st.vy = 0;
		} else {
			// spring toward target user pos
			const ddx = tx - st.x2;
			const ddy = ty - st.y2;
			st.vx = st.vx * lineDamping + ddx * lineStiffness * dt;
			st.vy = st.vy * lineDamping + ddy * lineStiffness * dt;
			st.x2 += st.vx * s;
			st.y2 += st.vy * s;
		}

		// write to DOM
		if (st.lineNode) {
			st.lineNode.setAttribute("x1", String(centroidState.cx));
			st.lineNode.setAttribute("y1", String(centroidState.cy));
			st.lineNode.setAttribute("x2", String(st.x2));
			st.lineNode.setAttribute("y2", String(st.y2));
		}
	});

	lastFrameTime = now;
	rafId = requestAnimationFrame(loop);
}

function _restoreGenreDotFill() {
	if (!currentActivatedGenreDot?.el) return;
	if (currentActivatedGenreDot.originalFill) {
		currentActivatedGenreDot.el.setAttribute('fill', currentActivatedGenreDot.originalFill);
		currentActivatedGenreDot.el.style.fill = currentActivatedGenreDot.originalFill;
	} else {
		currentActivatedGenreDot.el.removeAttribute('fill');
		currentActivatedGenreDot.el.style.removeProperty('fill');
	}
	// restore original radius
	if (currentActivatedGenreDot.originalRadius) {
		currentActivatedGenreDot.el.setAttribute('r', String(currentActivatedGenreDot.originalRadius));
	}
	currentActivatedGenreDot = null;
}

export function teardownCentroid() {
	if (rafId) cancelAnimationFrame(rafId);
	rafId = null;
}

export function getCurrentActivatedGenreName() {
	const el = currentActivatedGenreDot?.el;
	if (!el) return null;
	return el.__curvedText || null;
}

