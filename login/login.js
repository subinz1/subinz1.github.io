const root = document.documentElement;
const storedTheme = localStorage.getItem("theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");
const auth = window.PORTFOLIO_AUTH || {};
const driveScope = "https://www.googleapis.com/auth/drive.readonly";
const requiredScope = `openid email ${driveScope}`;
const signInButton = document.querySelector("[data-google-login]");
const loginStatus = document.querySelector("[data-login-status]");

function setTheme(theme) {
  root.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

function configured() {
  return [auth.googleClientId, auth.driveFolderId].every(
    (value) => typeof value === "string" && value.length > 0
  );
}

function setStatus(message) {
  loginStatus.textContent = message;
}

function signOut() {
  sessionStorage.removeItem("portfolio-google-access-token");
  sessionStorage.removeItem("portfolio-google-access-expires-at");
  sessionStorage.removeItem("portfolio-google-identity-verified");
}

async function signedInUser(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await response.json().catch(() => null);
  if (!response.ok || typeof profile?.email !== "string") {
    throw new Error("Google could not verify this account.");
  }
  return profile;
}

function revoke(accessToken) {
  window.google.accounts.oauth2.revoke(accessToken, () => {});
}

async function handleToken(response) {
  if (response.error || !response.access_token) {
    setStatus(response.error_description || "Google sign-in was not completed.");
    signInButton.disabled = false;
    return;
  }

  try {
    const profile = await signedInUser(response.access_token);
    if (!profile.email_verified) {
      revoke(response.access_token);
      throw new Error("Google could not verify this account.");
    }

    sessionStorage.setItem("portfolio-google-access-token", response.access_token);
    sessionStorage.setItem(
      "portfolio-google-access-expires-at",
      String(Date.now() + Number(response.expires_in || 0) * 1000)
    );
    sessionStorage.setItem("portfolio-google-identity-verified", "true");
    window.location.assign("../private/");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to verify Google access.");
    signInButton.disabled = false;
  }
}

function startGoogleSignIn() {
  if (!configured()) {
    setStatus("Google access is not configured yet.");
    return;
  }
  if (!window.google?.accounts?.oauth2) {
    setStatus("Google sign-in is still loading. Please try again.");
    return;
  }

  signInButton.disabled = true;
  setStatus("Choose a Google account to continue…");
  const tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: auth.googleClientId,
    scope: requiredScope,
    callback: handleToken,
    error_callback: () => {
      setStatus("Google sign-in was not completed.");
      signInButton.disabled = false;
    },
  });
  tokenClient.requestAccessToken({ prompt: "select_account consent" });
}

setTheme(storedTheme || (prefersLight.matches ? "light" : "dark"));
document.querySelector(".theme-toggle").addEventListener("click", () => {
  setTheme(root.dataset.theme === "dark" ? "light" : "dark");
});
signOut();
signInButton.addEventListener("click", startGoogleSignIn);
