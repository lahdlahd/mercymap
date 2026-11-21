# MERCYMAP: AI for Church hackathon submission

Ready to paste into the aiforchurch.com submission form. Every claim here is
built, deployed and tested; nothing describes planned work as done.

## Project name

MERCYMAP

## Tagline

Helping churches turn compassion into coordinated community impact.

## Track

Care & Community

## Description (250 words max)

MERCYMAP gives every church a private workspace for receiving, reviewing and meeting requests for help: food, school costs, medical bills, rent and more.

People in need never create an account. Each verified church shares its own link, where anyone can ask for help in plain words, with a clear consent notice and emergency guidance. Staff can also record requests made in person or by phone.

Claude reads each request and gives staff a short summary, the key facts, what to ask next, an urgency level, a suggested kind of help and, when the request is ready, which of the church's own resources fits and why. A keyword check and the AI can both raise a safeguarding flag; only a person can review and clear it. Names, phone numbers and emails are removed before anything reaches the AI, and the AI never approves, declines or contacts anyone.

Staff approve help against real stock: approving reserves the items in the same step, so a church never promises what it no longer has. Volunteers receive a minimal task brief (by WhatsApp or copy), and every step is recorded in the request's history and an audit log.

Leaders see live figures, low-stock alerts and Reports & Impact with four charts and privacy-safe CSV exports, so a church can show how many people it helped and how quickly.

MERCYMAP is multi-church, with strict separation between churches enforced in the database. Built in Nigeria for African churches first, it works for any congregation.

## Problem it solves for churches

Most churches already help people, but the help runs on WhatsApp messages, notebooks and memory. Requests get lost between services, the same family is helped twice while another is forgotten, a pastor promises food the store no longer has, and sensitive situations (a child not safe at home, an elderly widow eating once a day) depend on whoever happened to read the message. Leaders cannot say how many people the church served or what ran out.

MERCYMAP gives one trusted place for every request, from first message to delivered help, with privacy for the people asking, safeguarding prompts for staff, honest stock, and figures a church can report.

## How AI is used

Each request is analysed by Anthropic's Claude (Claude Haiku 5.5) through a fixed, structured tool so the answer always has the same shape. The AI produces:

- a two-to-three sentence summary staff can read at a glance
- key facts stated in the request (never invented ones)
- questions staff may want to ask next
- an urgency level (low, medium, high)
- a suggested kind of help, which staff can accept in one click
- once a request is ready for matching, which of the church's own resources fits and a plain-language reason
- a safeguarding signal

Analysis starts automatically when a request arrives and can be re-run by staff. Owners and administrators can analyse any requests that arrived while the AI was unavailable with one button. Every AI answer is validated twice (in the application and in the database) before it is shown, and labelled "Check before acting. The AI suggests; people decide."

## Responsible AI & safeguards

- **People decide.** The AI cannot approve, decline, reserve stock, assign volunteers or contact anyone. Accepting its suggested category is an explicit staff action, recorded in history and the audit log.
- **Privacy by design.** Only the description, kind of help, quantity and area are sent to the AI; names, phone numbers and email addresses are removed first. Requesters never need accounts. Exports exclude names, phone numbers and personal descriptions. Request pages are kept out of search engines, and there is no public directory of churches.
- **Safeguarding.** A keyword check (for phrases such as "not safe at home") and the AI can each raise "Needs attention"; only a person can clear it, with a note naming who reviewed it and when.
- **Honest limits.** The public form says plainly that it is not an emergency service and that automated tools may help staff read requests. If the AI is unavailable, everything else keeps working and requests wait for analysis.
- **Accuracy.** The prompt tells the AI to use only what the person wrote; outputs are schema-checked, length-limited and stored with the model and prompt version.
- **Cost and abuse controls.** Cloudflare Turnstile, rate limits and a daily AI cap protect the service.
- **Faithful purpose.** Built around Matthew 25:40, to help churches serve "the least of these" with dignity, care and good stewardship.

## Tech stack / tools used

Next.js 16 (App Router), TypeScript, Tailwind CSS, Supabase (PostgreSQL, Auth, Row Level Security), Zod, Recharts, Anthropic Claude (Haiku 5.5) via the Messages API, Cloudflare Turnstile, Brevo SMTP, Vercel. Tested with Node's test runner against PostgreSQL (301 database tests, including tenant-isolation and permission tests), Vitest (186 unit tests), Puppeteer (9 end-to-end journeys, 480 checks) and axe-core accessibility checks. Built with AI assistance (Claude).

## Work period confirmation

All MERCYMAP work was done between 14 and 27 November 2026, inside the
30 October to 27 November build window. Tick the confirmation box.

## Links

- Live demo: https://mercymap.vercel.app
- Code repository: https://github.com/lahdlahd/mercymap
- Demo video: (add the YouTube, Vimeo or Loom link after recording)

## Demo account (private to judges)

Use the **administrator** of the fictional demo church Hope Harvest Chapel:
username `tundabed@gmail.com`, and its password. An administrator can do
everything a judge needs (requests, approvals, volunteers, reports, exports,
re-running AI) but cannot change staff roles. All demo data is fictional.

## Screenshots (up to 5)

Take these on https://mercymap.vercel.app, signed in as the demo church:

1. The home page with Matthew 25:40.
2. A request page showing the AI suggestions panel with a suggested resource
   (the student nurse request, awaiting match).
3. The safeguarding flag on the teenage-girl request.
4. The Overview with its figures.
5. Reports & Impact with the four charts (Last 365 days).
