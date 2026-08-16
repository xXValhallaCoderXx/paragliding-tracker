import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { LOCATION_TASK_NAME } from './config';
import { getUnfinishedSession, persistLocationBatch, recordEvent } from './database.native';

interface LocationTaskData {
  locations?: Location.LocationObject[];
}

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask<LocationTaskData>(
    LOCATION_TASK_NAME,
    async ({ data, error, executionInfo }) => {
      const receivedAt = Date.now();
      if (error) {
        const session = await getUnfinishedSession();
        if (session) {
          await recordEvent(session.id, 'location_task_error', receivedAt, {
            code: error.code,
            message: error.message,
            eventId: executionInfo.eventId,
          });
        }
        return;
      }

      const locations = data?.locations ?? [];
      await persistLocationBatch({
        callbackId: executionInfo.eventId,
        receivedAt,
        locations,
      });
    },
  );
}
