import { RING_CENTER, RING_RADIUS } from "../config/constants.js";
import { createSvgElement, polarToCartesian } from "../core/svg.js";
import { distance } from "../utils/math.js";

/**
 * Partikel-System für "Pull-Effekt"
 * Erzeugt Partikel, die Nutzer außerhalb des Genre-Rings zum Ring hinziehen
 */

export class ParticleSystem {
	constructor(svg, particlesGroup) {
		this.svg = svg;
		this.particlesGroup = particlesGroup;
		this.particles = [];
		this.emitters = new Map();
		this.animationFrameId = null;
		this.lastTime = 0;
	}

	/**
	 * Setzt alle aktuell aktiven Emitter (Users außerhalb des Genre-Rings)
	 * @param {Array<{x:number,y:number,color:string,id:number}>} users
	 */
	updatePullEmitters(users) {
		const nextEmitters = new Map();

		users.forEach((user) => {
			const existing = this.emitters.get(user.id);
			nextEmitters.set(user.id, {
				id: user.id,
				x: user.x,
				y: user.y,
				color: user.color,
				spawnAccumulator: existing ? existing.spawnAccumulator : 0,
			});
		});

		this.emitters = nextEmitters;

		// Starte den Animations-Loop wenn nicht bereits laufend
		if (!this.animationFrameId) {
			this.lastTime = performance.now();
			this.animationFrameId = requestAnimationFrame((time) =>
				this._animationLoop(time)
			);
		}
	}

	// Legacy export for backwards compatibility
	updateEmitters = this.updatePullEmitters;

	/**
	 * Stoppt alle Pull-Effekte
	 */
	stopPullEffect() {
		this.emitters.clear();
		// animationFrameId wird in _animationLoop gelöscht, wenn keine Partikel mehr da sind
	}

	/**
	 * Animation Loop - wird wiederholt aufgerufen für Partikel-Bewegung
	 */
	_animationLoop(currentTime) {
		const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.05); // in Sekunden
		this.lastTime = currentTime;

		// Update alle Partikel
		this.particles = this.particles.filter((particle) => {
			if (particle.update(deltaTime)) {
				// Partikel lebt noch
				return true;
			} else {
				// Partikel ist abgelaufen -> entfernen
				particle.remove();
				return false;
			}
		});

		// Für alle aktiven Emitter neue Partikel erstellen
		this.emitters.forEach((emitter) => {
			this._generateParticlesForEmitter(emitter, deltaTime);
		});

		// Falls noch Partikel oder aktiver Pull -> nächsten Frame schedulen
		if (this.particles.length > 0 || this.emitters.size > 0) {
			this.animationFrameId = requestAnimationFrame((time) =>
				this._animationLoop(time)
			);
		} else {
			this.animationFrameId = null;
		}
	}

	/**
	 * Generiert neue Partikel für einen User-Emitter
	 * Aktiv nur wenn User außerhalb des Genre-Rings und innerhalb der Genre-Range ist
	 */
	_generateParticlesForEmitter(emitter, deltaTime) {
		const userPos = { x: emitter.x, y: emitter.y };

		// Berechne Distanz zum Ring-Zentrum
		const distToCenter = distance(userPos, RING_CENTER);
		const distToRingBoundary = distToCenter - RING_RADIUS;

		// Wenn User bereits im Kreis: kein Pull-Effekt nötig
		if (distToRingBoundary < 0) {
			return;
		}

		const nearestGenre = this._getNearestGenre(userPos);
		if (!nearestGenre) {
			return;
		}

		// Aktivierung über Distanz zum nächstgelegenen Genre
		const PULL_DISTANCE_THRESHOLD = 286;
		if (nearestGenre.distance > PULL_DISTANCE_THRESHOLD) {
			return;
		}

		// Je näher am Genre, desto dichter der Strom
		const proximity = 1 - nearestGenre.distance / PULL_DISTANCE_THRESHOLD;
		const particlesPerSecond = 5 + proximity * 28;
		emitter.spawnAccumulator += particlesPerSecond * deltaTime;
		const particleCount = Math.floor(emitter.spawnAccumulator);
		emitter.spawnAccumulator -= particleCount;

		if (particleCount <= 0) {
			return;
		}

		// Erstelle neue Partikel in Richtung nächstgelegenes Genre
		for (let i = 0; i < particleCount; i++) {
			const particle = new Particle(
				this.particlesGroup,
				userPos,
				nearestGenre.targetPos,
				emitter.color,
				proximity
			);
			this.particles.push(particle);
		}
	}

	/**
	 * Findet Zielposition und Distanz des nächstgelegenen Genres
	 */
	_getNearestGenre(dotPos) {
		const genreCount = 12;
		const degreesPerGenre = 360 / genreCount;

		let nearestTarget = null;
		let minDistance = Infinity;

		for (let genreId = 0; genreId < genreCount; genreId++) {
			// Berechne den Punkt auf dem Ring für dieses Genre
			// Konsistent mit highlights.js: -90 + genreId * degreesPerGenre + degreesPerGenre/2
			const midAngle = -90 + genreId * degreesPerGenre + degreesPerGenre / 2;
			const genreRingPos = polarToCartesian(
				RING_CENTER.x,
				RING_CENTER.y,
				RING_RADIUS,
				midAngle
			);

			const dist = distance(dotPos, genreRingPos);
			if (dist < minDistance) {
				minDistance = dist;
				nearestTarget = genreRingPos;
			}
		}

		if (!nearestTarget) {
			return null;
		}

		return {
			targetPos: nearestTarget,
			distance: minDistance,
		};
	}
}

