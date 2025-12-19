# iOS Setup Status

## ✅ Completed Steps

1. ✅ **Capacitor installed** - Version 7.x (compatible with Node 20)
2. ✅ **iOS project created** - Located in `frontend/ios/App/`
3. ✅ **iOS permissions configured** - Microphone and Speech Recognition added to `Info.plist`
4. ✅ **API configuration updated** - iOS will use backend URL from `useApi.ts`
5. ✅ **Build scripts added** - `npm run cap:ios`, `npm run cap:sync`, etc.
6. ✅ **Web app built** - Production build completed successfully
7. ✅ **Capacitor sync completed** - Web assets copied to iOS project

## ⚠️ Manual Steps Required

### 1. Install CocoaPods (Required)

CocoaPods is needed to install iOS native dependencies. Run:

```bash
sudo gem install cocoapods
```

**Note:** This requires your Mac password.

### 2. Install iOS Dependencies

After CocoaPods is installed, run:

```bash
cd frontend/ios/App
pod install
cd ../..
```

### 3. Configure Backend URL

Update the backend URL in `frontend/src/hooks/useApi.ts` (line 10):

```typescript
const backendUrl = (window as any).__API_URL__ || 'https://your-actual-backend-url.onrender.com'
```

Replace `'https://your-actual-backend-url.onrender.com'` with your actual Render backend URL.

**To find your Render URL:**
1. Go to https://dashboard.render.com
2. Find your "lingoa" service
3. Copy the URL (e.g., `https://lingoa-xxxx.onrender.com`)

### 4. Fix Xcode Plugin Warning (Optional)

If you see Xcode plugin errors, run:

```bash
xcodebuild -runFirstLaunch
```

This may require Xcode to be opened manually first.

## 🚀 Next Steps

Once CocoaPods is installed:

1. **Open in Xcode:**
   ```bash
   cd frontend
   npm run cap:ios
   ```

2. **In Xcode:**
   - Select a simulator (e.g., iPhone 15) or connect a physical device
   - Click the Play button (▶️) or press `Cmd+R`
   - Wait for the app to build and launch

## 📝 Development Workflow

1. Make changes to React code in `frontend/src/`
2. Build: `npm run build`
3. Sync: `npx cap sync ios`
4. Run in Xcode to test

## 🔧 Troubleshooting

### CocoaPods Issues
```bash
cd frontend/ios/App
pod deintegrate
pod install
```

### Build Errors
- Clean build folder in Xcode: `Product > Clean Build Folder` (Shift+Cmd+K)
- Delete derived data: `rm -rf ~/Library/Developer/Xcode/DerivedData`

### API Connection Issues
- For local testing, use your Mac's IP address instead of localhost
- Ensure backend CORS allows requests from iOS app
- Check that backend URL is correct in `useApi.ts`

## 📱 Current Status

- ✅ iOS project structure: Ready
- ⏳ CocoaPods: Needs installation
- ⏳ Backend URL: Needs configuration
- ✅ Build scripts: Ready
- ✅ Permissions: Configured

## 🎯 Quick Start (After CocoaPods)

```bash
# 1. Install CocoaPods dependencies
cd frontend/ios/App
pod install
cd ../..

# 2. Update backend URL in frontend/src/hooks/useApi.ts

# 3. Open in Xcode
cd frontend
npm run cap:ios

# 4. In Xcode: Select device and click Run
```

