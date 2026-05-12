import { clamp, polarToCartesian } from "../core/svg.js";

export function getAnchorAngle(ringIndex, ringCount) {
	const degreesPerSegment = 360 / ringCount;
	return -90 + ringIndex * degreesPerSegment + degreesPerSegment / 2;
}

// Removed unused bridge helpers and projectGenreTree export; retained getAnchorAngle only.
