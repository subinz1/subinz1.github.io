# Private portfolio access

This Worker verifies the custom account credentials, creates an eight-hour
session token, and streams files from the private R2 bucket. It is designed to
run separately from the public GitHub Pages site.

Keep these values out of Git:

- `PORTFOLIO_USERNAME`
- `PORTFOLIO_PASSWORD`
- `PORTFOLIO_SESSION_SECRET`
- `ALLOWED_ORIGIN`

Create the R2 bucket named in `wrangler.toml`, then set the first three values
as Worker secrets. Set `ALLOWED_ORIGIN` to the public portfolio origin. After
deploying the Worker, place its public URL in `auth-config.js`; the URL is not
a secret.

Private downloads belong in the R2 bucket, never in this repository or the
GitHub Pages directory.
