# App Icon Guide for Lingoa

## 📍 Location

Your app icon goes here:
```
frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/
```

Current file: `AppIcon-512@2x.png`

## ✅ Requirements

- **Size**: 1024 x 1024 pixels (exactly)
- **Format**: PNG
- **No transparency**: Must have solid background
- **Square**: Not rounded (iOS will round it automatically)
- **File name**: `AppIcon-512@2x.png`

## 🎨 Design Tips

- Keep important content in the center (iOS rounds corners)
- Use high contrast colors
- Avoid text (it will be too small)
- Test on different backgrounds
- Make it recognizable at small sizes

## 📝 Steps to Add Icon

### Method 1: Using Xcode (Easiest)

1. Open Xcode:
   ```bash
   cd frontend
   npm run cap:ios
   ```

2. In Xcode:
   - Navigate to: `App` → `Assets.xcassets` → `AppIcon` (in left sidebar)
   - You'll see a grid with different icon sizes
   - Find the **1024x1024** slot
   - Drag your icon file into it, OR
   - Right-click the slot → **"Import"** → Select your icon

3. Xcode will automatically:
   - Validate the icon
   - Generate all required sizes
   - Update the Contents.json file

### Method 2: Replace File Directly

1. Create your 1024x1024px PNG icon
2. Name it: `AppIcon-512@2x.png`
3. Replace the file:
   ```bash
   # Copy your icon to:
   frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
   ```
4. Sync:
   ```bash
   cd frontend
   npm run cap:sync ios
   ```

## 🔍 Verify Icon

After adding:
1. Build the app in Xcode
2. Check the home screen in simulator
3. Verify it looks good at different sizes

## 📱 Icon Sizes iOS Uses

iOS automatically generates these from your 1024x1024 icon:
- 20x20 (Notification)
- 29x29 (Settings)
- 40x40 (Spotlight)
- 60x60 (App)
- 76x76 (iPad)
- 83.5x83.5 (iPad Pro)
- 1024x1024 (App Store)

You only need to provide the 1024x1024 version!

## 🎯 Quick Checklist

- [ ] Icon is 1024x1024 pixels
- [ ] Format is PNG
- [ ] No transparency
- [ ] Square (not pre-rounded)
- [ ] Important content in center
- [ ] High contrast
- [ ] Looks good at small sizes
- [ ] Added to Xcode or replaced file
- [ ] Synced with Capacitor
- [ ] Tested in simulator

## 💡 Design Resources

If you need to create an icon:
- **Figma**: Free design tool
- **Canva**: Easy icon templates
- **Icon generators**: Search "iOS app icon generator"
- **Hire a designer**: Fiverr, 99designs, etc.

## 🚀 After Adding Icon

Once your icon is added:
1. Build the app: `Product` → `Build` (Cmd+B)
2. Test in simulator
3. Continue with App Store submission process

