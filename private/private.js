const root = document.documentElement;
const storedTheme = localStorage.getItem("theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const token = sessionStorage.getItem("portfolio-access-token");
const endpoint = window.PORTFOLIO_AUTH?.endpoint?.replace(/\/$/, "");
const fileList = document.querySelector("[data-private-files]");
const fileStatus = document.querySelector("[data-file-status]");
const fileCount = document.querySelector("[data-file-count]");

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

function signOut() {
  sessionStorage.removeItem("portfolio-access-token");
  window.location.assign("../login/");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFiles(files) {
  fileList.replaceChildren();
  fileCount.textContent = String(files.length);

  if (files.length === 0) {
    fileStatus.textContent = "No private files have been added yet.";
    return;
  }

  fileStatus.textContent = "";
  files.forEach((file) => {
    const item = document.createElement("li");
    const details = document.createElement("div");
    const name = document.createElement("strong");
    const meta = document.createElement("small");
    const button = document.createElement("button");

    name.textContent = file.name;
    meta.textContent = `${formatBytes(file.size)} · updated ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(file.uploaded))}`;
    button.className = "button button-quiet";
    button.type = "button";
    button.textContent = "Download ↘";
    button.addEventListener("click", () => downloadFile(file, button));

    details.append(name, meta);
    item.append(details, button);
    fileList.append(item);
  });
}

async function downloadFile(file, button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Preparing…";

  try {
    const response = await fetch(`${endpoint}/api/download/${encodeURIComponent(file.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("The file is no longer available.");

    const file = await response.blob();
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    fileStatus.textContent =
      error instanceof Error ? error.message : "Unable to download this file.";
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function loadFiles() {
  if (!token) {
    signOut();
    return;
  }
  if (!endpoint) {
    fileStatus.textContent = "Private access is not deployed yet.";
    return;
  }

  try {
    const response = await fetch(`${endpoint}/api/files`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      signOut();
      return;
    }
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.files)) {
      throw new Error(payload.error || "Unable to load private files.");
    }
    renderFiles(payload.files);
  } catch (error) {
    fileStatus.textContent =
      error instanceof Error ? error.message : "Unable to load private files.";
  }
}

setTheme(storedTheme || (prefersLight.matches ? "light" : "dark"));
document.querySelector(".theme-toggle").addEventListener("click", () => {
  setTheme(root.dataset.theme === "dark" ? "light" : "dark");
});
document.querySelector("[data-logout]").addEventListener("click", signOut);
loadFiles();
