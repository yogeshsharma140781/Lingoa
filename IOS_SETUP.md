# iOS App Setup Guide

This guide will help you build and run the Lingoa iOS app.

## Prerequisites

1. **macOS** - iOS development requires a Mac
2. **Xcode** - Install from the App Store (latest version recommended)
3. **CocoaPods** - Install with: `sudo gem install cocoapods`
4. **Node.js** - Already installed (v20+)

## Initial Setup

### 1. Install iOS Dependencies

```bash
cd frontend
npm install
npm run build
npx cap sync ios
```

### 2. Install CocoaPods Dependencies

```bash
cd ios/App
pod install
cd ../..
```

### 3. Configure Backend URL

For production, update the backend URL in `frontend/src/hooks/useApi.ts`:

```typescript
const backendUrl = import.meta.env.VITE_API_URL || 'https://your-app.onrender.com'
```

Or set it via environment variable:
```bash
export VITE_API_URL=https://your-app.onrender.com
```

## Building and Running

### Option 1: Using Xcode (Recommended)

1. Open the workspace:
   ```bash
   cd frontend
   npm run cap:ios
   ```
   This will open Xcode automatically.

2. In Xcode:
   - Select your target device (simulator or physical device)
   - Click the Play button (▶️) or press `Cmd+R`
   - Wait for the app to build and launch

### Option 2: Command Line

```bash
cd frontend/ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build
```

## Development Workflow

1. **Make changes** to React code in `frontend/src/`
2. **Build the web app**:
   ```bash
   cd frontend
   npm run build
   ```
3. **Sync to iOS**:
   ```bash
   npx cap sync ios
   ```
4. **Run in Xcode** - The changes will be reflected in the iOS app

## Available Scripts

- `npm run build` - Build the web app
- `npm run cap:ios` - Sync and open iOS project in Xcode
- `npm run cap:sync` - Build and sync to iOS
- `npm run cap:copy` - Copy web assets to iOS
- `npm run cap:update` - Update Capacitor dependencies

## iOS Permissions

The app requires the following permissions (already configured in `Info.plist`):

- **Microphone** - For voice recording
- **Speech Recognition** - For transcribing your voice

These permissions will be requested when you first use the microphone feature.

## Troubleshooting

### CocoaPods Issues

If you see CocoaPods errors:
```bash
cd ios/App
pod deintegrate
pod install
```

### Xcode Plugin Errors

If you see Xcode plugin loading errors:
```bash
xcodebuild -runFirstLaunch
```

### Build Errors

1. Clean build folder in Xcode: `Product > Clean Build Folder` (Shift+Cmd+K)
2. Delete derived data: `~/Library/Developer/Xcode/DerivedData`
3. Rebuild

### API Connection Issues

- Make sure your backend URL is correct in `useApi.ts`
- For local development, use your Mac's IP address:
  ```typescript
  const backendUrl = 'http://192.168.1.XXX:8000'
  ```
- Ensure your backend allows CORS from the iOS app

## Publishing to App Store

1. **Update version** in `ios/App/App.xcodeproj/project.pbxproj`
2. **Configure signing** in Xcode (requires Apple Developer account)
3. **Archive** the app: `Product > Archive`
4. **Upload** to App Store Connect via Xcode Organizer

## Notes

- The iOS app uses the same React codebase as the web app
- Native features (microphone, audio) work automatically via Capacitor
- The app will use the backend URL configured in `useApi.ts`
- For local testing, ensure your Mac and iOS device are on the same network

