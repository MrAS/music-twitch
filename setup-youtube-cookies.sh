#!/bin/bash

# YouTube Cookies Setup Helper
# This script helps you set up YouTube cookies for yt-dlp to bypass rate limits

echo "🍪 YouTube Cookies Setup Helper"
echo "================================"
echo ""
echo "To fix YouTube download errors, you need to export your YouTube cookies from your browser."
echo ""

# Check if cookies file already exists
if [ -f "./youtube-cookies.txt" ]; then
    echo "✓ Found existing cookies file: youtube-cookies.txt"
    echo ""
    read -p "Do you want to replace it? (y/N): " replace
    if [[ ! $replace =~ ^[Yy]$ ]]; then
        echo "Keeping existing cookies file."
        exit 0
    fi
fi

echo "📋 Instructions:"
echo ""
echo "METHOD 1: Browser Extension (Recommended)"
echo "1. Install a cookies.txt browser extension:"
echo "   - Chrome/Edge: 'Get cookies.txt LOCALLY' extension"
echo "     https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
echo "   - Firefox: 'cookies.txt' extension"
echo "     https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/"
echo ""
echo "2. Go to https://www.youtube.com in your browser (make sure you're logged in)"
echo "3. Click the extension icon"
echo "4. Click 'Export' or 'Get cookies.txt'"
echo "5. Save the file as 'youtube-cookies.txt' in this directory:"
echo "   $(pwd)"
echo ""
echo "METHOD 2: Manual Export from Browser DevTools (Advanced)"
echo "See: https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies"
echo ""
echo "---"
echo ""
read -p "Press Enter after you've saved the cookies file as 'youtube-cookies.txt'..."

# Check if the file was created
if [ ! -f "./youtube-cookies.txt" ]; then
    echo ""
    echo "❌ Error: youtube-cookies.txt not found!"
    echo "Please make sure you saved the file in: $(pwd)"
    exit 1
fi

echo ""
echo "✓ Cookies file found!"
echo ""

# Update .env file
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found. Creating from .env.example..."
    cp .env.example .env
fi

# Check if YOUTUBE_COOKIES is already set in .env
if grep -q "^YOUTUBE_COOKIES=" .env; then
    # Update existing line
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' 's|^YOUTUBE_COOKIES=.*|YOUTUBE_COOKIES=./youtube-cookies.txt|' .env
    else
        # Linux
        sed -i 's|^YOUTUBE_COOKIES=.*|YOUTUBE_COOKIES=./youtube-cookies.txt|' .env
    fi
    echo "✓ Updated YOUTUBE_COOKIES in .env"
else
    # Add new line
    echo "YOUTUBE_COOKIES=./youtube-cookies.txt" >> .env
    echo "✓ Added YOUTUBE_COOKIES to .env"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Rebuild the application: npm run build"
echo "2. Restart Docker containers: docker-compose down && docker-compose up -d"
echo "3. Test by searching for a YouTube video in Twitch chat"
echo ""
