# Internal Repos Project — Architecture

## Overview

Internal tool for employees to search and browse past company projects. Static frontend hosted on S3 + CloudFront, serverless upload endpoint, and auto-generated search index.

## S3 Bucket Structure

```
S3 Bucket (static website hosting)
├── index.html              # SPA entry point
├── global-index.json       # Auto-generated manifest of all projects
└── projects/
    └── {project-name}/
        ├── readme.md       # Rendered with marked + highlight.js
        ├── metadata.json   # name, description, tags, date
        └── artifact.zip    # Direct S3 download link
```

## Components

### Frontend (S3 + CloudFront)

| Concern | Choice |
|---------|--------|
| Framework | Vanilla JS or lightweight SPA (Svelte/Vue) built with Vite |
| Search | Fuse.js — client-side fuzzy matching on tags + project name |
| Markdown | marked + highlight.js — renders READMEs with syntax-highlighted code blocks |
| HTTPS / Domain | CloudFront in front of S3 |
| Upload page | Form: project name, tags, readme (textarea) + folder drag-drop / `webkitdirectory` input to upload source files directly |

### Upload Flow (Serverless)

```
Browser (project folder upload)
    │
    ▼
API Gateway ──> Lambda
                  ├── Parses .gitignore (if present) to filter files
                  ├── Applies hardcoded deny-list
                  ├── Zips remaining files into artifact.zip
                  ├── Writes to S3:
                  │   ├── projects/{name}/artifact.zip
                  │   ├── projects/{name}/readme.md
                  │   └── projects/{name}/metadata.json
                  └── Regenerates global-index.json by scanning all metadata.json files
```

- **API Gateway** — single POST endpoint
- **Lambda (Node.js)** — receives raw project files (no pre-zipping needed), zips them server-side with `archiver`, filters with the `ignore` package, and writes to S3. Using JS throughout ensures a single maintenance pattern across frontend and backend.
- **Artifact filtering** — Lambda parses `.gitignore` to respect existing ignore rules, plus a hardcoded deny-list:
  ```
  .git/
  .terraform/
  node_modules/
  __pycache__/
  .env, .env.*
  *.pyc
  .DS_Store
  ```
- **Auth** — shared API key (API Gateway) or Cognito for per-user access

### CI/CD

**Tool:** GitHub Actions or Azure Pipelines (TBD internally)

**Scope:** Both application code and infrastructure changes are managed through the pipeline.

```
Push to main ──> CI/CD Pipeline
                   ├── terraform plan/apply    # Infra (S3, CloudFront, API Gateway, Lambda)
                   ├── npm run build           # Build frontend
                   ├── aws s3 sync ./dist s3://bucket
                   └── aws cloudfront create-invalidation --paths "/*"
```

### Adding Projects — Two Workflows

| Flow | How it works |
|------|-------------|
| **Via UI** | Upload form → API Gateway → Lambda → S3 + index rebuild |
| **Via pipeline** | PR with new project files → GH Action validates + deploys to S3 + rebuilds index |

## Service Summary

| Service | Purpose |
|---------|---------|
| S3 | Hosting + artifact storage |
| CloudFront | HTTPS, caching, custom domain |
| Lambda + API Gateway | Upload handler (only needed when adding projects) |
| GitHub Actions | CI/CD for frontend deployment |

## Cost

Effectively $0 for a small team — Lambda free tier, S3 pennies, CloudFront pennies. No servers, no databases, no containers.
