# Internal Repos

Internal tool for employees to search and browse past company projects. Upload project files through a web UI or CI pipeline, and the system generates a searchable index with downloadable artifact archives.

## Stack

- **Frontend** — Vanilla TypeScript SPA built with Vite, hosted on S3 + CloudFront. Uses Fuse.js for client-side fuzzy search and `marked` + `highlight.js` for README rendering.
- **Backend** — AWS Lambda behind API Gateway. Receives uploads, filters files (respects `.gitignore` + hardcoded deny-list), zips artifacts with `archiver`, writes to S3, and regenerates the global search index.
- **Infrastructure** — Terraform (S3, CloudFront, API Gateway, Lambda).
- **CI/CD** — GitHub Actions for deployment.

## Project Structure

```
├── frontend/     # Vite SPA (search, upload form, project detail)
├── lambda/       # Upload handler (filter, zip, write to S3)
├── shared/       # Types and constants shared between frontend & lambda
├── infra/        # Terraform configuration
└── .github/      # CI/CD workflows
```

## Getting Started

```bash
# Install dependencies (npm workspaces)
npm install

# Build all packages
npm run build

# Run tests
npm test
```

## How It Works

1. A user uploads project files (name, tags, readme, source files) via the web UI.
2. The Lambda filters out ignored files, creates `artifact.zip`, and writes it along with `metadata.json` and `readme.md` to S3 under `projects/{name}/`.
3. The Lambda regenerates `global-index.json` by scanning all project metadata.
4. The frontend fetches the index and provides fuzzy search across project names, descriptions, and tags.

## Development

The repo is organized as an npm workspace with three packages:

| Package | Description |
|---------|-------------|
| `frontend` | Vite-powered SPA |
| `lambda` | Node.js Lambda handler |
| `shared` | Shared TypeScript types and constants |

Tests use Vitest and can be run from the root with `npm test`.
