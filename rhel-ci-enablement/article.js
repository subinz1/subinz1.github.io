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
