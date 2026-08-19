/**
 * Legal surfaces the stores require once the app collects anything off-device.
 *
 * Both must be reachable *before* sign-in: App Review taps them while signed out, and
 * Play Console additionally requires a web-accessible account deletion URL of its own,
 * declared in the console rather than here.
 *
 * These are placeholders until the pages are published. `legalLinksReady` is what the UI
 * checks, so an unpublished URL is simply not offered rather than shipping a dead link.
 */
export const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? '';
export const ACCOUNT_DELETION_URL = process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL ?? '';

export const privacyPolicyReady = PRIVACY_POLICY_URL.length > 0;
