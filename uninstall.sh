#!/bin/bash

# =================================================
# Twitch Music Bot - Uninstall Script
# Removes the bot and optionally its dependencies
# =================================================

set -e

echo "=========================================="
echo "Twitch Music Bot - Uninstall Script"
echo "=========================================="

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-$HOME/music-twitch}"
SERVICE_NAME="twitch-music-bot"

echo ""
echo -e "${YELLOW}This will uninstall Twitch Music Bot.${NC}"
echo ""
read -p "Continue? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# =========================================
# Stop and disable systemd service
# =========================================
echo ""
echo -e "${YELLOW}[1/4] Stopping service...${NC}"

if systemctl is-active --quiet $SERVICE_NAME 2>/dev/null; then
    sudo systemctl stop $SERVICE_NAME
    echo -e "${GREEN}✓ Service stopped${NC}"
else
    echo "Service not running"
fi

if systemctl is-enabled --quiet $SERVICE_NAME 2>/dev/null; then
    sudo systemctl disable $SERVICE_NAME
    echo -e "${GREEN}✓ Service disabled${NC}"
fi

# =========================================
# Remove systemd service file
# =========================================
echo ""
echo -e "${YELLOW}[2/4] Removing systemd service...${NC}"

SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
if [ -f "$SERVICE_FILE" ]; then
    sudo rm -f "$SERVICE_FILE"
    sudo systemctl daemon-reload
    echo -e "${GREEN}✓ Service file removed${NC}"
else
    echo "Service file not found"
fi

# =========================================
# Remove application directory
# =========================================
echo ""
echo -e "${YELLOW}[3/4] Removing application files...${NC}"

if [ -d "$INSTALL_DIR" ]; then
    read -p "Remove $INSTALL_DIR and all cached videos? (y/N): " remove_dir
    if [[ "$remove_dir" =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        echo -e "${GREEN}✓ Application directory removed${NC}"
    else
        echo "Keeping application directory"
    fi
else
    echo "Application directory not found"
fi

# =========================================
# Optionally remove dependencies
# =========================================
echo ""
echo -e "${YELLOW}[4/4] Remove dependencies?${NC}"
echo "This will remove yt-dlp. Node.js and FFmpeg will NOT be removed."
read -p "Remove yt-dlp? (y/N): " remove_deps

if [[ "$remove_deps" =~ ^[Yy]$ ]]; then
    if [ -f "/usr/local/bin/yt-dlp" ]; then
        sudo rm -f /usr/local/bin/yt-dlp
        echo -e "${GREEN}✓ yt-dlp removed${NC}"
    fi
fi

# =========================================
# Docker cleanup (optional)
# =========================================
echo ""
read -p "Remove Docker container and image? (y/N): " remove_docker

if [[ "$remove_docker" =~ ^[Yy]$ ]]; then
    if command -v docker &> /dev/null; then
        docker stop twitch-music-bot 2>/dev/null || true
        docker rm twitch-music-bot 2>/dev/null || true
        docker rmi music-twitch-twitch-music-bot 2>/dev/null || true
        docker rmi music-twitch_twitch-music-bot 2>/dev/null || true
        echo -e "${GREEN}✓ Docker resources removed${NC}"
    fi
fi

# =========================================
# Complete
# =========================================
echo ""
echo "=========================================="
echo -e "${GREEN}Uninstall Complete!${NC}"
echo "=========================================="
echo ""
echo "The following were removed:"
echo "  - Systemd service: $SERVICE_NAME"
if [[ "$remove_dir" =~ ^[Yy]$ ]]; then
    echo "  - Application: $INSTALL_DIR"
fi
if [[ "$remove_deps" =~ ^[Yy]$ ]]; then
    echo "  - yt-dlp"
fi
if [[ "$remove_docker" =~ ^[Yy]$ ]]; then
    echo "  - Docker container and image"
fi
echo ""
echo "Note: Node.js and FFmpeg were NOT removed."
echo "To remove them manually:"
echo "  - Debian/Ubuntu: sudo apt remove nodejs ffmpeg"
echo "  - CentOS/RHEL: sudo yum remove nodejs ffmpeg"
echo ""
