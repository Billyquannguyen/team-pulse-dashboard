# GitHub Secrets Checklist

Go to:

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret

Add these exactly:

- [ ] `GMAIL_CLIENT_ID`
- [ ] `GMAIL_CLIENT_SECRET`
- [ ] `GMAIL_REFRESH_TOKEN`
- [ ] `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- [ ] `GOOGLE_PRIVATE_KEY`
- [ ] `OPPORTUNITY_DATABASE_SPREADSHEET_ID`
- [ ] `EMAIL_PROVIDER_API_KEY`
- [ ] `MONTHLY_REFRESH_EMAIL_TO`
- [ ] `MONTHLY_REFRESH_EMAIL_FROM`
- [ ] `DISCORD_WEBHOOK_URL`

`DISCORD_WEBHOOK_URL` is optional.

After all secrets are added:

1. Open Actions.
2. Open Monthly Opportunity Intelligence Refresh.
3. Run notification test only.
4. If that passes, run full workflow when ready.
