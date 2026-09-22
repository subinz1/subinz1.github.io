const root = document.documentElement;
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const storedTheme = localStorage.getItem("theme");

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

setTheme(storedTheme || (prefersLight.matches ? "light" : "dark"));

document.querySelector(".theme-toggle").addEventListener("click", () => {
  setTheme(root.dataset.theme === "dark" ? "light" : "dark");
});

const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".site-nav");
menuToggle.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(open));
});

nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  nav.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
}));

const header = document.querySelector("[data-header]");
window.addEventListener("scroll", () => header.classList.toggle("is-scrolled", window.scrollY > 16), { passive: true });

const revealTargets = document.querySelectorAll("[data-reveal]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  root.classList.add("reveal-ready");
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("is-visible");
    });
  }, { threshold: 0.12 });

  revealTargets.forEach((element) => {
    element.style.setProperty("--delay", `${element.dataset.delay || 0}ms`);
    revealObserver.observe(element);
  });
}

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    document.querySelectorAll(".site-nav a").forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
    });
  });
}, { rootMargin: "-40% 0px -55% 0px" });

document.querySelectorAll("main section[id]").forEach((section) => sectionObserver.observe(section));

const filters = document.querySelectorAll("[data-filter]");
const projects = document.querySelectorAll("[data-project]");
const filterStatus = document.querySelector("[data-filter-status]");
filters.forEach((filter) => filter.addEventListener("click", () => {
  const category = filter.dataset.filter;
  let shown = 0;
  filters.forEach((button) => {
    const selected = button === filter;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  projects.forEach((project) => {
    const visible = category === "all" || project.dataset.project.includes(category);
    project.classList.toggle("is-hidden", !visible);
    if (visible) shown += 1;
  });
  filterStatus.textContent = category === "all" ? "Showing all projects" : `Showing ${shown} ${category} project${shown === 1 ? "" : "s"}`;
}));

const toast = document.querySelector("[data-toast]");
document.querySelector("[data-copy-link]").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.origin);
    toast.textContent = "Portfolio link copied";
  } catch {
    toast.textContent = "Copy this link: " + window.location.origin;
  }
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
});

document.querySelector("[data-year]").textContent = new Date().getFullYear();
