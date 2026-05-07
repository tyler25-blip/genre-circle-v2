import { RING_CENTER, RING_RADIUS } from "../config/constants.js";
import { ringLabels } from "../data/genres.js";
import { createSvgElement, polarToCartesian } from "../core/svg.js";
import { getUsers, getSuperGenres } from "../core/state.js";

const RING_HALF_WIDTH = 28;
const RING_INNER_EDGE = RING_RADIUS - RING_HALF_WIDTH;
const RING_OUTER_EDGE = RING_RADIUS + RING_HALF_WIDTH;
const BEAM_END_RADIUS = 1300;

function buildSectorPath(startAngle, endAngle, innerR, outerR) {
	const startInner = polarToCartesian(RING_CENTER.x, RING_CENTER.y, innerR, startAngle);
	const startOuter = polarToCartesian(RING_CENTER.x, RING_CENTER.y, outerR, startAngle);
	const endOuter = polarToCartesian(RING_CENTER.x, RING_CENTER.y, outerR, endAngle);
	const endInner = polarToCartesian(RING_CENTER.x, RING_CENTER.y, innerR, endAngle);
	const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
	return (
		`M ${startInner.x} ${startInner.y} ` +
		`L ${startOuter.x} ${startOuter.y} ` +
		`A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y} ` +
		`L ${endInner.x} ${endInner.y} ` +
		`A ${innerR} ${innerR} 0 ${largeArc} 0 ${startInner.x} ${startInner.y} Z`
	);
}

function ensureGlowFilter(defs) {
	if (!defs || defs.querySelector("#supergenre-glow")) return;
	const filter = createSvgElement("filter");
	filter.setAttribute("id", "supergenre-glow");
	filter.setAttribute("x", "-30%");
	filter.setAttribute("y", "-30%");
	filter.setAttribute("width", "160%");
	filter.setAttribute("height", "160%");

	const blur = createSvgElement("feGaussianBlur");
	blur.setAttribute("stdDeviation", "14");
	blur.setAttribute("result", "blur");
	filter.appendChild(blur);

	const merge = createSvgElement("feMerge");
	const m1 = createSvgElement("feMergeNode");
	m1.setAttribute("in", "blur");
	const m2 = createSvgElement("feMergeNode");
	m2.setAttribute("in", "SourceGraphic");
	merge.appendChild(m1);
	merge.appendChild(m2);
	filter.appendChild(merge);

	defs.appendChild(filter);
}

function buildBeamGradient(idx, midAngle, segmentAngle, color) {
	const id = `supergenre-beam-grad-${idx}`;
	const halfAngleRad = ((segmentAngle / 2) * Math.PI) / 180;
	const midAngleRad = (midAngle * Math.PI) / 180;
	const axisR = (RING_OUTER_EDGE + BEAM_END_RADIUS) / 2;

	// Place gradient endpoints exactly at the two angular edges of the beam
	// (radial lines from the ring centre), not perpendicular to the axis.
	const edge1Angle = midAngleRad - halfAngleRad;
	const edge2Angle = midAngleRad + halfAngleRad;
	const x1 = RING_CENTER.x + axisR * Math.cos(edge1Angle);
	const y1 = RING_CENTER.y + axisR * Math.sin(edge1Angle);
	const x2 = RING_CENTER.x + axisR * Math.cos(edge2Angle);
	const y2 = RING_CENTER.y + axisR * Math.sin(edge2Angle);

	const grad = createSvgElement("linearGradient");
	grad.setAttribute("id", id);
	grad.setAttribute("gradientUnits", "userSpaceOnUse");
	grad.setAttribute("x1", String(x1));
	grad.setAttribute("y1", String(y1));
	grad.setAttribute("x2", String(x2));
	grad.setAttribute("y2", String(y2));

	// Thin bright rails on each side, broad dim middle
	const stops = [
		{ offset: "0%", opacity: 0.6 },
		{ offset: "8%", opacity: 0.1 },
		{ offset: "50%", opacity: 0.08 },
		{ offset: "92%", opacity: 0.1 },
		{ offset: "100%", opacity: 0.6 },
	];
	stops.forEach((s) => {
		const stop = createSvgElement("stop");
		stop.setAttribute("offset", s.offset);
		stop.setAttribute("stop-color", color);
		stop.setAttribute("stop-opacity", String(s.opacity));
		grad.appendChild(stop);
	});

	return grad;
}