class Particle {
	constructor(parentGroup, startPos, targetPos, color, proximity) {
		this.parentGroup = parentGroup;
		this.startPos = { ...startPos };
		this.currentPos = { ...startPos };
		this.targetPos = { ...targetPos };
		this.color = color;
		this.proximity = proximity;
		this.elapsed = 0;

		// Start-Impuls: vom Dot aus in zufällige Richtung weg
		const launchAngle = Math.random() * Math.PI * 2;
		const launchSpeed = 70 + Math.random() * 70;
		this.velocity = {
			x: Math.cos(launchAngle) * launchSpeed,
			y: Math.sin(launchAngle) * launchSpeed,
		};

		this.maxSpeed = 150 + proximity * 50; // langsamer als zuvor
		this.maxLifetime = 3.2 + Math.random() * 0.9;
		this.steerHoldTime = 0.225 + Math.random() * 0.1;
		this.steerRampDuration = 1.375 + Math.random() * 0.175;

		// Zusätzliche organische Krümmung
		this.curlPhase = Math.random() * Math.PI * 2;
		this.curlFreq = 4 + Math.random() * 3;
		this.curlAmp = 18 + Math.random() * 16;

		this.baseRadius = 4.2 + Math.random() * 1.4;

		// Erstelle SVG-Element
		this.element = createSvgElement("circle");
		this.element.setAttribute("class", "particle");
		this.element.setAttribute("r", String(this.baseRadius));
		this.element.setAttribute("fill", color);
		this.element.setAttribute("opacity", "1");
		this.element.setAttribute("cx", String(this.currentPos.x));
		this.element.setAttribute("cy", String(this.currentPos.y));

		parentGroup.appendChild(this.element);
	}

	/**
	 * Update Partikel-Position
	 * Gibt true zurück wenn Partikel noch lebt, false wenn es abgelaufen ist
	 */
	update(deltaTime) {
		this.elapsed += deltaTime;
		const toTargetX = this.targetPos.x - this.currentPos.x;
		const toTargetY = this.targetPos.y - this.currentPos.y;
		const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);

		if (this.elapsed >= this.maxLifetime || distToTarget < 10) {
			return false;
		}

		const dirLen = Math.max(distToTarget, 0.001);
		const desiredX = (toTargetX / dirLen) * this.maxSpeed;
		const desiredY = (toTargetY / dirLen) * this.maxSpeed;

		// Steuerkraft: initiale Richtung erst halten, danach graduell Richtung Genre lenken
		const steerTime = Math.max(this.elapsed - this.steerHoldTime, 0);
		const steerLerp = Math.min(steerTime / this.steerRampDuration, 1);
		const steerStrength = 0.8 + steerLerp * 5.75;
		this.velocity.x += (desiredX - this.velocity.x) * steerStrength * deltaTime;
		this.velocity.y += (desiredY - this.velocity.y) * steerStrength * deltaTime;

		// Organischer Seitendrift (kein gerader Strahl)
		const perpX = -toTargetY / dirLen;
		const perpY = toTargetX / dirLen;
		const curl = Math.sin(this.elapsed * this.curlFreq + this.curlPhase) * this.curlAmp;
		const curlFalloff = Math.max(0.15, Math.min(distToTarget / 260, 1));
		this.velocity.x += perpX * curl * curlFalloff * deltaTime;
		this.velocity.y += perpY * curl * curlFalloff * deltaTime;

		this.currentPos.x += this.velocity.x * deltaTime;
		this.currentPos.y += this.velocity.y * deltaTime;

		// Update SVG-Element Position
		this.element.setAttribute("cx", String(this.currentPos.x));
		this.element.setAttribute("cy", String(this.currentPos.y));

		// Erst nahe am Genre ausblenden
		const fadeStartDistance = 90;
		const lifeFade = Math.max(0, 1 - this.elapsed / this.maxLifetime);
		const distanceFade = Math.min(distToTarget / fadeStartDistance, 1);
		const opacity = Math.max(0.05, Math.min(lifeFade, distanceFade));
		this.element.setAttribute("opacity", String(opacity));

		// Leichtes Schrumpfen erst in der Zielnähe
		const shrink = 0.72 + 0.28 * distanceFade;
		const radius = this.baseRadius * shrink;
		this.element.setAttribute("r", String(radius));

		return true;
	}

	/**
	 * Entfernt das Partikel vom DOM
	 */
	remove() {
		this.element.remove();
	}
}
