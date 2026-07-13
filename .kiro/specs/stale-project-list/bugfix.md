# Bugfix Requirements Document

## Introduction

The project list on the front page does not update after add, edit, or delete operations. The `global-index.json` file is correctly regenerated in S3, but users continue to see stale data until a new deployment occurs. This is caused by two layers: CloudFront caching serves stale versions of the index file, and the frontend's in-memory flag prevents re-fetching the index within a single page session.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a project is added via the upload form THEN the system does not show the new project on the home page list until a new deployment or CloudFront cache expiry (up to 1 hour)

1.2 WHEN a project is deleted via the delete dialog THEN the system continues to show the deleted project on the home page list until a new deployment or CloudFront cache expiry

1.3 WHEN a project's metadata is edited via the edit form THEN the system does not reflect the updated name, description, or tags on the home page list until a new deployment or CloudFront cache expiry

1.4 WHEN a user navigates back to the home page after a successful add/edit/delete within the same session THEN the system does not re-fetch the index because `searchIndexLoaded` remains true

### Expected Behavior (Correct)

2.1 WHEN a project is added via the upload form THEN the system SHALL display the new project on the home page list upon next navigation to the home page without requiring a deployment

2.2 WHEN a project is deleted via the delete dialog THEN the system SHALL remove the project from the home page list upon next navigation to the home page without requiring a deployment

2.3 WHEN a project's metadata is edited via the edit form THEN the system SHALL reflect the updated metadata on the home page list upon next navigation to the home page without requiring a deployment

2.4 WHEN `global-index.json` is written to S3 by the index generator THEN the system SHALL set `Cache-Control: no-cache, must-revalidate` metadata on the object so CloudFront revalidates with the origin on each request

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user loads the home page for the first time in a session THEN the system SHALL CONTINUE TO fetch and display the project index normally

3.2 WHEN a user performs a search query on the home page THEN the system SHALL CONTINUE TO return fuzzy-matched results from the loaded index

3.3 WHEN a user navigates to a project detail page THEN the system SHALL CONTINUE TO display project metadata and readme correctly

3.4 WHEN the index generator scans S3 for metadata files THEN the system SHALL CONTINUE TO correctly aggregate all valid project entries into global-index.json

3.5 WHEN CloudFront serves other static assets (HTML, CSS, JS, project artifacts) THEN the system SHALL CONTINUE TO cache them with the existing TTL policy
