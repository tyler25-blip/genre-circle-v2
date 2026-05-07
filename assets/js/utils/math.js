/**
 * Berechnet die Distanz zwischen zwei Punkten
 */
export function distance(p1, p2) {
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Berechnet den Winkel zwischen zwei Punkten (in Grad, 0-360)
 * Der Winkel wird relativ zum Mittelpunkt berechnet
 */
export function angle(center, point) {
	const dx = point.x - center.x;
	const dy = point.y - center.y;
	let deg = Math.atan2(dy, dx) * (180 / Math.PI);
	// Normalisieren auf 0-360
	if (deg < 0) deg += 360;
	return deg;
}

/**
 * Clamp-Funktion: Wert in Min-Max Range begrenzen
 */
