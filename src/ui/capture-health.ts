import type { FlightSummary, RecorderSnapshot } from '@/recorder/types';

export interface CapturePresentation {
  label: string;
  tone: 'neutral' | 'good' | 'warning' | 'danger';
  title: string;
  description: string;
}

export interface UnfinishedFlightPresentation {
  label: string;
  tone: 'neutral' | 'danger';
  opensRecorder: true;
}

export function capturePresentation(
  snapshot: Pick<RecorderSnapshot, 'captureHealth' | 'state'>,
): CapturePresentation {
  if (snapshot.state === 'interrupted' || snapshot.captureHealth === 'failed') {
    return {
      label: 'NEEDS ATTENTION',
      tone: 'danger',
      title: 'Flight needs attention',
      description: 'GPS capture stopped. Resume if you are still flying, or save a partial flight.',
    };
  }

  if (snapshot.state === 'stopping') {
    return {
      label: 'SAVING',
      tone: 'neutral',
      title: 'Saving your flight',
      description: 'The recorder is finishing the local track and flight stats.',
    };
  }

  if (snapshot.captureHealth === 'recovering') {
    return {
      label: 'RECOVERING',
      tone: 'warning',
      title: 'Restoring GPS capture',
      description: 'The app is restarting location capture and waiting for a new valid fix.',
    };
  }

  if (snapshot.state === 'arming' || snapshot.captureHealth === 'starting') {
    return {
      label: 'STARTING GPS',
      tone: 'neutral',
      title: 'Starting GPS capture',
      description: 'Waiting for a fresh location callback and a valid GPS fix.',
    };
  }

  if (snapshot.state === 'recording' && snapshot.captureHealth === 'healthy') {
    return {
      label: 'RECORDING',
      tone: 'good',
      title: 'Recording your flight',
      description: 'Fresh location callbacks and valid GPS fixes are reaching the flight log.',
    };
  }

  if (snapshot.state === 'recording' && snapshot.captureHealth === 'stale') {
    return {
      label: 'GPS STALE',
      tone: 'warning',
      title: 'GPS updates are delayed',
      description: 'No recent valid GPS fix is reaching the log. Keep the phone clear of obstructions.',
    };
  }

  if (snapshot.state === 'recording') {
    return {
      label: 'NEEDS ATTENTION',
      tone: 'danger',
      title: 'GPS capture is not active',
      description: 'The flight is open, but GPS capture is not currently producing fixes.',
    };
  }

  return {
    label: 'READY',
    tone: 'neutral',
    title: 'Ready to fly?',
    description: 'Start just before launch, then stop after landing.',
  };
}

export function captureAgeLabel(timestamp: number | null, now: number): string {
  if (timestamp === null) return 'none yet';
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 1_000) return 'just now';
  const seconds = Math.floor(ageMs / 1_000);
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ago`;
}

export function unfinishedFlightPresentation(
  sessionStatus: FlightSummary['sessionStatus'],
): UnfinishedFlightPresentation | null {
  if (sessionStatus === 'interrupted') {
    return { label: 'Needs attention', tone: 'danger', opensRecorder: true };
  }
  if (sessionStatus === 'recording') {
    return { label: 'Recording in progress', tone: 'neutral', opensRecorder: true };
  }
  return null;
}
