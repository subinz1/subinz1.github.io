# Private portfolio access

This Worker verifies the custom account credentials, creates an eight-hour
session token, and streams files from a restricted Google Drive folder. It is
designed to run separately from the public GitHub Pages site.

Set these values as Worker secrets, never Git variables or public website code:

- `PORTFOLIO_USERNAME`
- `PORTFOLIO_PASSWORD`
- `PORTFOLIO_SESSION_SECRET`
- `ALLOWED_ORIGIN`
- `DRIVE_FOLDER_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` is the `private_key` value from the
service-account JSON key. Share the Drive folder with that service account's
email using Viewer access. The service account needs only the Google Drive API
and permission to this one folder.

After deploying the Worker, add its public URL to `auth-config.js`; the URL is
not a secret. Private files remain in Drive, never in this repository or the
GitHub Pages directory.
