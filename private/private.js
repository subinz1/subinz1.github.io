const root = document.documentElement;
const storedTheme = localStorage.getItem("theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const auth = window.PORTFOLIO_AUTH || {};
const driveApiBase = "https://www.googleapis.com/drive/v3";
const googleWorkspaceExports = {
  "application/vnd.google-apps.document": {
    extension: ".pdf",
    mimeType: "application/pdf",
  },
  "application/vnd.google-apps.presentation": {
    extension: ".pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  "application/vnd.google-apps.spreadsheet": {
    extension: ".xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};
const fileList = document.querySelector("[data-private-files]");
const fileStatus = document.querySelector("[data-file-status]");
const fileCount = document.querySelector("[data-file-count]");

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

function accessToken() {
  return sessionStorage.getItem("portfolio-google-access-token");
}

function accessExpired() {
  return Number(sessionStorage.getItem("portfolio-google-access-expires-at")) <= Date.now() + 30_000;
}

function configured() {
  return [auth.googleClientId, auth.driveFolderId, auth.allowedEmail].every(
    (value) => typeof value === "string" && value.length > 0
  );
}

function approvedEmail() {
  return auth.allowedEmail.trim().toLowerCase();
}

function signOut() {
  sessionStorage.removeItem("portfolio-google-access-token");
  sessionStorage.removeItem("portfolio-google-access-expires-at");
  sessionStorage.removeItem("portfolio-google-email");
  window.location.assign("../login/");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(value) {
  const name = value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return name || "download";
}

function fileNameForExport(name, extension) {
  const safeName = safeFileName(name);
  return safeName.toLowerCase().endsWith(extension) ? safeName : `${safeName}${extension}`;
}

async function driveFetch(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (response.status === 401) {
    signOut();
    throw new Error("Google access expired. Sign in again to continue.");
  }
  return response;
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

async function listFiles() {
  const url = new URL(`${driveApiBase}/files`);
  url.searchParams.set(
    "q",
    `'${auth.driveFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`
  );
  url.searchParams.set("fields", "files(id,name,size,createdTime,modifiedTime,mimeType)");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await driveFetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.files)) {
    throw new Error("Google Drive could not load the private folder.");
  }
  return payload.files.map((file) => ({
    id: file.id,
    name: file.name,
    size: Number(file.size) || 0,
    uploaded: file.modifiedTime || file.createdTime,
    mimeType: file.mimeType,
  }));
}

async function fileMetadata(fileId) {
  const url = new URL(`${driveApiBase}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,parents");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await driveFetch(url);
  const metadata = await response.json().catch(() => null);
  if (!response.ok || !metadata?.parents?.includes(auth.driveFolderId)) {
    throw new Error("The file is no longer available in the private folder.");
  }
  return metadata;
}

async function downloadFile(file, button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Preparing…";

  try {
    const metadata = await fileMetadata(file.id);
    const exportFormat = googleWorkspaceExports[metadata.mimeType];
    if (metadata.mimeType?.startsWith("application/vnd.google-apps.") && !exportFormat) {
      throw new Error("This Google Workspace file type cannot be downloaded.");
    }

    const url = new URL(
      exportFormat
        ? `${driveApiBase}/files/${encodeURIComponent(metadata.id)}/export`
        : `${driveApiBase}/files/${encodeURIComponent(metadata.id)}`
    );
    if (exportFormat) {
      url.searchParams.set("mimeType", exportFormat.mimeType);
    } else {
      url.searchParams.set("alt", "media");
    }
    url.searchParams.set("supportsAllDrives", "true");

    const response = await driveFetch(url);
    if (!response.ok) throw new Error("The file is no longer available.");

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = exportFormat
      ? fileNameForExport(metadata.name, exportFormat.extension)
      : safeFileName(metadata.name);
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    fileStatus.textContent =
      error instanceof Error ? error.message : "Unable to download this file.";
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function loadFiles() {
  if (!configured()) {
    fileStatus.textContent = "Google access is not configured yet.";
    return;
  }
  if (!accessToken() || accessExpired()) {
    signOut();
    return;
  }
  if (sessionStorage.getItem("portfolio-google-email") !== approvedEmail()) {
    signOut();
    return;
  }

  try {
    renderFiles(await listFiles());
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
