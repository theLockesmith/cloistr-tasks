#!/usr/bin/env node
// backend/scripts/generate-vapid-keys.js
//
// Generates a VAPID key pair for browser push notifications and prints the
// env vars to paste into .env / the deployment secret. Run once per
// environment — the same key pair must stay stable across restarts, since
// every stored push_subscriptions row is tied to the public key the browser
// subscribed with.
//
//   node scripts/generate-vapid-keys.js

import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('VAPID keys generated. Add these to your environment:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:notifications@cloistr.xyz');
console.log('\nKeep VAPID_PRIVATE_KEY secret. Regenerating these keys invalidates every');
console.log('existing browser subscription — users will need to re-enable notifications.');
