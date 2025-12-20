#!/bin/bash

# =================================================
# Twitch Music Bot - Linux Setup Script
# Works on Debian, Ubuntu, CentOS, and most Linux distros
# =================================================

set -e

echo "=========================================="
echo "Twitch Music Bot - Installation Script"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Warning: Running as root. Consider using a non-root user.${NC}"
fi

# Detect package manager
if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt"
    echo -e "${GREEN}Detected: Debian/Ubuntu${NC}"
elif command -v yum &> /dev/null; then
    PKG_MANAGER="yum"
    echo -e "${GREEN}Detected: CentOS/RHEL${NC}"
elif command -v dnf &> /dev/null; then
    PKG_MANAGER="dnf"
    echo -e "${GREEN}Detected: Fedora${NC}"
elif command -v pacman &> /dev/null; then
    PKG_MANAGER="pacman"
    echo -e "${GREEN}Detected: Arch Linux${NC}"
else
    echo -e "${RED}Error: Unsupported package manager${NC}"
    exit 1
fi

# =========================================
# Step 1: Install system dependencies
# =========================================
echo ""
echo -e "${YELLOW}[1/6] Installing system dependencies...${NC}"

case $PKG_MANAGER in
    apt)
        sudo apt-get update
        sudo apt-get install -y curl ffmpeg python3 git build-essential
        ;;
    yum)
        sudo yum install -y curl ffmpeg python3 git gcc-c++ make
        ;;
    dnf)
        sudo dnf install -y curl ffmpeg python3 git gcc-c++ make
        ;;
    pacman)
        sudo pacman -Sy --noconfirm curl ffmpeg python git base-devel
        ;;
esac

echo -e "${GREEN}✓ System dependencies installed${NC}"

# =========================================
# Step 2: Install Node.js 20
# =========================================
echo ""
echo -e "${YELLOW}[2/6] Installing Node.js 20...${NC}"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        echo -e "${GREEN}✓ Node.js $(node -v) already installed${NC}"
    else
        echo "Upgrading Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs || {
        # Fallback for non-Debian systems
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install 20
        nvm use 20
    }
fi

echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"

# =========================================
# Step 3: Install yt-dlp
# =========================================
echo ""
echo -e "${YELLOW}[3/6] Installing yt-dlp...${NC}"

if command -v yt-dlp &> /dev/null; then
    echo -e "${GREEN}✓ yt-dlp already installed${NC}"
    yt-dlp --update 2>/dev/null || true
else
    sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    sudo chmod a+rx /usr/local/bin/yt-dlp
    echo -e "${GREEN}✓ yt-dlp installed${NC}"
fi

# =========================================
# Step 4: Clone or update repository
# =========================================
echo ""
echo -e "${YELLOW}[4/6] Setting up project...${NC}"

INSTALL_DIR="${INSTALL_DIR:-$HOME/music-twitch}"

if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation in $INSTALL_DIR..."
    cd "$INSTALL_DIR"
    git pull origin master
else
    echo "Cloning repository to $INSTALL_DIR..."
    git clone https://github.com/MrAS/music-twitch.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

echo -e "${GREEN}✓ Project ready at $INSTALL_DIR${NC}"

# =========================================
# Step 5: Install npm dependencies
# =========================================
echo ""
echo -e "${YELLOW}[5/6] Installing npm dependencies...${NC}"

npm install

echo -e "${GREEN}✓ Dependencies installed${NC}"

# =========================================
# Step 6: Build TypeScript
# =========================================
echo ""
echo -e "${YELLOW}[6/6] Building project...${NC}"

npm run build

echo -e "${GREEN}✓ Build complete${NC}"

# =========================================
# Create .env file if not exists
# =========================================
if [ ! -f ".env" ]; then
    echo ""
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}Please edit .env with your configuration:${NC}"
    echo "  nano $INSTALL_DIR/.env"
fi

# =========================================
# Create systemd service
# =========================================
echo ""
echo -e "${YELLOW}Creating systemd service...${NC}"

SERVICE_FILE="/etc/systemd/system/twitch-music-bot.service"
sudo tee $SERVICE_FILE > /dev/null <<EOF
[Unit]
Description=Twitch Music Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
echo -e "${GREEN}✓ Systemd service created${NC}"

# =========================================
# Create cache directory
# =========================================
mkdir -p "$INSTALL_DIR/cache"

# =========================================
# Final instructions
# =========================================
echo ""
echo "=========================================="
echo -e "${GREEN}Installation Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit your .env file with your credentials:"
echo "   ${YELLOW}nano $INSTALL_DIR/.env${NC}"
echo ""
echo "2. Required .env variables:"
echo "   - TWITCH_USERNAME, TWITCH_TOKEN, TWITCH_CHANNEL"
echo "   - RTMP_URL (from your Restreamer)"
echo "   - ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET"
echo ""
echo "3. Start the bot:"
echo "   ${YELLOW}sudo systemctl start twitch-music-bot${NC}"
echo ""
echo "4. Enable auto-start on boot:"
echo "   ${YELLOW}sudo systemctl enable twitch-music-bot${NC}"
echo ""
echo "5. View logs:"
echo "   ${YELLOW}sudo journalctl -u twitch-music-bot -f${NC}"
echo ""
echo "6. Access the admin dashboard at:"
echo "   ${GREEN}http://YOUR_SERVER_IP:3000${NC}"
echo ""
echo "=========================================="
