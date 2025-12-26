#!/bin/bash

# =================================================
# Twitch Music Bot - Control Script
# Commands: start, stop, restart, status, logs, build, update
# =================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Service name
SERVICE_NAME="twitch-music-bot"

# PID file for non-systemd usage
PID_FILE="$SCRIPT_DIR/.music-bot.pid"

# Check if systemd is available
use_systemd() {
    if command -v systemctl &> /dev/null && systemctl list-units --type=service | grep -q "$SERVICE_NAME"; then
        return 0
    fi
    return 1
}

# Function to show help
show_help() {
    echo ""
    echo -e "${BLUE}=========================================="
    echo "Twitch Music Bot - Control Script"
    echo -e "==========================================${NC}"
    echo ""
    echo "Usage: ./control.sh [command]"
    echo ""
    echo "Commands:"
    echo -e "  ${GREEN}start${NC}     - Start the bot"
    echo -e "  ${GREEN}stop${NC}      - Stop the bot"
    echo -e "  ${GREEN}restart${NC}   - Restart the bot"
    echo -e "  ${GREEN}status${NC}    - Show bot status"
    echo -e "  ${GREEN}logs${NC}      - Show live logs (Ctrl+C to exit)"
    echo -e "  ${GREEN}build${NC}     - Build TypeScript"
    echo -e "  ${GREEN}update${NC}    - Pull latest code and rebuild"
    echo -e "  ${GREEN}install${NC}   - Install npm dependencies"
    echo -e "  ${GREEN}clean${NC}     - Clear cache folder"
    echo -e "  ${GREEN}dev${NC}       - Run in development mode"
    echo ""
}

# Function to start the bot
start_bot() {
    echo -e "${YELLOW}Starting Twitch Music Bot...${NC}"
    
    if use_systemd; then
        sudo systemctl start $SERVICE_NAME
        sleep 2
        if sudo systemctl is-active --quiet $SERVICE_NAME; then
            echo -e "${GREEN}✓ Bot started successfully (systemd)${NC}"
        else
            echo -e "${RED}✗ Failed to start bot${NC}"
            sudo systemctl status $SERVICE_NAME
        fi
    else
        # Check if already running
        if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            echo -e "${YELLOW}Bot is already running (PID: $(cat $PID_FILE))${NC}"
            return
        fi
        
        # Start with nohup
        nohup node dist/index.js > logs/output.log 2>&1 &
        echo $! > "$PID_FILE"
        sleep 2
        
        if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            echo -e "${GREEN}✓ Bot started (PID: $(cat $PID_FILE))${NC}"
            echo -e "   Logs: tail -f logs/output.log"
        else
            echo -e "${RED}✗ Failed to start bot${NC}"
            rm -f "$PID_FILE"
        fi
    fi
}

# Function to stop the bot
stop_bot() {
    echo -e "${YELLOW}Stopping Twitch Music Bot...${NC}"
    
    if use_systemd; then
        sudo systemctl stop $SERVICE_NAME
        echo -e "${GREEN}✓ Bot stopped${NC}"
    else
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 $PID 2>/dev/null; then
                kill $PID
                sleep 2
                # Force kill if still running
                if kill -0 $PID 2>/dev/null; then
                    kill -9 $PID
                fi
                echo -e "${GREEN}✓ Bot stopped (PID: $PID)${NC}"
            else
                echo -e "${YELLOW}Bot was not running${NC}"
            fi
            rm -f "$PID_FILE"
        else
            # Try to find and kill node process
            pkill -f "node dist/index.js" 2>/dev/null && echo -e "${GREEN}✓ Bot stopped${NC}" || echo -e "${YELLOW}Bot was not running${NC}"
        fi
    fi
}

# Function to restart the bot
restart_bot() {
    echo -e "${YELLOW}Restarting Twitch Music Bot...${NC}"
    stop_bot
    sleep 2
    start_bot
}

# Function to show status
show_status() {
    echo ""
    echo -e "${BLUE}=========================================="
    echo "Twitch Music Bot - Status"
    echo -e "==========================================${NC}"
    
    if use_systemd; then
        sudo systemctl status $SERVICE_NAME --no-pager
    else
        if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            PID=$(cat "$PID_FILE")
            echo -e "${GREEN}● Bot is running${NC}"
            echo "  PID: $PID"
            echo "  Uptime: $(ps -o etime= -p $PID 2>/dev/null || echo 'unknown')"
            echo "  Memory: $(ps -o rss= -p $PID 2>/dev/null | awk '{print int($1/1024)"MB"}' || echo 'unknown')"
        else
            echo -e "${RED}● Bot is not running${NC}"
        fi
    fi
    echo ""
}

# Function to show logs
show_logs() {
    echo -e "${YELLOW}Showing logs (Ctrl+C to exit)...${NC}"
    echo ""
    
    if use_systemd; then
        sudo journalctl -u $SERVICE_NAME -f
    else
        if [ -f "logs/output.log" ]; then
            tail -f logs/output.log
        else
            echo -e "${RED}No log file found${NC}"
        fi
    fi
}

# Function to build
build_project() {
    echo -e "${YELLOW}Building TypeScript...${NC}"
    npm run build
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Build complete${NC}"
    else
        echo -e "${RED}✗ Build failed${NC}"
        exit 1
    fi
}

# Function to update
update_project() {
    echo -e "${YELLOW}Updating Twitch Music Bot...${NC}"
    echo ""
    
    # Stop if running
    stop_bot
    
    # Pull latest code
    echo -e "${YELLOW}Pulling latest code...${NC}"
    git pull origin master
    
    # Install dependencies
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
    
    # Build
    build_project
    
    echo ""
    echo -e "${GREEN}✓ Update complete${NC}"
    echo -e "${YELLOW}Run './control.sh start' to start the bot${NC}"
}

# Function to install dependencies
install_deps() {
    echo -e "${YELLOW}Installing npm dependencies...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Function to clean cache
clean_cache() {
    echo -e "${YELLOW}Clearing cache folder...${NC}"
    rm -rf cache/*
    echo -e "${GREEN}✓ Cache cleared${NC}"
}

# Function to run in dev mode
run_dev() {
    echo -e "${YELLOW}Running in development mode...${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop${NC}"
    echo ""
    npm run dev
}

# Create logs directory if needed
mkdir -p "$SCRIPT_DIR/logs"

# Main command handler
case "${1:-help}" in
    start)
        start_bot
        ;;
    stop)
        stop_bot
        ;;
    restart)
        restart_bot
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    build)
        build_project
        ;;
    update)
        update_project
        ;;
    install)
        install_deps
        ;;
    clean)
        clean_cache
        ;;
    dev)
        run_dev
        ;;
    help|--help|-h|*)
        show_help
        ;;
esac
