import { SVG_NS } from "../config/constants.js";

export function createSvgElement(tagName) {
	return document.createElementNS(SVG_NS, tagName);
}

export function polarToCartesian(centerX, centerY, radius, angleDegrees) {
	const radians = (angleDegrees * Math.PI) / 180;
	return {
		x: centerX + radius * Math.cos(radians),
		y: centerY + radius * Math.sin(radians),
	};
}

export function createArcPath(center, radius, startAngle, endAngle) {
	const start = polarToCartesian(center.x, center.y, radius, startAngle);
	const end = polarToCartesian(center.x, center.y, radius, endAngle);
	const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
	return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

export function toSvgCoordinates(svg, pointerEvent) {
	const point = svg.createSVGPoint();
	point.x = pointerEvent.clientX;
	point.y = pointerEvent.clientY;
	return point.matrixTransform(svg.getScreenCTM().inverse());
}

export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}
