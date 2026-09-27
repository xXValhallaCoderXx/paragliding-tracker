import type { ConfigContext, ExpoConfig } from 'expo/config';

/** A named, isolated installation for first-run/permission acceptance. Never replaces pilot data.
 * The optional offline build removes only this QA app's network permission, leaving wireless
 * ADB available. Default builds retain the normal package, scheme and network access. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const qa = process.env.FLIGHT_LOG_QA === 'stage1';
  const offline = qa && process.env.FLIGHT_LOG_QA_OFFLINE === '1';
  return {
    ...config,
    name: qa ? `Flight Log Stage 1 QA${offline ? ' Offline' : ''}` : config.name!,
    slug: config.slug!,
    ...(qa ? { scheme: 'xcmvp-stage1qa', version: '1.0.0-stage1-qa' } : {}),
    android: {
      ...config.android,
      ...(qa ? { package: 'com.xxvalhallacoderxx.xcmvp.stage1qa' } : {}),
      ...(offline ? { blockedPermissions: [...(config.android?.blockedPermissions ?? []), 'android.permission.INTERNET'] } : {}),
    },
  };
};
