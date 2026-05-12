import {
	LABEL_RADIUS_INNER,
	LABEL_RADIUS_OUTER,
	LABEL_RADIUS_SINGLE,
	RING_CENTER,
} from "../config/constants.js";
import { ringLabels } from "../data/genres.js";
import { createArcPath, createSvgElement, polarToCartesian } from "../core/svg.js";
import { getSuperGenres } from "../core/state.js";

function createReverseArcPath(center, radius, startAngle, endAngle) {
	const start = polarToCartesian(center.x, center.y, radius, endAngle);
	const end = polarToCartesian(center.x, center.y, radius, startAngle);
	const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
	return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export function renderLabels(defs, labelsGroup) {
	labelsGroup.replaceChildren();

	const segmentAngle = 360 / ringLabels.length;
	const segmentPadding = 2;

	ringLabels.forEach((labelLines, index) => {
		const startAngle = -90 + index * segmentAngle + segmentPadding;
		const endAngle = -90 + (index + 1) * segmentAngle - segmentPadding;

		labelLines.forEach((lineText, lineIndex) => {
			const isMultiLine = labelLines.length > 1;
			const outwardRadius = isMultiLine
				? lineIndex === 0
					? LABEL_RADIUS_OUTER
					: LABEL_RADIUS_INNER
				: LABEL_RADIUS_SINGLE;
			// On flip, swap the radii of the lines so reading order stays sensible
			const inwardRadius = isMultiLine
				? lineIndex === 0
					? LABEL_RADIUS_INNER
					: LABEL_RADIUS_OUTER
				: LABEL_RADIUS_SINGLE;

			const outwardId = `genre-segment-${index}-line-${lineIndex}-out`;
			const outwardPath = createSvgElement("path");
			outwardPath.setAttribute("id", outwardId);
			outwardPath.setAttribute("d", createReverseArcPath(RING_CENTER, outwardRadius, startAngle, endAngle));
			defs.appendChild(outwardPath);

			const inwardId = `genre-segment-${index}-line-${lineIndex}-in`;
			const inwardPath = createSvgElement("path");
			inwardPath.setAttribute("id", inwardId);
			inwardPath.setAttribute("d", createArcPath(RING_CENTER, inwardRadius, startAngle, endAngle));
			defs.appendChild(inwardPath);

			const text = createSvgElement("text");
			text.setAttribute("class", "ring-text");
			text.setAttribute("data-supergenre-id", String(index));
			text.dataset.outwardPath = outwardId;
			text.dataset.inwardPath = inwardId;

			const textPath = createSvgElement("textPath");
			textPath.setAttribute("href", `#${outwardId}`);
			textPath.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${outwardId}`);
			textPath.setAttribute("startOffset", "50%");
			textPath.setAttribute("text-anchor", "middle");
			textPath.textContent = lineText;

			text.appendChild(textPath);
			labelsGroup.appendChild(text);
		});
	});
}

export function updateLabels() {
	const superGenres = getSuperGenres();
	const labels = document.querySelectorAll(".ring-text");
	labels.forEach((label) => {
		const id = Number(label.getAttribute("data-supergenre-id"));
		const sg = superGenres[id];
		const isActive = Boolean(sg && sg.active);
		const textPath = label.querySelector("textPath");
		if (!textPath) return;
		const targetId = isActive ? label.dataset.inwardPath : label.dataset.outwardPath;
		if (!targetId) return;
		const currentHref = textPath.getAttribute("href");
		if (currentHref === `#${targetId}`) {
			// already correct, just toggle class
		} else {
			textPath.setAttribute("href", `#${targetId}`);
			textPath.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${targetId}`);
		}
		if (isActive) label.classList.add("is-active");
		else label.classList.remove("is-active");
	});
}
