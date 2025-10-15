#!/bin/bash
# Quick Start Script for Raspberry Pi
# Usage: ./pi-quickstart.sh [start|stop|restart|status|logs]

SERVICE_NAME="tool-tracker"

case "$1" in
    start)
        echo "Starting Tool Tracker service..."
        sudo systemctl start $SERVICE_NAME
        sudo systemctl status $SERVICE_NAME
        ;;
    stop)
        echo "Stopping Tool Tracker service..."
        sudo systemctl stop $SERVICE_NAME
        ;;
    restart)
        echo "Restarting Tool Tracker service..."
        sudo systemctl restart $SERVICE_NAME
        sudo systemctl status $SERVICE_NAME
        ;;
    status)
        sudo systemctl status $SERVICE_NAME
        ;;
    logs)
        echo "Showing live logs (Ctrl+C to exit)..."
        sudo journalctl -u $SERVICE_NAME -f
        ;;
    install-service)
        echo "Installing systemd service..."
        sudo cp tool-tracker.service /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable $SERVICE_NAME
        echo "✓ Service installed and enabled"
        echo "  Start with: ./pi-quickstart.sh start"
        ;;
    test-camera)
        echo "Testing camera..."
        python3 python/test_camera.py
        ;;
    *)
        echo "Tool Tracker - Quick Start"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|logs|install-service|test-camera}"
        echo ""
        echo "Commands:"
        echo "  start           - Start the service"
        echo "  stop            - Stop the service"
        echo "  restart         - Restart the service"
        echo "  status          - Show service status"
        echo "  logs            - Show live logs"
        echo "  install-service - Install as systemd service"
        echo "  test-camera     - Test camera connection"
        echo ""
        exit 1
        ;;
esac
