import { useCallback, useRef, useState } from 'react';

import type { LatLng } from './geo';

/**
 * One-shot device location, used transiently to answer "what gyms are near me".
 *
 * PRIVACY CONTRACT
 * ----------------
 * The coordinate returned here lives in React state for the lifetime of the
 * screen and nowhere else. It is never written to the database, never cached to
 * storage, and never attached to presence — `presence` references a `gym_id` and
 * has no coordinate columns at all. There is deliberately no watch/subscribe API
 * in this module, because continuous positioning is not something this product
 * should be able to do.
 *
 * WHY NOT expo-location
 * ---------------------
 * `expo-location` is the right long-term answer and `app.config.ts` already
 * declares the iOS usage string and the Android when-in-use permissions for it,
 * with background location explicitly blocked. It is not used yet because it is
 * not in `package.json`, and adding a dependency without regenerating
 * `package-lock.json` breaks `npm ci` in CI.
 *
 * To adopt it:
 *   1. npx expo install expo-location
 *   2. Replace `getGeolocation()` below with
 *      `Location.requestForegroundPermissionsAsync()` +
 *      `Location.getCurrentPositionAsync({ accuracy: Balanced })`.
 *      Request FOREGROUND only — never `requestBackgroundPermissionsAsync`.
 *   3. Nothing else changes: the hook's shape is the contract, and every caller
 *      already handles the `unsupported` status by asking the member to choose a
 *      starting point instead.
 *
 * Until then this uses `navigator.geolocation` when the platform provides it
 * (Expo web does; bare React Native does not), and reports `unsupported`
 * otherwise so the UI can fall back gracefully rather than showing an empty map.
 */

export type DeviceLocationStatus =
  'unsupported' | 'idle' | 'requesting' | 'granted' | 'denied' | 'error';

export interface DeviceLocationState {
  status: DeviceLocationStatus;
  /** Present only while `status` is 'granted'. Never persisted. */
  coords: LatLng | null;
  /** Member-facing explanation when a request did not succeed. */
  message: string | null;
  /** False when the platform offers no geolocation provider at all. */
  supported: boolean;
  request: () => void;
}

interface PositionLike {
  coords: { latitude: number; longitude: number };
}

interface PositionErrorLike {
  code?: number;
  message?: string;
}

interface GeolocationLike {
  getCurrentPosition(
    onSuccess: (position: PositionLike) => void,
    onError?: (error: PositionErrorLike) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}

/**
 * Resolves a geolocation provider without depending on DOM ambient types.
 *
 * Reached through `globalThis` and structurally checked rather than typed against
 * `lib.dom`, because this code also runs under Hermes where `navigator` is a
 * partial shim and the DOM types would be a lie.
 */
function getGeolocation(): GeolocationLike | null {
  const scope = globalThis as { navigator?: { geolocation?: unknown } };
  const candidate = scope.navigator?.geolocation;

  if (
    candidate != null &&
    typeof (candidate as GeolocationLike).getCurrentPosition === 'function'
  ) {
    return candidate as GeolocationLike;
  }
  return null;
}

/** PERMISSION_DENIED in the W3C Geolocation spec. */
const PERMISSION_DENIED = 1;

export function useDeviceLocation(): DeviceLocationState {
  const supported = getGeolocation() !== null;

  const [status, setStatus] = useState<DeviceLocationStatus>(supported ? 'idle' : 'unsupported');
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Guards against a second request while one is outstanding, which on some
  // platforms would stack permission prompts.
  const inFlight = useRef(false);

  const request = useCallback(() => {
    const geolocation = getGeolocation();
    if (!geolocation) {
      setStatus('unsupported');
      setMessage('This build cannot read your location. Choose a starting point instead.');
      return;
    }
    if (inFlight.current) return;

    inFlight.current = true;
    setStatus('requesting');
    setMessage(null);

    geolocation.getCurrentPosition(
      (position) => {
        inFlight.current = false;
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setStatus('granted');
        setMessage(null);
      },
      (error) => {
        inFlight.current = false;
        if (error?.code === PERMISSION_DENIED) {
          setStatus('denied');
          setMessage('Location permission is off. You can still search for a gym by name.');
          return;
        }
        setStatus('error');
        setMessage('Could not get your location just now. Try again, or search by name.');
      },
      // A generous timeout and a short cache: a stale fix from a minute ago is
      // perfectly good for "gyms within 5 km", and waiting for a fresh one on a
      // cold GPS is a poor first impression.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  return { status, coords, message, supported, request };
}
