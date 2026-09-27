# Privacy

Hytic is designed to process imported photos on your device. This document describes the behavior of the open-source application in this repository; a hosted or modified deployment may have different infrastructure and policies.

## Photos and project data

- Imported image pixels are decoded and rendered locally in the browser or Windows desktop app. Hytic does not require uploading photos to a remote rendering service.
- Hytic stores imported media copies, project records, edit state, previews, and related local project data in browser-managed storage (OPFS when available, with IndexedDB or in-memory fallbacks) or the desktop app's local WebView storage.
- Hytic does not overwrite the source photo. Moving or changing a source file outside Hytic does not update the copy already stored in a project.
- Clearing browser site data or the desktop app's local storage can remove local projects. Keep backups of original media and any project data you need.
- Exported images and look files are created locally and saved through the browser or operating system's normal download flow.

## Application delivery

Running the browser app requires downloading application code, fonts, images, and other assets from the host. Those requests are separate from the editor's local photo processing. The application is open source, so deployments can be inspected in the source.

## Device and browser limits

Local processing does not protect information from other software on your device, browser extensions, shared operating-system accounts, or a compromised device. Browser storage can be cleared by the user, browser, or operating system. Use a trusted device and keep independent backups.

## Changes

This policy may change as the application changes. Check the repository's current version before relying on a particular deployment's behavior.
