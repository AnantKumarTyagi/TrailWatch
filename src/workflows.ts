import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
} from '@temporalio/workflow';
import type * as activities from './activities';
import type { HikerSession, Coordinates } from './activities';

const {
  fetchTrailWeather,
  buildRescuePacket,
  notifyEmergencyContact,
  sendStandDownNotification,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2 seconds',
    maximumAttempts: 5,
  },
});

export const checkInSafeSignal = defineSignal('checkInSafe');
export const updateLocationSignal = defineSignal<[Coordinates]>('updateLocation');
export const getHikerStatusQuery = defineQuery<string>('getHikerStatus');

export async function trailWatchWorkflow(session: HikerSession): Promise<string> {
  let isHikerSafe = false;
  let alertDispatched = false;
  const state: HikerSession = { ...session };

  setHandler(checkInSafeSignal, () => {
    isHikerSafe = true;
  });

  setHandler(updateLocationSignal, (coords: Coordinates) => {
    state.lastCoordinates = coords;
  });

  setHandler(getHikerStatusQuery, () => {
    if (isHikerSafe) return 'SAFE';
    if (alertDispatched) return 'ALERT_ACTIVE';
    return 'MONITORING';
  });

  const timeoutMs = session.expectedDurationMinutes * 60 * 1000;

  const safeBeforeDeadline = await condition(() => isHikerSafe, timeoutMs);

  if (safeBeforeDeadline) {
    return `Hiker ${state.hikerName} checked in on time. Watch concluded normally.`;
  }

  alertDispatched = true;
  const weather = await fetchTrailWeather(state.trailName, state.lastCoordinates);
  const packet = await buildRescuePacket(state, weather);
  await notifyEmergencyContact(state.emergencyContactEmail, packet);

  const postAlertGraceMs = 24 * 60 * 60 * 1000;
  const safeAfterAlert = await condition(() => isHikerSafe, postAlertGraceMs);

  if (safeAfterAlert) {
    await sendStandDownNotification(state);
    return `Hiker checked in late. Stand-down resolution email sent.`;
  }

  return `Hiker overdue watch closed after extended grace period.`;
}