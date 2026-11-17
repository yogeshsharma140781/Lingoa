import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lingoa.app',
  appName: 'Lingoa',
  webDir: 'dist',
  server: {
    // For development, use localhost
    // For production, set this to your Render backend URL
    // url: 'https://your-app.onrender.com',
    cleartext: true, // Allow HTTP for development
  },
  ios: {
    // 'never': let the web view fill the whole screen. The page already pads itself
    // for the notch and home indicator (env(safe-area-inset-*) in index.css), so
    // 'automatic' made iOS add the same margin a second time (black bars + empty band).
    contentInset: 'never',
    backgroundColor: '#1c1917',
    scrollEnabled: true,
  },
  plugins: {
    StatusBar: {
      style: 'Light',
    },
  },
};

export default config;
