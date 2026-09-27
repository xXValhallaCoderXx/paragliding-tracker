import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Named isolated installations for acceptance. Stages 2–4 retain INTERNET;
 * only the Stage 1 setup-only flavor supports removing that permission. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const stage = process.env.FLIGHT_LOG_QA;
  const qa = stage === 'stage1' || stage === 'stage2' || stage === 'stage3' || stage === 'stage4';
  const offline = stage === 'stage1' && process.env.FLIGHT_LOG_QA_OFFLINE === '1';
  return {
    ...config,
    name: qa ? `Flight Log Stage ${stage!.slice(-1)} QA${offline ? ' Offline' : ''}` : config.name!,
    slug: config.slug!,
    ...(qa ? { scheme: `xcmvp-${stage}qa`, version: `1.0.0-${stage}-qa` } : {}),
    android: {
      ...config.android,
      ...(qa ? { package: `com.xxvalhallacoderxx.xcmvp.${stage}qa` } : {}),
      ...(offline ? { blockedPermissions: [...(config.android?.blockedPermissions ?? []), 'android.permission.INTERNET'] } : {}),
    },
  };
};
