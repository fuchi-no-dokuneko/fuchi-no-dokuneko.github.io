(() => {
  "use strict";
  const buttons = Array.from(document.querySelectorAll("[data-filter]"));
  const projects = Array.from(document.querySelectorAll("#projects article"));
  function applyFilter(filter) {
    let visible = 0;
    projects.forEach((project) => { const show = filter === "all" || project.dataset.category.split(" ").includes(filter); project.hidden = !show; if (show) visible += 1; });
    buttons.forEach((button) => button.classList.toggle("active", button.dataset.filter === filter));
    document.getElementById("resultCount").textContent = filter === "all" ? "Showing all " + visible + " projects" : "Showing " + visible + " " + filter + " projects";
  }
  buttons.forEach((button) => button.addEventListener("click", () => applyFilter(button.dataset.filter)));
  window.ProjectIndex = { applyFilter };
})();
