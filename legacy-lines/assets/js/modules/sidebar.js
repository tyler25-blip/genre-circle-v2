/**
 * Sidebar menu toggle functionality
 */

export function setupSidebarMenu() {
	const toggleButton = document.getElementById("sidebar-toggle");
	const sidebarMenu = document.getElementById("sidebar-menu");

	if (!toggleButton || !sidebarMenu) {
		console.warn("Sidebar elements not found");
		return;
	}

	// Toggle sidebar on button click
	toggleButton.addEventListener("click", () => {
		const isOpen = sidebarMenu.classList.toggle("is-open");
		toggleButton.classList.toggle("is-open", isOpen);
	});

	// Close sidebar when clicking outside of it (optional)
	document.addEventListener("click", (e) => {
		const isClickInsideSidebar = sidebarMenu.contains(e.target);
		const isClickOnToggle = toggleButton.contains(e.target);

		if (!isClickInsideSidebar && !isClickOnToggle && sidebarMenu.classList.contains("is-open")) {
			sidebarMenu.classList.remove("is-open");
			toggleButton.classList.remove("is-open");
		}
	});

	// Close sidebar on Escape key
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && sidebarMenu.classList.contains("is-open")) {
			sidebarMenu.classList.remove("is-open");
			toggleButton.classList.remove("is-open");
		}
	});
}
