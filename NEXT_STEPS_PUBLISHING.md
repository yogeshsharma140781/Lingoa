# Next Steps to Publish Lingoa iOS App

Your privacy policy is live at: `https://yogeshsharma140781.github.io/Lingoa/privacy-policy.html`

## ✅ Completed
- ✅ iOS app setup with Capacitor
- ✅ Privacy policy created and published
- ✅ Repository made public

## 🚀 Next Steps (In Order)

### Step 1: Apple Developer Account ($99/year)

**If you don't have one yet:**

1. Go to: https://developer.apple.com/programs/
2. Click **"Enroll"**
3. Sign in with your Apple ID
4. Complete enrollment:
   - Choose entity type (Individual or Organization)
   - Enter your information
   - Complete payment ($99/year)
5. Wait for approval (usually 24-48 hours)

**If you already have one:** Skip to Step 2

---

### Step 2: Register Bundle Identifier

1. Go to: https://developer.apple.com/account/resources/identifiers/list
2. Click **"+"** button (top left)
3. Select **"App IDs"** → Click **"Continue"**
4. Select **"App"** → Click **"Continue"**
5. Fill in:
   - **Description**: `Lingoa`
   - **Bundle ID**: `com.lingoa.app`
   - Select **"Explicit"**
6. **No capabilities needed** - Microphone and Speech Recognition are permissions declared in Info.plist (already configured), not App ID capabilities
7. Click **"Continue"** → **"Register"**

**Note:** Microphone and Speech Recognition permissions are already configured in your app's Info.plist file. You don't need to enable them as App ID capabilities.

---

### Step 3: Create App in App Store Connect

1. Go to: https://appstoreconnect.apple.com
2. Click **"My Apps"** → **"+"** → **"New App"**
3. Fill in:
   - **Platform**: iOS
   - **Name**: `Lingoa`
   - **Primary Language**: English
   - **Bundle ID**: Select `com.lingoa.app` (from Step 2)
   - **SKU**: `lingoa-ios-001` (any unique identifier)
   - **User Access**: Full Access
4. Click **"Create"**

---

### Step 4: Prepare App Assets

#### A. App Icon (1024x1024px PNG)

You need a 1024x1024px PNG icon with no transparency.

**Current location:** `frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/`

**To create/update:**
1. Design a 1024x1024px icon (or use a design tool)
2. Save as PNG (no transparency)
3. Replace the placeholder in Xcode:
   - Open Xcode: `cd frontend && npm run cap:ios`
   - Navigate to: `AppIcon.appiconset` in Assets
   - Drag your icon to the 1024x1024 slot

#### B. Screenshots (Required)

You need screenshots for at least:
- **iPhone 6.7"** (iPhone 14 Pro Max): 1290 x 2796 pixels
- **iPhone 6.5"** (iPhone 11 Pro Max): 1242 x 2688 pixels

**How to take screenshots:**

1. Open app in simulator:
   ```bash
   cd frontend
   npm run cap:ios
   ```

2. In Xcode:
   - Select **iPhone 14 Pro Max** simulator
   - Run the app (Cmd+R)
   - Navigate through your app screens

3. Take screenshots:
   - **Device** → **Screenshots** → **Save to Desktop**
   - Or press **Cmd+S** in simulator

4. Required screenshots:
   - Home screen (with language selector)
   - Mode selection screen
   - Topic/Role-play selection screen
   - Conversation screen (during a conversation)
   - Completion screen

---

### Step 5: Configure Code Signing in Xcode

1. Open Xcode:
   ```bash
   cd frontend
   npm run cap:ios
   ```

2. In Xcode:
   - Select **"App"** target (left sidebar)
   - Go to **"Signing & Capabilities"** tab
   - Check **"Automatically manage signing"**
   - Select your **Team** (your Apple Developer account)
   - Xcode will automatically configure signing

3. Verify Bundle Identifier:
   - Should be: `com.lingoa.app`
   - If different, update in **"General"** tab

---

### Step 6: Update Version Numbers

In Xcode:
1. Select **"App"** target
2. Go to **"General"** tab
3. Set:
   - **Version**: `1.0`
   - **Build**: `1`

---

### Step 7: Build Archive

