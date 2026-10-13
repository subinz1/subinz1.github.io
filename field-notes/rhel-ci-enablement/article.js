const root = document.documentElement;
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const storedTheme = localStorage.getItem("theme");

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

setTheme(storedTheme || (prefersLight.matches ? "light" : "dark"));

const themeToggle = document.querySelector(".theme-toggle");
themeToggle?.addEventListener("click", () => {
  setTheme(root.dataset.theme === "dark" ? "light" : "dark");
});

const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".site-nav");
menuToggle?.addEventListener("click", () => {
  const open = nav?.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(open));
});

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
  });
});

const header = document.querySelector("[data-header]");
window.addEventListener(
  "scroll",
  () => header?.classList.toggle("is-scrolled", window.scrollY > 16),
  { passive: true }
);

const articleNavigation = document.querySelector(".article-aside nav");
const sectionLinks = articleNavigation
  ? [...articleNavigation.querySelectorAll('a[href^="#"]')]
  : [];
const sectionTargets = sectionLinks
  .map((link) => ({ link, section: document.querySelector(link.hash) }))
  .filter(({ section }) => section);

let activeSectionId;
function setActiveSection(id) {
  if (id === activeSectionId) {
    return;
  }

  activeSectionId = id;
  sectionTargets.forEach(({ link, section }) => {
    const active = section.id === id;
    link.classList.toggle("is-active", active);
    if (active) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function updateActiveSection() {
  const offset = (header?.offsetHeight ?? 0) + 48;
  let current = sectionTargets[0];

  sectionTargets.forEach((target) => {
    if (target.section.getBoundingClientRect().top <= offset) {
      current = target;
    }
  });

  if (current) {
    setActiveSection(current.section.id);
  }
}

if (sectionTargets.length) {
  let frameRequested = false;
  const scheduleActiveSectionUpdate = () => {
    if (!frameRequested) {
      frameRequested = true;
      window.requestAnimationFrame(() => {
        updateActiveSection();
        frameRequested = false;
      });
    }
  };

  sectionLinks.forEach((link) => {
    link.addEventListener("click", () => setActiveSection(link.hash.slice(1)));
  });
  window.addEventListener("scroll", scheduleActiveSectionUpdate, { passive: true });
  window.addEventListener("resize", scheduleActiveSectionUpdate);
  updateActiveSection();
}
