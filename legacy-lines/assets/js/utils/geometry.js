import { RING_CENTER, RING_RADIUS } from "../config/constants.js";
import { distance, angle } from "./math.js";

/**
 * Prüft, ob ein Punkt innerhalb des Kreises liegt
 */
export function isPointInCircle(point) {
	const dist = distance(RING_CENTER, point);
	return dist <= RING_RADIUS;
}

/**
 * Berechnet, welches Super-Genre ein Punkt durchquert
 * Gibt den Super-Genre-Index zurück (0-11) oder null, wenn außerhalb
 * 
 * Hinweis: Die Labels starten bei -90° (12 Uhr), daher addieren wir 90° zum
 * mathematischen Winkel, damit die Super-Genre-Indizierung mit der visuellen
 * Position übereinstimmt.
 */
export function getSuperGenreAtAngle(point) {
	if (!isPointInCircle(point)) {
		return null;
	}

	const rawDeg = angle(RING_CENTER, point);
	// Offset um 90° für Label-Koordinatensystem (Labels starten bei -90°)
	const deg = (rawDeg + 90) % 360;
	const superGenreCount = 12;
	const degreesPerSuperGenre = 360 / superGenreCount;
	const superGenreIndex = Math.floor(deg / degreesPerSuperGenre) % superGenreCount;

	return superGenreIndex;
}

// Legacy export für Backwards Compatibility
export const getGenreAtAngle = getSuperGenreAtAngle;
