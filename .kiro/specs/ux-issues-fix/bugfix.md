# Bugfix Requirements Document

## Introduction

Multiple UX issues reported by users of the Internal Repos portal that degrade usability: incorrect template dates, truncated project names in card grids, AI tag suggestion limited to existing registry only, architecture images opening new tabs instead of in-page lightbox, and no upload affordance on the projects page. These issues collectively make the application harder to use and less discoverable.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN templates `chatbot-rag-agentcore` or `chatbot-rag-mantle` are displayed THEN the system shows "1 year ago" because their metadata.json files contain the typo date `"2025-07-14"` instead of the correct year

1.2 WHEN any project or template card displays a date THEN the system shows only a relative date string (e.g. "2 weeks ago") with the actual ISO date hidden in a `title` attribute, requiring hover to see the exact date

1.3 WHEN project or template names are longer than the card width (e.g. "chatbot-rag-scalability-improvements") THEN the system truncates the name with ellipsis due to `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` combined with `aspect-ratio: 1` on cards, making projects indistinguishable

1.4 WHEN the AI tag suggestion system (`suggest-tags.ts`) analyzes a project README THEN the system only suggests tags that already exist in the tag registry, because the prompt instructs "Only suggest tags from the available tags list" and the response is filtered to registry-only tags

1.5 WHEN a user clicks on an architecture diagram image in the template detail page THEN the system opens the full-size image in a new browser tab (`target="_blank"`) instead of showing it in-page

1.6 WHEN a user is on the projects page (`#/projects`) THEN the system provides no upload affordance — the upload action is only accessible via a separate nav item linking to `#/upload`, requiring users to navigate away from their current context

### Expected Behavior (Correct)

2.1 WHEN templates `chatbot-rag-agentcore` or `chatbot-rag-mantle` are displayed THEN the system SHALL show the correct relative date based on an accurate creation date (fix the typo from `2025-07-14` to `2026-07-14` in both metadata.json files)

2.2 WHEN any project or template card displays a date THEN the system SHALL show both the relative date and the actual date in a visible format (e.g. "2 weeks ago · 2026-07-01") without requiring hover interaction

2.3 WHEN project or template names are longer than the card width THEN the system SHALL allow the name to wrap to multiple lines so the full name is visible, by removing the `aspect-ratio: 1` constraint on cards and replacing `white-space: nowrap` with text wrapping on the name element

2.4 WHEN the AI tag suggestion system analyzes a project README THEN the system SHALL be able to propose new tags that do not yet exist in the registry, clearly distinguishing them from existing registry tags in the response (e.g. via a separate `newTags` field or a flag per tag)

2.5 WHEN a user clicks on an architecture diagram image in the template detail page THEN the system SHALL display the image in an in-page lightbox/modal overlay with a close mechanism, instead of opening a new tab

2.6 WHEN a user is on the projects page (`#/projects`) THEN the system SHALL display an upload button/affordance (e.g. a prominent "Upload" button) that either navigates to the upload form or opens it in context, providing discoverability without requiring the user to find the nav item

2.7 WHEN the AI tag suggestion system proposes new tags that do not exist in the registry, AND those tags are submitted with the upload, THEN the Lambda SHALL persist the new AI-suggested tags to the `tags.json` registry in S3 using the existing `addTagsToRegistry()` function (same as manually-created new tags)

2.8 THE `tags.json` file SHALL be removed from the repository root and added to `.gitignore`, since the tag registry is managed exclusively in S3 by the Lambda and is never deployed from the repo

2.9 THE CI/CD pipeline "Ensure tag registry exists" step SHALL remain unchanged — it creates an empty `tags.json` in S3 only if one doesn't exist, serving as initialization for new deployments

### Unchanged Behavior (Regression Prevention)

3.1 WHEN templates other than `chatbot-rag-agentcore` and `chatbot-rag-mantle` are displayed THEN the system SHALL CONTINUE TO show their correct relative dates based on their existing metadata.json date values

3.2 WHEN a date is displayed in the template detail page (not on cards) THEN the system SHALL CONTINUE TO show the relative date with the `datetime` attribute on the `<time>` element

3.3 WHEN project or template names are short enough to fit on one line THEN the system SHALL CONTINUE TO display them on a single line without unnecessary wrapping

3.4 WHEN the AI tag suggestion system suggests tags that exist in the registry THEN the system SHALL CONTINUE TO return those tags as valid suggestions (existing behavior for registry tags must be preserved)

3.5 WHEN an architecture image fails to load (onerror) THEN the system SHALL CONTINUE TO remove the architecture section from the DOM

3.6 WHEN a user navigates to `#/upload` directly via the nav item or URL THEN the system SHALL CONTINUE TO render the upload form on the dedicated upload page as before

3.7 WHEN the card grid renders with the responsive breakpoints (1 col on mobile, 2 on sm, 4 on md+) THEN the system SHALL CONTINUE TO use the same responsive grid layout

3.8 WHEN a user manually creates a new tag via the tag-selector "Add new tag" input THEN the system SHALL CONTINUE TO support manual tag creation with the existing validation rules

3.9 WHEN manually-created new tags are submitted during upload THEN the Lambda SHALL CONTINUE TO persist them via `addTagsToRegistry()` to the S3 `tags.json` (existing behavior)

3.10 THE frontend `fetchTagRegistry()` function SHALL CONTINUE TO fetch `tags.json` from the CDN URL (reads from S3 via CloudFront) without any changes