function ensureBeamFadeMask(defs, idx, midAngle, startAngle, endAngle) {
	if (!defs) return null;
	const maskId = `supergenre-beam-mask-${idx}`;
	if (defs.querySelector(`#${maskId}`)) return maskId;

	const gradId = `supergenre-beam-mask-grad-${idx}`;
	const midAngleRad = (midAngle * Math.PI) / 180;
	const x1 = RING_CENTER.x + RING_OUTER_EDGE * Math.cos(midAngleRad);
	const y1 = RING_CENTER.y + RING_OUTER_EDGE * Math.sin(midAngleRad);
	const x2 = RING_CENTER.x + BEAM_END_RADIUS * Math.cos(midAngleRad);
	const y2 = RING_CENTER.y + BEAM_END_RADIUS * Math.sin(midAngleRad);

	const grad = createSvgElement("linearGradient");
	grad.setAttribute("id", gradId);
	grad.setAttribute("gradientUnits", "userSpaceOnUse");
	grad.setAttribute("x1", String(x1));
	grad.setAttribute("y1", String(y1));
	grad.setAttribute("x2", String(x2));
	grad.setAttribute("y2", String(y2));

	const s1 = createSvgElement("stop");
	s1.setAttribute("offset", "0%");
	s1.setAttribute("stop-color", "white");
	s1.setAttribute("stop-opacity", "1");
	const s2 = createSvgElement("stop");
	s2.setAttribute("offset", "100%");
	s2.setAttribute("stop-color", "white");
	s2.setAttribute("stop-opacity", "0");
	grad.appendChild(s1);
	grad.appendChild(s2);
	defs.appendChild(grad);

	const mask = createSvgElement("mask");
	mask.setAttribute("id", maskId);
	mask.setAttribute("maskUnits", "userSpaceOnUse");
	const maskShape = createSvgElement("path");
	maskShape.setAttribute("d", buildSectorPath(startAngle, endAngle, RING_OUTER_EDGE, BEAM_END_RADIUS));
	maskShape.setAttribute("fill", `url(#${gradId})`);
	mask.appendChild(maskShape);
	defs.appendChild(mask);

	return maskId;
}

