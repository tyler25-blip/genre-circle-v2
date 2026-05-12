import { RING_CENTER, RING_RADIUS } from "../config/constants.js";
import { createSvgElement } from "../core/svg.js";

export function renderRing(ringBaseGroup) {
	ringBaseGroup.replaceChildren();

	const ring = createSvgElement("circle");
	ring.setAttribute("class", "ring-stroke");
	ring.setAttribute("cx", String(RING_CENTER.x));
	ring.setAttribute("cy", String(RING_CENTER.y));
	ring.setAttribute("r", String(RING_RADIUS));

	ringBaseGroup.appendChild(ring);
}
