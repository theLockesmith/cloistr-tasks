// src/lib/serviceConfig.js - service addresses for this deployment
//
// Resolved once, at import, by the shared reader: the container's
// /config.js (loaded by a classic script tag in index.html, so it has run
// before any module), then VITE_* build vars, then production defaults.
// Every production hostname this frontend talks to, directly or through a
// shared component, comes from here so one image can serve production and
// staging. See docs/runtime-config-adoption.md in cloistr-collab-common.
import { getServiceConfig } from '@cloistr/collab-common/config';

export const serviceConfig = getServiceConfig();
