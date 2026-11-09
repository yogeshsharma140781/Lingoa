import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

// Which build the user is on, attached to usage events so before/after
// comparisons use the app version instead of guessing from dates (people update
// on different days).
export interface AppInfo {
  platform: string // ios / android / web
  version: string  // "1.2 (34)" on native, "web" in a browser
}

let info: AppInfo = { platform: Capacitor.getPlatform(), version: 'web' }
let loading: Promise<AppInfo> | null = null

/** Resolves once the native version is known (immediately on web). Safe to call repeatedly. */
export function loadAppInfo(): Promise<AppInfo> {
  if (!loading) {
    loading = (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const native = await App.getInfo()
          info = { platform: Capacitor.getPlatform(), version: `${native.version} (${native.build})` }
        } catch (err) {
          console.warn('[AppInfo] Could not read app version:', err)
        }
      }
      return info
    })()
  }
  return loading
}
