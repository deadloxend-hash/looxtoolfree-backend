# Authentication email templates

Prepared templates; not installed in Supabase and no email was sent. Do not describe welcome or security mail as active before wiring and testing their supported provider events.

Use confirm-email, recover-password and email-change in the corresponding Supabase email template slots. Keep `{{ .ConfirmationURL }}` intact; do not substitute an untrusted URL or print raw tokens. Configure secure email-change confirmation for both old and new addresses. Native password-change/MFA/provider-connection notifications may use the generic security template only in their correct supported slots after reviewing event wording. Welcome delivery requires a supported verified-signup trigger; this template alone does not create one.

Configure a verified LOOX sending domain with its provider-supplied SPF and DKIM records and an appropriate DMARC policy. No sending domain, credentials or mailbox was invented. Do not change the separate MediaGrab domain. Test expiry, link rewriting, one-time use, mobile readability, spam delivery and lookalike links with controlled addresses before activation. Supabase default mail limits and breached-password protection plan requirements still apply.
