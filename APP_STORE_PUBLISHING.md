# App Store Publishing Guide for Lingoa

Complete guide to publish Lingoa iOS app to the App Store.

## 📋 Prerequisites

1. **Apple Developer Account** ($99/year)
   - Sign up at https://developer.apple.com/programs/
   - You'll need to enroll in the Apple Developer Program

2. **App Store Connect Access**
   - Once enrolled, access https://appstoreconnect.apple.com

## 📱 Current App Configuration

- **App Name**: Lingoa
- **Bundle ID**: `com.lingoa.app`
- **Version**: 1.0
- **Build**: 1
- **Minimum iOS**: 14.0

## 🚀 Step-by-Step Publishing Process

### Step 1: Apple Developer Account Setup

1. Go to https://developer.apple.com/programs/
2. Click "Enroll" and follow the enrollment process
3. Complete payment ($99/year)
4. Wait for approval (usually 24-48 hours)

### Step 2: Create App in App Store Connect

1. Go to https://appstoreconnect.apple.com
2. Click **"My Apps"** → **"+"** → **"New App"**
3. Fill in:
   - **Platform**: iOS
   - **Name**: Lingoa
   - **Primary Language**: English
   - **Bundle ID**: Select `com.lingoa.app` (you may need to register it first)
   - **SKU**: `lingoa-ios` (any unique identifier)
   - **User Access**: Full Access
4. Click **"Create"**

### Step 3: Register Bundle Identifier (if needed)

If `com.lingoa.app` isn't registered:

1. Go to https://developer.apple.com/account/resources/identifiers/list
2. Click **"+"** → **"App IDs"**
3. Select **"App"**
4. Fill in:
   - **Description**: Lingoa
   - **Bundle ID**: `com.lingoa.app`
5. **No capabilities needed** - Microphone and Speech Recognition are permissions declared in Info.plist, not App ID capabilities
6. Click **"Continue"** → **"Register"**

**Note:** The microphone and speech recognition permissions are already configured in your app's Info.plist file. You don't need to enable them as App ID capabilities.

### Step 4: Configure App Store Listing

In App Store Connect, fill in:

#### App Information
- **Name**: Lingoa
- **Subtitle**: Daily Speaking Practice (optional)
- **Category**: 
  - Primary: Education
  - Secondary: Lifestyle (optional)
