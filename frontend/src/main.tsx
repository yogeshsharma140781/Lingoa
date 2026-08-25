import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import './index.css'

// Tag <html> so index.css can tell the native iOS app (real WKWebView notch/home-
// indicator concerns) apart from a plain browser (no notch, env() is reliably 0 -
// or, in mobile Safari, reliably correct on its own). See index.css for why this
// matters: a hardcoded safe-area minimum makes sense on native but only wastes
// vertical space in a browser.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-ios')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)


