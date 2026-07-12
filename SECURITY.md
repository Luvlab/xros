# Security Policy

We take the security of XR Search seriously and appreciate responsible
disclosure from the community.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately by email to **g@luvlab.io**. Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept, affected URLs/routes, or code paths)
- Any suggested remediation, if you have one

We'll acknowledge your report as promptly as we can, keep you updated on our
progress, and credit you once a fix ships — unless you'd prefer to remain
anonymous. Please give us a reasonable window to address the issue before any
public disclosure.

## Supported Versions

XR Search is under active development. Security fixes are applied to the latest
release on the `main` branch. Older versions are not maintained — please update
to the latest version to receive security fixes.

| Version        | Supported          |
| -------------- | ------------------ |
| `main` (latest) | :white_check_mark: |
| Older releases | :x:                |

## BYOK (Bring-Your-Own-Key) AI Model

XR Search uses a **bring-your-own-key** model for AI features: users supply
their own AI provider API key, which is stored in the browser's
`localStorage` and sent directly from the client to the AI provider.

This is convenient for local and personal use, but it has an important
implication for anyone running a **hosted / multi-user deployment**:

- Keys in `localStorage` are accessible to any JavaScript running on the page.
  A cross-site scripting (XSS) flaw, a malicious dependency, or a compromised
  ad/creative could exfiltrate a user's key.
- Never ship your own provider key to the client. Any key that reaches the
  browser should be considered exposed.

**Recommendation for hosted deployments:** proxy AI calls **server-side**
rather than exposing keys in the browser. Keep provider keys on the server
(e.g. a Supabase edge function or other backend), authenticate your users, and
apply rate limiting and usage controls at the proxy. Reserve the BYOK
localStorage flow for local or single-user setups where the user owns and
controls their own key.

If you discover a way that keys or user data could leak, please report it via
the process above.
