const root = document.documentElement;
const storedTheme = localStorage.getItem("theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

setTheme(storedTheme || (prefersLight.matches ? "light" : "dark"));

document.querySelector(".theme-toggle").addEventListener("click", () => {
  setTheme(root.dataset.theme === "dark" ? "light" : "dark");
});

const loginForm = document.querySelector("[data-login-form]");
const loginStatus = document.querySelector("[data-login-status]");
const loginSubmit = document.querySelector("[data-login-submit]");
const endpoint = window.PORTFOLIO_AUTH?.endpoint?.replace(/\/$/, "");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!endpoint) {
    loginStatus.textContent = "Private access is not deployed yet.";
    return;
  }

  loginSubmit.disabled = true;
  loginStatus.textContent = "Verifying access…";

  try {
    const formData = new FormData(loginForm);
    const response = await fetch(`${endpoint}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.token) {
      throw new Error(payload?.error || "Sign-in was not accepted.");
    }

    sessionStorage.setItem("portfolio-access-token", payload.token);
    window.location.assign("../private/");
  } catch (error) {
    loginStatus.textContent =
      error instanceof Error ? error.message : "Unable to sign in right now.";
  } finally {
    loginSubmit.disabled = false;
  }
});
