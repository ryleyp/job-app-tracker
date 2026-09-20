# Job Application Tracker

A lightweight web app for tracking job applications and how each one is going. It runs entirely in the browser with no build step, no account, and no server. Your data stays in your browser and can be exported to or imported from a JSON file at any time.

## Features

- **Track every application** with company, role, job posting link, status, date applied, location, work type, salary range, source, contact, follow-up date, priority, and notes.
- **Link the resume you used** for each application, with a label like "CSM Resume v3" and a link to the file.
- **Paste the full job description** into each application so you still have it after the posting is taken down. It is searchable and can be copied from the Details view.
- **Nine pipeline stages**: Saved, Applied, Phone Screen, Interviewing, Offer, Accepted, Rejected, Withdrawn, and Ghosted.
- **Status history** is recorded automatically every time an application moves stages, so you can see exactly how each one progressed.
- **Dashboard** with total and active counts, response rate, interview count, offers, and follow-ups that are due or overdue.
- **Pipeline chart** that doubles as a filter. Click a stage to show only those applications.
- **Search, filter, and sort** by company, status, date applied, next follow-up, or pipeline order.
- **Import JSON** with merge, append, or replace modes. Export to **JSON** for backups or **CSV** for spreadsheets.
- **Light and dark themes** that follow your system setting, with a manual toggle.
- Works on desktop and mobile.

## Getting Started

### Option 1: Open the file

Download or clone this repository and open `index.html` in any modern browser. Everything works except the "Load sample data" link, which needs the app to be served over http.

### Option 2: Run a local server

```bash
git clone https://github.com/ryleyp/job-app-tracker.git
cd job-app-tracker
python3 -m http.server 8080
```

Then visit http://localhost:8080.

### Option 3: GitHub Pages

This repository includes a workflow that publishes the app to GitHub Pages on every push to `main`. Enable Pages in the repository settings (Source: GitHub Actions) and the app will be available at `https://ryleyp.github.io/job-app-tracker/`.

## Using the App

1. Click **Add Application** (or press `n`) and fill in the details. Only company and role are required. Paste the job posting into the **Job Description** box to keep a copy, and add the resume you used under **Resume Used** and **Resume Link**.
2. Change an application's status straight from its card using the dropdown. The change is added to its history.
3. Click **Details** to see the full record, including status history, or **Edit** to update anything.
4. Set a **Next Follow-Up** date and the dashboard will flag it when it is due or overdue.
5. Use **Export JSON** regularly to back up your data, and **Import JSON** to restore it or move it to another device.

## JSON Format

Exports look like this. Only `company` and `role` are required when importing; everything else is optional and will be filled with sensible defaults.

```json
{
  "app": "job-app-tracker",
  "version": 1,
  "exportedAt": "2026-09-20T12:00:00.000Z",
  "applications": [
    {
      "id": "3f1c2a9e-1234-4b5c-9def-0123456789ab",
      "company": "Northwind Software",
      "role": "Customer Success Manager",
      "link": "https://example.com/jobs/csm",
      "status": "Interviewing",
      "dateApplied": "2026-09-02",
      "location": "Austin, TX",
      "workType": "Hybrid",
      "salary": "$95k to $110k",
      "source": "LinkedIn",
      "contactName": "Jordan Lee",
      "contactEmail": "jordan.lee@example.com",
      "resumeName": "CSM Resume v3",
      "resumeLink": "https://drive.google.com/file/d/example",
      "followUpDate": "2026-09-24",
      "priority": "High",
      "notes": "Second round on Thursday.",
      "description": "Full text of the job posting, pasted in.",
      "createdAt": "2026-09-02T14:10:00.000Z",
      "updatedAt": "2026-09-18T09:30:00.000Z",
      "history": [
        { "status": "Applied", "at": "2026-09-02T14:10:00.000Z" },
        { "status": "Interviewing", "at": "2026-09-18T09:30:00.000Z" }
      ]
    }
  ]
}
```

A bare JSON array of application objects also imports fine. The importer accepts a few common aliases too: `name` or `employer` for `company`, `title` or `position` for `role`, and `url` for `link`.

| Field | Values |
| --- | --- |
| `status` | `Saved`, `Applied`, `Phone Screen`, `Interviewing`, `Offer`, `Accepted`, `Rejected`, `Withdrawn`, `Ghosted` |
| `workType` | `Remote`, `Hybrid`, `On-site`, or empty |
| `priority` | `High`, `Medium`, `Low` |
| `dateApplied`, `followUpDate` | `YYYY-MM-DD` |
| `createdAt`, `updatedAt`, `history[].at` | ISO 8601 timestamps |

### Import modes

- **Merge** keeps your existing applications and adds or updates the imported ones by `id`. When both sides have the same `id`, the most recently updated copy wins and status histories are combined.
- **Append** adds every imported application as a new record with a fresh `id`.
- **Replace** deletes everything and loads only the file.

## Project Layout

```
index.html        Markup and dialogs
styles.css        Styling, including light and dark themes
app.js            All application logic
sample-data.json  Example export you can load from the footer
```

## Privacy

Nothing leaves your browser. There is no analytics, no network calls except loading the sample data file, and no backend. Clearing your browser's site data will erase the tracker, so keep a JSON export somewhere safe.
