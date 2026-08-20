import type {
  AppSettings,
  AppSettingsPatch,
  AppSettingsRepository,
  FlightDetail,
  FlightMetadataPatch,
  FlightRepository,
  FlightSummary,
  PilotProfile,
  PilotProfilePatch,
  PilotProfileRepository,
} from './types';

function unsupported(): never {
  throw new Error('The local flight logbook is only available in the installed mobile app.');
}

export const flightRepository: FlightRepository = {
  listFlights: async (): Promise<FlightSummary[]> => unsupported(),
  getFlight: async (_flightId: string): Promise<FlightDetail | null> => unsupported(),
  updateFlight: async (
    _flightId: string,
    _patch: FlightMetadataPatch,
  ): Promise<FlightDetail> => unsupported(),
  deleteFlight: async (_flightId: string): Promise<void> => unsupported(),
};

export const pilotProfileRepository: PilotProfileRepository = {
  getProfile: async (): Promise<PilotProfile> => unsupported(),
  updateProfile: async (_patch: PilotProfilePatch): Promise<PilotProfile> => unsupported(),
};

export const appSettingsRepository: AppSettingsRepository = {
  getSettings: async (): Promise<AppSettings> => unsupported(),
  updateSettings: async (_patch: AppSettingsPatch): Promise<AppSettings> => unsupported(),
};