export function renderHighlights(highlightsGroup) {
	highlightsGroup.replaceChildren();

	const defs = document.getElementById("ring-defs");
	ensureGlowFilter(defs);

	const segmentAngle = 360 / ringLabels.length;

	ringLabels.forEach((_, idx) => {
		const startAngle = -90 + idx * segmentAngle;
		const endAngle = -90 + (idx + 1) * segmentAngle;
		const midAngle = -90 + idx * segmentAngle + segmentAngle / 2;

		const maskId = ensureBeamFadeMask(defs, idx, midAngle, startAngle, endAngle);

		const group = createSvgElement("g");
		group.setAttribute("class", "supergenre-highlight-group");
		group.setAttribute("data-supergenre-id", String(idx));
		group.setAttribute("opacity", "0");

		// Sector lives outside the masked beam group: stays sharp, no fade
		const sector = createSvgElement("path");
		sector.setAttribute("class", "supergenre-sector");
		sector.setAttribute("d", buildSectorPath(startAngle, endAngle, RING_INNER_EDGE, RING_OUTER_EDGE));
		sector.setAttribute("fill", "transparent");
		group.appendChild(sector);

		// Beam sub-group with fade mask + glow filter
		const beamGroup = createSvgElement("g");
		beamGroup.setAttribute("class", "supergenre-beam-group");
		if (maskId) beamGroup.setAttribute("mask", `url(#${maskId})`);
		beamGroup.setAttribute("filter", "url(#supergenre-glow)");

		const beam = createSvgElement("path");
		beam.setAttribute("class", "supergenre-beam");
		beam.setAttribute("d", buildSectorPath(startAngle, endAngle, RING_OUTER_EDGE, BEAM_END_RADIUS));
		beam.setAttribute("fill", "transparent");
		beam.setAttribute("stroke", "none");
		beamGroup.appendChild(beam);

		const startInner = polarToCartesian(RING_CENTER.x, RING_CENTER.y, RING_OUTER_EDGE, startAngle);
		const startOuter = polarToCartesian(RING_CENTER.x, RING_CENTER.y, BEAM_END_RADIUS, startAngle);
		const endInner = polarToCartesian(RING_CENTER.x, RING_CENTER.y, RING_OUTER_EDGE, endAngle);
		const endOuter = polarToCartesian(RING_CENTER.x, RING_CENTER.y, BEAM_END_RADIUS, endAngle);

		const railLeft = createSvgElement("line");
		railLeft.setAttribute("class", "supergenre-beam-rail");
		railLeft.setAttribute("x1", String(startInner.x));
		railLeft.setAttribute("y1", String(startInner.y));
		railLeft.setAttribute("x2", String(startOuter.x));
		railLeft.setAttribute("y2", String(startOuter.y));
		railLeft.setAttribute("stroke", "transparent");
		railLeft.setAttribute("stroke-width", "2");
		railLeft.setAttribute("stroke-linecap", "round");
		beamGroup.appendChild(railLeft);

		const railRight = createSvgElement("line");
		railRight.setAttribute("class", "supergenre-beam-rail");
		railRight.setAttribute("x1", String(endInner.x));
		railRight.setAttribute("y1", String(endInner.y));
		railRight.setAttribute("x2", String(endOuter.x));
		railRight.setAttribute("y2", String(endOuter.y));
		railRight.setAttribute("stroke", "transparent");
		railRight.setAttribute("stroke-width", "2");
		railRight.setAttribute("stroke-linecap", "round");
		beamGroup.appendChild(railRight);

		group.appendChild(beamGroup);

		highlightsGroup.appendChild(group);
	});
}

export function updateHighlights() {
	const users = getUsers();
	const superGenres = getSuperGenres();
	const groups = document.querySelectorAll(".supergenre-highlight-group");
	const defs = document.getElementById("ring-defs");
	const segmentAngle = 360 / ringLabels.length;

	groups.forEach((group) => {
		const idx = Number(group.getAttribute("data-supergenre-id"));
		const sg = superGenres[idx];

		if (sg && sg.active && sg.activeUserId !== null) {
			const user = users[sg.activeUserId];
			if (!user) return;

			const sector = group.querySelector(".supergenre-sector");
			const beam = group.querySelector(".supergenre-beam");
			const rails = group.querySelectorAll(".supergenre-beam-rail");

			if (sector) {
				sector.setAttribute("fill", user.color);
				sector.setAttribute("fill-opacity", "0.92");
			}
			if (beam) {
				beam.setAttribute("fill", user.color);
				beam.setAttribute("fill-opacity", "0.08");
			}
			rails.forEach((rail) => {
				rail.setAttribute("stroke", user.color);
				rail.setAttribute("stroke-opacity", "0.7");
			});

			group.setAttribute("opacity", "1");
		} else {
			group.setAttribute("opacity", "0");
			const sector = group.querySelector(".supergenre-sector");
			const beam = group.querySelector(".supergenre-beam");
			const rails = group.querySelectorAll(".supergenre-beam-rail");
			if (sector) sector.setAttribute("fill", "transparent");
			if (beam) beam.setAttribute("fill", "transparent");
			rails.forEach((rail) => rail.setAttribute("stroke", "transparent"));
		}
	});
}
