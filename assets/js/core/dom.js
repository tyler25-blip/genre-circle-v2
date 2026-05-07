export function getDomRefs() {
	const svg = document.getElementById("genre-ring");
	return {
		svg,
		defs: document.getElementById("ring-defs"),
		ringBaseGroup: document.getElementById("ring-base"),
		genreTreesGroup: document.getElementById("genre-trees"),
		ringHighlightsGroup: document.getElementById("ring-highlights"),
		ringLabelsGroup: document.getElementById("ring-labels"),
		particlesGroup: document.getElementById("particles"),
		centroidGroup: document.getElementById("centroid"),
		draggableDotsGroup: document.getElementById("draggable-dots"),
	};
}
