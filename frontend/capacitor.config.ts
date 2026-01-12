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
    contentInset: 'always',
    scrollEnabled: true,
    backgroundColor: '#1c1917',
  },
  plugins: {
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#1c1917',
      overlaysWebView: true,
    },
  },
};

export default config;
