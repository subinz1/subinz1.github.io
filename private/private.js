const root = document.documentElement;
const storedTheme = localStorage.getItem("theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const auth = window.PORTFOLIO_AUTH || {};
const driveApiBase = "https://www.googleapis.com/drive/v3";
const folderMimeType = "application/vnd.google-apps.folder";
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
const folderTitle = document.querySelector("[data-current-folder]");
const folderNav = document.querySelector("[data-folder-nav]");
const pdfPreview = document.querySelector("[data-pdf-preview]");
const pdfTitle = document.querySelector("[data-pdf-title]");
const pdfFrame = document.querySelector("[data-pdf-frame]");
let folderPath = [];
let previewObjectUrl;

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
  return [auth.googleClientId, auth.driveFolderId].every(
    (value) => typeof value === "string" && value.length > 0
  );
}

function currentFolder() {
  return folderPath.at(-1);
}

function signOut() {
  sessionStorage.removeItem("portfolio-google-access-token");
  sessionStorage.removeItem("portfolio-google-access-expires-at");
  sessionStorage.removeItem("portfolio-google-identity-verified");
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

function previewable(file) {
  return file.mimeType === "application/pdf";
}

function closePreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = undefined;
  pdfFrame.removeAttribute("src");
  pdfPreview.hidden = true;
}

function formatUpdated(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
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

function renderNavigation() {
  folderNav.replaceChildren();
  if (folderPath.length > 1) {
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "← Up";
    up.addEventListener("click", () => {
      folderPath = folderPath.slice(0, -1);
      loadFolder();
    });
    folderNav.append(up);

    const separator = document.createElement("span");
    separator.className = "file-browser__separator";
    separator.textContent = "/";
    folderNav.append(separator);
  }

  folderPath.forEach((folder, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "file-browser__separator";
      separator.textContent = "/";
      folderNav.append(separator);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = folder.name;
    button.disabled = index === folderPath.length - 1;
    button.addEventListener("click", () => {
      folderPath = folderPath.slice(0, index + 1);
      loadFolder();
    });
    folderNav.append(button);
  });
}

function renderItems(items) {
  fileList.replaceChildren();
  fileCount.textContent = String(items.length);
  folderTitle.textContent = currentFolder().name;
  renderNavigation();

  if (items.length === 0) {
    fileStatus.textContent = "This folder is empty.";
    return;
  }

  fileStatus.textContent = "";
  items.forEach((item) => {
    const isFolder = item.mimeType === folderMimeType;
    const row = document.createElement("li");
    const details = document.createElement("div");
    const name = document.createElement("strong");
    const meta = document.createElement("small");
    const actions = document.createElement("div");
    const download = document.createElement("button");

    name.textContent = item.name;
    meta.textContent = isFolder
      ? `Folder · updated ${formatUpdated(item.updated)}`
      : `${formatBytes(item.size)} · updated ${formatUpdated(item.updated)}`;
    actions.className = "private-file-actions";
    download.className = "button button-quiet";
    download.type = "button";
    download.textContent = isFolder ? "Open folder →" : "Download ↘";
    download.addEventListener("click", () => {
      if (isFolder) {
        folderPath = [...folderPath, { id: item.id, name: item.name }];
        loadFolder();
        return;
      }
      downloadFile(item, download);
    });

    if (!isFolder && previewable(item)) {
      const preview = document.createElement("button");
      preview.className = "button button-quiet";
      preview.type = "button";
      preview.textContent = "Preview";
      preview.addEventListener("click", () => previewPdf(item, preview));
      actions.append(preview);
    }

    details.append(name, meta);
    actions.append(download);
    row.append(details, actions);
    fileList.append(row);
  });
}

async function listFolder(folderId) {
  const url = new URL(`${driveApiBase}/files`);
  url.searchParams.set("q", `'${folderId}' in parents and trashed = false`);
  url.searchParams.set("fields", "files(id,name,size,createdTime,modifiedTime,mimeType)");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await driveFetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.files)) {
    throw new Error("Google Drive could not load this folder.");
  }
  return payload.files
    .map((item) => ({
      id: item.id,
      name: item.name,
      size: Number(item.size) || 0,
      updated: item.modifiedTime || item.createdTime,
      mimeType: item.mimeType,
    }))
    .sort((first, second) => {
      const firstIsFolder = first.mimeType === folderMimeType;
      const secondIsFolder = second.mimeType === folderMimeType;
      if (firstIsFolder !== secondIsFolder) return firstIsFolder ? -1 : 1;
      return first.name.localeCompare(second.name);
    });
}

async function fileMetadata(fileId) {
  const url = new URL(`${driveApiBase}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,parents");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await driveFetch(url);
  const metadata = await response.json().catch(() => null);
  if (!response.ok || !metadata?.parents?.includes(currentFolder().id)) {
    throw new Error("The file is no longer available in this folder.");
  }
  return metadata;
}

async function fileResponse(metadata) {
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
  return { exportFormat, response };
}

async function previewPdf(file, button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Loading…";

  try {
    const metadata = await fileMetadata(file.id);
    if (!previewable(metadata)) throw new Error("Only PDF files can be previewed.");

    const { response } = await fileResponse(metadata);
    closePreview();
    previewObjectUrl = URL.createObjectURL(await response.blob());
    pdfTitle.textContent = metadata.name;
    pdfFrame.src = previewObjectUrl;
    pdfPreview.hidden = false;
    pdfPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    fileStatus.textContent =
      error instanceof Error ? error.message : "Unable to preview this PDF.";
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function downloadFile(file, button) {
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Preparing…";

  try {
    const metadata = await fileMetadata(file.id);
    const { exportFormat, response } = await fileResponse(metadata);

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

async function loadFolder() {
  closePreview();
  fileStatus.textContent = "Loading…";
  fileList.replaceChildren();
  fileCount.textContent = "—";
  folderTitle.textContent = currentFolder().name;
  renderNavigation();

  try {
    renderItems(await listFolder(currentFolder().id));
  } catch (error) {
    fileStatus.textContent =
      error instanceof Error ? error.message : "Unable to load this folder.";
  }
}

function initializeWorkspace() {
  if (!configured()) {
    fileStatus.textContent = "Google access is not configured yet.";
    return;
  }
  if (!accessToken() || accessExpired()) {
    signOut();
    return;
  }
  if (sessionStorage.getItem("portfolio-google-identity-verified") !== "true") {
    signOut();
    return;
  }

  folderPath = [{ id: auth.driveFolderId, name: "Portfolio Private Files" }];
  loadFolder();
}

setTheme(storedTheme || (prefersLight.matches ? "light" : "dark"));
document.querySelector(".theme-toggle").addEventListener("click", () => {
  setTheme(root.dataset.theme === "dark" ? "light" : "dark");
});
document.querySelector("[data-logout]").addEventListener("click", signOut);
document.querySelector("[data-pdf-close]").addEventListener("click", closePreview);
window.addEventListener("pagehide", closePreview);
initializeWorkspace();
