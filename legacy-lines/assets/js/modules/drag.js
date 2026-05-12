import { USER_DOT_RADIUS, USERS } from "../config/constants.js";
import { VIEWBOX_LIMITS } from "../config/settings.js";
import { clamp, createSvgElement, toSvgCoordinates } from "../core/svg.js";
import { updateUserPosition, updateUserInGenreRing, updateUserActiveSuperGenre, getUser, getSuperGenres } from "../core/state.js";
import { isPointInCircle, getSuperGenreAtAngle } from "../utils/geometry.js";
import { updateHighlights } from "./highlights.js";
import { updateLabels } from "./labels.js";
import { notifyCentroidTargets } from "./centroid.js";
import { showGenresForSuperGenre, hideGenresForSuperGenre, recomputeTargetsForAllDisplayed, updateGenreDotPositions } from "./cooccurrence-bridges.js";

function getPosition(node) {
	return {
		x: Number(node.getAttribute("cx")),
		y: Number(node.getAttribute("cy")),
	};
}

export function setupDraggableUsers(svg, usersGroup) {
	usersGroup.replaceChildren();

	const VISUAL_RADIUS = 30;
	const SOLID_CORE_RADIUS = 6;
	const solidStop = `${(SOLID_CORE_RADIUS / VISUAL_RADIUS) * 100}%`;

	const defs = document.getElementById("ring-defs");
	if (defs) {
		USERS.forEach((user, index) => {
			const id = `user-glow-${index}`;
			const existing = defs.querySelector(`#${id}`);
			if (existing) defs.removeChild(existing);
			const grad = createSvgElement("radialGradient");
			grad.setAttribute("id", id);
			grad.setAttribute("cx", "50%");
			grad.setAttribute("cy", "50%");
			grad.setAttribute("r", "50%");
			const inner = createSvgElement("stop");
			inner.setAttribute("offset", "0%");
			inner.setAttribute("stop-color", user.color);
			inner.setAttribute("stop-opacity", "1");
			const coreEdge = createSvgElement("stop");
			coreEdge.setAttribute("offset", solidStop);
			coreEdge.setAttribute("stop-color", user.color);
			coreEdge.setAttribute("stop-opacity", "1");
			const outer = createSvgElement("stop");
			outer.setAttribute("offset", "100%");
			outer.setAttribute("stop-color", user.color);
			outer.setAttribute("stop-opacity", "0");
			grad.appendChild(inner);
			grad.appendChild(coreEdge);
			grad.appendChild(outer);
			defs.appendChild(grad);
		});
	}

	const userNodes = USERS.map((user, index) => {
		const node = createSvgElement("circle");
		node.setAttribute("class", "draggable-user");
		node.setAttribute("data-user-id", String(index));
		node.setAttribute("cx", String(user.x));
		node.setAttribute("cy", String(user.y));
		node.setAttribute("r", String(VISUAL_RADIUS));
		node.setAttribute("fill", `url(#user-glow-${index})`);
		node.style.pointerEvents = "all";
		usersGroup.appendChild(node);
		return node;
	});

	let activeUser = null;
	const dragOffset = { x: 0, y: 0 };

	function endDrag() {
		if (!activeUser) {
			return;
		}
		activeUser.classList.remove("is-dragging");
		activeUser = null;
	}

	userNodes.forEach((user) => {
		user.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			activeUser = user;
			activeUser.setPointerCapture(event.pointerId);

			const pointer = toSvgCoordinates(svg, event);
			const current = getPosition(activeUser);
			dragOffset.x = pointer.x - current.x;
			dragOffset.y = pointer.y - current.y;

			activeUser.classList.add("is-dragging");
		});

		user.addEventListener("pointerup", endDrag);
		user.addEventListener("lostpointercapture", endDrag);
	});

	svg.addEventListener("pointermove", (event) => {
		if (!activeUser) {
			return;
		}

		const pointer = toSvgCoordinates(svg, event);
		const x = clamp(pointer.x - dragOffset.x, VIEWBOX_LIMITS.min, VIEWBOX_LIMITS.max);
		const y = clamp(pointer.y - dragOffset.y, VIEWBOX_LIMITS.min, VIEWBOX_LIMITS.max);

		activeUser.setAttribute("cx", String(x));
		activeUser.setAttribute("cy", String(y));

		// State aktualisieren
		const userId = Number(activeUser.getAttribute("data-user-id"));
		const userPosition = { x, y };

		// Position updaten
		updateUserPosition(userId, x, y);

		// inGenreRing Status updaten
		const nowInGenreRing = isPointInCircle(userPosition);
		// Vorherigen Zustand des Users abfragen
		const prevUser = getUser(userId);
		const wasInGenreRing = prevUser ? Boolean(prevUser.inGenreRing) : false;
		updateUserInGenreRing(userId, nowInGenreRing);

		// Aktivierung nur beim Betreten (outside -> inside)
		if (!wasInGenreRing && nowInGenreRing) {
			const superGenreId = getSuperGenreAtAngle(userPosition);
			const prevActiveCount = getSuperGenres().filter((g) => g.active).length;
			updateUserActiveSuperGenre(userId, superGenreId);
			// show group's genres incrementally
			showGenresForSuperGenre(superGenreId).then(() => {
				updateGenreDotPositions();
			});
			const newActiveCount = getSuperGenres().filter((g) => g.active).length;
			if (newActiveCount !== prevActiveCount) recomputeTargetsForAllDisplayed();
		} else if (wasInGenreRing && !nowInGenreRing) {
			// Beim Verlassen: Super-Genre deaktivieren (nur wenn dieser User der Aktivator ist)
			const prevUserState = getUser(userId);
			const prevSuperGenreId = prevUserState ? prevUserState.activeGenreSuperGenreId : null;
			const prevActiveCount = getSuperGenres().filter((g) => g.active).length;
			updateUserActiveSuperGenre(userId, null);
			if (prevSuperGenreId !== null) {
				hideGenresForSuperGenre(prevSuperGenreId);
				updateGenreDotPositions();
			}
			const newActiveCount = getSuperGenres().filter((g) => g.active).length;
			if (newActiveCount !== prevActiveCount) recomputeTargetsForAllDisplayed();
		}

		// Highlights aktualisieren
		updateHighlights();
		updateLabels();
		// Centroid: notify module that user positions changed so it can update targets
		// Pass active user id so its connection line doesn't lag behind while dragging
		notifyCentroidTargets(userId);
	});
}

// Legacy export for backwards compatibility
export const setupDraggableDots = setupDraggableUsers;