1. In Xcode:
   - Select **"Any iOS Device"** or **"Generic iOS Device"** from device dropdown (top left)
   - **Important:** Archive only works for device builds, not simulator

2. Create archive:
   - **Product** → **Archive**
   - Wait for build to complete (may take a few minutes)
   - **Organizer** window will open automatically

---

### Step 8: Upload to App Store Connect

1. In **Organizer** window:
   - Select your archive
   - Click **"Distribute App"**

2. Distribution method:
   - Select **"App Store Connect"**
   - Click **"Next"**

3. Distribution options:
   - Select **"Upload"**
   - Click **"Next"**

4. Distribution content:
   - Review options (defaults are usually fine)
   - Click **"Next"**

5. Signing:
   - Select **"Automatically manage signing"**
   - Click **"Next"**

6. Review and upload:
   - Review summary
   - Click **"Upload"**
   - Wait for upload (10-30 minutes)

---

### Step 9: Complete App Store Listing

1. Go back to App Store Connect
2. Wait for processing (30 minutes to a few hours)
3. Once processing completes:

   **App Information:**
   - **Privacy Policy URL**: `https://yogeshsharma140781.github.io/Lingoa/privacy-policy.html`
   - **Category**: Primary: Education, Secondary: Lifestyle
   - **Subtitle**: Daily Speaking Practice (optional)

   **Pricing and Availability:**
   - **Price**: Free
   - **Availability**: All countries (or select specific ones)

   **App Privacy:**
   - Click **"Get Started"** under App Privacy
   - Answer questions:
     - ✅ **Audio Data** - Used for App Functionality
     - ✅ **User Content** (Voice recordings) - Used for App Functionality
     - **Linked to User**: No
     - **Used for Tracking**: No

   **Version Information:**
   - **What's New**: 
     ```
     Welcome to Lingoa! Practice language by speaking for 5 minutes every day. 
     No lessons, just natural conversations with an AI partner.
     ```
   - **Description**: (See APP_STORE_PUBLISHING.md for full text)
   - **Keywords**: `language learning, speaking practice, conversation, daily practice, language app`
   - **Support URL**: `https://github.com/yogeshsharma140781/Lingoa`
   - **Marketing URL**: (Optional)

   **Screenshots:**
   - Upload your screenshots for iPhone 6.7" and 6.5"
   - Add at least 3-5 screenshots showing different screens

   **Build:**
   - Click **"+"** next to Build
   - Select your uploaded build
   - Click **"Done"**

---

### Step 10: Submit for Review

1. Answer App Review questions:
   - **Contact Information**: Your contact details
   - **Demo Account**: Not required (app doesn't require login)
   - **Notes**: 
     ```
     Lingoa is a language learning app that uses voice conversations for practice.
     The app requires microphone and speech recognition permissions.
     No user account is required - all data is stored locally on device.
     ```

2. Click **"Submit for Review"**

3. Wait for review (typically 24-48 hours, can be up to a week)

---

## 📝 App Store Description (Copy This)

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

---

## ✅ Pre-Submission Checklist

- [ ] Apple Developer account active
- [ ] Bundle ID registered (`com.lingoa.app`)
- [ ] App created in App Store Connect
- [ ] App icon (1024x1024) added
- [ ] Screenshots taken and uploaded
- [ ] Privacy policy URL added
- [ ] App description written
- [ ] Privacy questions answered
- [ ] Code signing configured
- [ ] Version numbers set (1.0 / 1)
- [ ] Archive created successfully
- [ ] Build uploaded to App Store Connect
- [ ] Build processing completed
- [ ] All App Store listing fields completed
- [ ] App submitted for review

---

## 🎯 Quick Start (If You Have Apple Developer Account)

1. **Register Bundle ID** (5 minutes)
2. **Create App in App Store Connect** (5 minutes)
3. **Take Screenshots** (15 minutes)
4. **Configure Signing in Xcode** (5 minutes)
5. **Build & Upload** (30 minutes)
6. **Complete Listing** (20 minutes)
7. **Submit** (5 minutes)

**Total time:** ~1.5 hours (plus waiting for processing)

---

## 📞 Need Help?

- **Apple Developer Support**: https://developer.apple.com/support/
- **App Store Connect Help**: https://help.apple.com/app-store-connect/

Good luck! 🚀

