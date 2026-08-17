import type {
  FlightDetail,
  FlightMetadataPatch,
  FlightRepository,
  FlightSummary,
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
