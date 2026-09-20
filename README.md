# Gemini Make

Gemini Make is a local, Node.js-based coding assistant that lets Gemini create and edit files inside a workspace. It supports:

- **API-key mode** with a model locked to the model configured for that key. The CLI rejects per-request model overrides in this mode.
- **Google authentication mode** using Application Default Credentials (ADC), for projects where the Gemini API is enabled.
- A filesystem tool sandbox rooted at the selected workspace.

> **Important billing note:** A Google/Gemini consumer subscription is not a supported way to pay for Gemini API requests. OAuth/ADC API requests are billed to the Google Cloud project associated with the credentials. Gemini Make does not scrape or reuse tokens from the consumer Gemini website or CLI.

## Requirements

- Node.js 20+
- A Gemini API key, or Google Cloud Application Default Credentials
- No Python is required

## Setup

```bash
npm install
npm run build
npm start -- --workspace ./my-project
```

### API-key mode

```bash
export GEMINI_API_KEY="..."
export GEMINI_MODEL="gemini-2.5-flash"
npm start -- --auth api-key --workspace ./my-project
```

The model is fixed when API-key mode starts. `/model` only reports it; it cannot switch to another model.

### Google authentication mode

Set up ADC with `gcloud auth application-default login`, select a Google Cloud project, enable the Gemini API, then run:

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
npm start -- --auth google --workspace ./my-project
```

## Commands

- Type a request such as `create a hello world app`.
- `/help` shows commands.
- `/model` shows the active, immutable model.
- `/workspace` shows the sandbox directory.
- `/clear` clears conversation history.
- `/exit` quits.

Every file operation is constrained to the workspace. The assistant asks for confirmation before writing or deleting files, and symlinks escaping the workspace are rejected.
