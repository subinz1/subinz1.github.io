const root = document.documentElement;
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const storedTheme = localStorage.getItem("theme");

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

setTheme(storedTheme || (prefersLight.matches ? "light" : "dark"));

const systemLoader = document.querySelector("[data-system-loader]");
if (systemLoader) {
  const loaderProgress = systemLoader.querySelector("[data-loader-progress]");
  const loaderStage = systemLoader.querySelector("[data-loader-stage]");
  const loaderSteps = systemLoader.querySelectorAll("[data-loader-step]");
  const loaderSkip = systemLoader.querySelector("[data-loader-skip]");
  const loaderTimers = [];
  const loaderSessionKey = "subin-system-loader-seen";
  let loaderFinished = false;

  const hasSeenLoader = () => {
    try {
      return sessionStorage.getItem(loaderSessionKey) === "true";
    } catch {
      return false;
    }
  };

  const finishLoader = () => {
    if (loaderFinished) return;
    loaderFinished = true;
    loaderTimers.forEach((timer) => window.clearTimeout(timer));
    loaderProgress.textContent = "100";
    loaderStage.textContent = "context ready";
    loaderSteps.forEach((step) => step.classList.add("is-linked"));
    document.body.classList.remove("loader-active");
    systemLoader.classList.add("is-leaving");
    try {
      sessionStorage.setItem(loaderSessionKey, "true");
    } catch {
      // The loader remains functional when storage is unavailable.
    }
    window.setTimeout(() => {
      systemLoader.hidden = true;
    }, 500);
  };

  if (reducedMotion.matches || hasSeenLoader()) {
    finishLoader();
  } else {
    document.body.classList.add("loader-active");
    const loaderStates = [
      [28, "linking ecosystem"],
      [63, "routing signals"],
      [88, "readying portfolio"],
    ];
    loaderStates.forEach(([progress, stage], index) => {
      loaderTimers.push(window.setTimeout(() => {
        loaderProgress.textContent = String(progress).padStart(2, "0");
        loaderStage.textContent = stage;
        loaderSteps[index].classList.add("is-linked");
      }, 360 + index * 660));
    });
    loaderTimers.push(window.setTimeout(finishLoader, 2_400));
    loaderSkip.addEventListener("click", finishLoader);
  }
}

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

const toast = document.querySelector("[data-toast]");
let toastTimeout;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

const shareProfile = document.querySelector("[data-share-profile]");
shareProfile.addEventListener("click", async () => {
  const shareData = {
    title: document.title,
    text: "Subin George — ML systems, CI reliability, and open-source infrastructure",
    url: window.location.href,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showToast("Thanks for sharing.");
    } else {
      await navigator.clipboard.writeText(shareData.url);
      showToast("Portfolio link copied.");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("Unable to share the portfolio link.");
  }
});

const activityCards = document.querySelectorAll("[data-activity-card]");
const closeActivityPopovers = () => {
  activityCards.forEach((card) => {
    card.classList.remove("is-open");
    card.querySelector("[data-activity-trigger]").setAttribute("aria-expanded", "false");
  });
};

activityCards.forEach((card) => {
  const trigger = card.querySelector("[data-activity-trigger]");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = !card.classList.contains("is-open");
    closeActivityPopovers();
    card.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-activity-card]")) closeActivityPopovers();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeActivityPopovers();
});

const systemDeck = document.querySelector("[data-system-deck]");
if (systemDeck) {
  const systemTabs = [...systemDeck.querySelectorAll("[data-system-select]")];
  const systemPanels = [...systemDeck.querySelectorAll("[data-system-panel]")];

  const selectSystem = (system, moveFocus = false) => {
    systemTabs.forEach((tab) => {
      const selected = tab.dataset.systemSelect === system;
      tab.classList.toggle("is-selected", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && moveFocus) tab.focus();
    });

    systemPanels.forEach((panel) => {
      const selected = panel.dataset.systemPanel === system;
      panel.classList.toggle("is-selected", selected);
      panel.hidden = !selected;
    });
  };

  systemTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectSystem(tab.dataset.systemSelect));
    tab.addEventListener("keydown", (event) => {
      const lastIndex = systemTabs.length - 1;
      let nextIndex = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = index === lastIndex ? 0 : index + 1;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = lastIndex;
      if (nextIndex === null) return;
      event.preventDefault();
      selectSystem(systemTabs[nextIndex].dataset.systemSelect, true);
    });
  });

}

const contactForm = document.querySelector("[data-contact-form]");
const contactSubmit = document.querySelector("[data-contact-submit]");
contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  contactSubmit.disabled = true;
  contactForm.setAttribute("aria-busy", "true");

  try {
    const response = await fetch(contactForm.action, {
      method: contactForm.method,
      body: new FormData(contactForm),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.errors?.map((error) => error.message).join(" ");
      throw new Error(message || "Unable to send your request. Please try again.");
    }
    contactForm.reset();
    showToast("Thanks — your connection request is on its way.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to send your request. Please try again.");
  } finally {
    contactSubmit.disabled = false;
    contactForm.removeAttribute("aria-busy");
  }
});