- **Privacy Policy URL**: (Required - you'll need to create one)

#### Pricing and Availability
- **Price**: Free
- **Availability**: All countries (or select specific ones)

#### App Privacy
- **Data Collection**: 
  - ✅ Audio Data (Microphone) - Used for speech recognition
  - ✅ User Content (Voice recordings) - Used for language practice
  - Purpose: App Functionality
  - Linked to User: No
  - Used for Tracking: No

### Step 5: Prepare App Assets

You'll need:

1. **App Icon** (1024x1024px PNG, no transparency)
   - Location: `frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/`
   - Replace the placeholder icon

2. **Screenshots** (Required for at least iPhone 6.7" and 6.5")
   - iPhone 6.7" (iPhone 14 Pro Max): 1290 x 2796 pixels
   - iPhone 6.5" (iPhone 11 Pro Max): 1242 x 2688 pixels
   - Take screenshots from your app running in simulator

3. **App Preview Video** (Optional but recommended)
   - 15-30 seconds showing app features
   - Same sizes as screenshots

### Step 6: Code Signing Setup in Xcode

1. Open Xcode: `cd frontend && npm run cap:ios`

2. In Xcode:
   - Select **"App"** target
   - Go to **"Signing & Capabilities"** tab
   - Check **"Automatically manage signing"**
   - Select your **Team** (your Apple Developer account)
   - Xcode will automatically create provisioning profiles

3. Verify Bundle Identifier:
   - Should be: `com.lingoa.app`
   - If different, update in **"General"** tab → **"Bundle Identifier"**

### Step 7: Update Version and Build Numbers

In Xcode:
1. Select **"App"** target
2. Go to **"General"** tab
3. Set:
   - **Version**: `1.0` (or increment for updates)
   - **Build**: `1` (increment for each submission)

### Step 8: Build Archive

1. In Xcode, select **"Any iOS Device"** or **"Generic iOS Device"** from device dropdown
2. Go to **"Product"** → **"Archive"**
3. Wait for archive to complete (may take a few minutes)
4. **Organizer** window will open automatically

### Step 9: Upload to App Store Connect

1. In **Organizer** window:
   - Select your archive
   - Click **"Distribute App"**
   - Select **"App Store Connect"**
   - Click **"Next"**

2. Distribution options:
   - Select **"Upload"**
   - Click **"Next"**

3. Distribution content:
   - Review options (usually defaults are fine)
   - Click **"Next"**

4. Signing:
   - Select **"Automatically manage signing"**
   - Click **"Next"**

5. Review and upload:
   - Review summary
   - Click **"Upload"**
   - Wait for upload to complete (may take 10-30 minutes)

### Step 10: Complete App Store Listing

1. Go back to App Store Connect
2. Wait for processing (can take 30 minutes to a few hours)
3. Once processing completes:
   - Go to **"App Store"** tab
   - Fill in **"What's New"** (release notes)
   - Add screenshots
   - Complete all required fields

### Step 11: Submit for Review

1. In App Store Connect:
   - Scroll to **"Build"** section
   - Click **"+"** next to build
   - Select your uploaded build
   - Click **"Done"**

2. Answer App Review questions:
   - **Contact Information**: Your contact details
   - **Demo Account**: If your app requires login, provide test credentials
   - **Notes**: Any additional information for reviewers

3. Click **"Submit for Review"**

4. Wait for review (typically 24-48 hours, can be up to a week)

## 📝 App Store Listing Content

### App Description

```
Practice language by speaking for 5 minutes. Every day. No lessons, just conversations.

Lingoa helps you learn languages through real conversation practice. Speak naturally with an AI conversation partner for just 5 minutes daily.

Features:
• Natural conversations - No lessons, no drills, just real talk
• 10 languages - Spanish, French, German, Dutch, Italian, Portuguese, Hindi, Chinese, Japanese, Korean
• Voice activity detection - Timer only runs when you're speaking
• Real-time feedback - Get gentle corrections without interrupting flow
• Daily streak tracking - Build a consistent practice habit
• Role-play scenarios - Practice real-world situations
• Custom scenarios - Create your own conversation contexts

Perfect for:
• Busy learners who want quick daily practice
• People who learn better through speaking than reading
• Anyone building conversational confidence
• Language learners at any level

Start your daily 5-minute speaking practice today!
```

### Keywords (100 characters max)

```
language learning, speaking practice, conversation, daily practice, language app, speaking, pronunciation, language tutor, conversation practice, foreign language
```

### Support URL

Create a simple support page or use your GitHub repo:
- Example: `https://github.com/yogeshsharma140781/Lingoa`

### Marketing URL (Optional)

Your website or landing page URL

## 🔧 Troubleshooting

### Code Signing Issues

If you see signing errors:
1. Go to **"Signing & Capabilities"**
2. Uncheck **"Automatically manage signing"**
3. Check it again
4. Select your Team
5. Clean build folder: **Product** → **Clean Build Folder** (Shift+Cmd+K)

### Archive Not Available

- Make sure you selected **"Any iOS Device"** or **"Generic iOS Device"**
- Archive option only appears for device builds, not simulator

### Upload Fails

- Check internet connection
- Verify Apple Developer account is active
- Try again after a few minutes

### Build Processing Takes Long

- Normal - can take 30 minutes to several hours
- Check App Store Connect for status updates

## 📸 Taking Screenshots

1. Run app in simulator:
   ```bash
   cd frontend
   npm run cap:ios
   ```

2. In Xcode, select iPhone 14 Pro Max simulator

3. Run the app (Cmd+R)

4. Navigate through your app and take screenshots:
   - **Device** → **Screenshots** → **Save to Desktop**
   - Or use Cmd+S in simulator

5. Required screenshots:
   - Home screen
   - Conversation screen
   - Topic/Scenario selection
   - Completion screen

## ✅ Pre-Submission Checklist

- [ ] Apple Developer account active
- [ ] App created in App Store Connect
- [ ] Bundle ID registered
- [ ] App icon (1024x1024) added
- [ ] Screenshots added (at least iPhone 6.7" and 6.5")
- [ ] App description written
- [ ] Privacy policy URL added
- [ ] Privacy questions answered
- [ ] Version and build numbers set
- [ ] Code signing configured
- [ ] Archive created successfully
- [ ] Build uploaded to App Store Connect
- [ ] Build processing completed
- [ ] All App Store listing fields completed
- [ ] App submitted for review

## 🎉 After Submission

1. **Review Status**: Check App Store Connect for updates
2. **If Rejected**: Read feedback, fix issues, resubmit
3. **If Approved**: App goes live automatically (or on scheduled date)

## 📞 Support

- Apple Developer Support: https://developer.apple.com/support/
- App Store Connect Help: https://help.apple.com/app-store-connect/

Good luck with your App Store submission! 🚀

