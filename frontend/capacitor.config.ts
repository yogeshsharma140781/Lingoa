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
    contentInset: 'never',
    scrollEnabled: true,
  },
  plugins: {
    StatusBar: {
      style: 'Light',
      overlaysWebView: true,
    },
  },
};

export default config;
