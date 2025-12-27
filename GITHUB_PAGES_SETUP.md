# GitHub Pages Setup for Privacy Policy

Your privacy policy is now in the repository. Here's how to publish it on GitHub Pages so you have a URL for App Store Connect.

## Option 1: Enable GitHub Pages (Recommended)

### Steps:

1. **Go to your GitHub repository:**
   - Visit: https://github.com/yogeshsharma140781/Lingoa

2. **Go to Settings:**
   - Click on **"Settings"** tab (top right of repository)

3. **Enable GitHub Pages:**
   - Scroll down to **"Pages"** section in the left sidebar
   - Under **"Source"**, select **"Deploy from a branch"**
   - Select branch: **"main"**
   - Select folder: **"/ (root)"**
   - Click **"Save"**

4. **Get your URL:**
   - GitHub will provide a URL like: `https://yogeshsharma140781.github.io/Lingoa/privacy-policy.html`
   - It may take a few minutes to become active

5. **Use in App Store Connect:**
   - Copy the full URL: `https://yogeshsharma140781.github.io/Lingoa/privacy-policy.html`
   - Paste it into App Store Connect → App Information → Privacy Policy URL

## Option 2: Use Raw GitHub File (Quick Alternative)

If you want a URL immediately without setting up Pages:

1. **Get the raw file URL:**
   - Go to: https://github.com/yogeshsharma140781/Lingoa/blob/main/privacy-policy.html
   - Click **"Raw"** button (top right)
   - Copy the URL: `https://raw.githubusercontent.com/yogeshsharma140781/Lingoa/main/privacy-policy.html`

2. **Use a service to render HTML:**
   - Use: https://htmlpreview.github.io/?[YOUR_RAW_URL]
   - Full URL: `https://htmlpreview.github.io/?https://raw.githubusercontent.com/yogeshsharma140781/Lingoa/main/privacy-policy.html`

   **Note:** This is a temporary solution. GitHub Pages (Option 1) is better for App Store.

## Option 3: Host on Your Render Site

If your backend is already deployed on Render, you can serve the privacy policy from there:

1. Add the HTML file to your backend's static files
2. Serve it at: `https://lingoa.onrender.com/privacy-policy.html`

## ✅ Recommended: GitHub Pages

**Use Option 1 (GitHub Pages)** - it's the cleanest and most professional solution.

Your privacy policy URL will be:
```
https://yogeshsharma140781.github.io/Lingoa/privacy-policy.html
```

This URL is perfect for App Store Connect!

