import { USERS } from "../config/constants.js";
import { ringLabels } from "../data/genres.js";

/**
 * Zentrale State-Verwaltung für:
 * - User-Positionen und Status (inGenreRing)
 * - Super-Genre-Status (active)
 */

const state = {
	users: USERS.map((user, index) => ({
		id: index,
		x: user.x,
		y: user.y,
		color: user.color,
		inGenreRing: false,
		activeGenreSuperGenreId: null, // Welches Super-Genre ist aktiv (aktiviert durch diesen user)
	})),

	superGenres: ringLabels.map((label, index) => ({
		id: index,
		label: label,
		active: false,
		activeUserId: null, // Welcher user hat dieses Super-Genre aktiviert
	})),
};

/**
 * Updates die Position eines Users
 */
export function updateUserPosition(userId, x, y) {
	if (state.users[userId]) {
		state.users[userId].x = x;
		state.users[userId].y = y;
	}
}

/**
 * Updates den inGenreRing Status eines Users
 */
export function updateUserInGenreRing(userId, inGenreRing) {
	if (state.users[userId]) {
		state.users[userId].inGenreRing = inGenreRing;
	}
}

/**
 * Updates das aktive Super-Genre eines Users
 */
export function updateUserActiveSuperGenre(userId, superGenreId) {
	const user = state.users[userId];
	if (!user) return;

	// Wenn superGenreId === null, soll das Super-Genre nur dann deaktiviert werden,
	// wenn dieser User tatsächlich der Aktivator war. Danach User-Status löschen.
	if (superGenreId === null) {
		if (user.activeGenreSuperGenreId !== null) {
			const oldSuperGenre = state.superGenres[user.activeGenreSuperGenreId];
			if (oldSuperGenre && oldSuperGenre.activeUserId === userId) {
				oldSuperGenre.active = false;
				oldSuperGenre.activeUserId = null;
			}
			user.activeGenreSuperGenreId = null;
		}
		return;
	}

	// Versucht, ein Super-Genre zu aktivieren.
	const newSuperGenre = state.superGenres[superGenreId];
	if (!newSuperGenre) return;

	// Wenn das Super-Genre bereits von einem anderen User aktiviert wurde, darf es
	// nicht von diesem User übernommen werden.
	if (newSuperGenre.active && newSuperGenre.activeUserId !== userId) {
		return;
	}

	// Falls der User vorher ein anderes Super-Genre aktiviert hatte, und er auch der
	// Aktivator dieses alten Super-Genres ist, dann dieses alte Super-Genre deaktivieren.
	if (user.activeGenreSuperGenreId !== null && user.activeGenreSuperGenreId !== superGenreId) {
		const oldSuperGenre = state.superGenres[user.activeGenreSuperGenreId];
		if (oldSuperGenre && oldSuperGenre.activeUserId === userId) {
			oldSuperGenre.active = false;
			oldSuperGenre.activeUserId = null;
		}
	}

	// Neues Super-Genre dem User zuweisen
	newSuperGenre.active = true;
	newSuperGenre.activeUserId = userId;
	user.activeGenreSuperGenreId = superGenreId;
}

/**
 * Gibt einen bestimmten User zurück
 */
export function getUser(userId) {
	return state.users[userId];
}

/**
 * Gibt alle Users zurück
 */
export function getUsers() {
	return state.users;
}

/**
 * Gibt alle Super-Genres zurück
 */
export function getSuperGenres() {
	return state.superGenres;
}

// Legacy exports für Backwards Compatibility während der Migration
export const getDot = getUser;
export const getDots = getUsers;
export const getGenres = getSuperGenres;
export const updateDotPosition = updateUserPosition;
export const updateDotInCircle = updateUserInGenreRing;
export const updateDotActiveGenre = updateUserActiveSuperGenre;
