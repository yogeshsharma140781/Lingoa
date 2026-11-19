import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import { loadAppInfo } from './appInfo'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import './index.css'

// Dev only: open /?conversation-gallery to see every conversation state with mock data.
const Gallery = import.meta.env.DEV && new URLSearchParams(window.location.search).has('conversation-gallery')
  ? React.lazy(() => import('./conversation/ui/Gallery'))
  : null

// Tag <html> so index.css can tell the native iOS app (real WKWebView notch/home-
// indicator concerns) apart from a plain browser (no notch, env() is reliably 0 -
// or, in mobile Safari, reliably correct on its own). See index.css for why this
// matters: a hardcoded safe-area minimum makes sense on native but only wastes
// vertical space in a browser.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-ios')
}

// Warm up the app version so the first usage events already carry it.
loadAppInfo()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {Gallery ? (
      <React.Suspense fallback={null}>
        <Gallery />
      </React.Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)

// The app has rendered its first screen: fade the loading logo away, then remove it.
const boot = document.getElementById('boot')
if (boot) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      boot.style.opacity = '0'
      boot.style.pointerEvents = 'none'
      window.setTimeout(() => boot.remove(), 350)
    }),
  )
}
