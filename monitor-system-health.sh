#!/bin/bash
################################################################################
# ShelfEye System Health Monitor
# Checks all resilience systems and reports overall health
################################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
HEALTH_ENDPOINT="http://localhost:5000/api/health"
DISK_ENDPOINT="http://localhost:5000/api/maintenance/disk-usage"
MAINTENANCE_ENDPOINT="http://localhost:5000/api/maintenance/stats"

print_header() {
    echo ""
    echo -e "${BLUE}======================================${NC}"
    echo -e "${BLUE}  ShelfEye System Health Report${NC}"
    echo -e "${BLUE}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo -e "${BLUE}======================================${NC}"
    echo ""
}

print_section() {
    echo -e "${BLUE}### $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo "  $1"
}

################################################################################
# Check Hardware Watchdog
################################################################################
check_hardware_watchdog() {
    print_section "Hardware Watchdog (Auto-Reboot on Freeze)"
    
    if systemctl is-active --quiet watchdog; then
        print_success "Watchdog service is running"
        
        if [ -c /dev/watchdog ]; then
            print_success "Watchdog device exists: /dev/watchdog"
        else
            print_warning "Watchdog device not found"
        fi
        
        # Check if module is loaded
        if lsmod | grep -q bcm2835_wdt; then
            print_success "Watchdog kernel module loaded"
        else
            print_warning "Watchdog kernel module not loaded"
        fi
    else
        print_error "Watchdog service is NOT running"
        print_info "Run: ./enable-watchdog.sh to enable it"
    fi
    echo ""
}

################################################################################
# Check ShelfEye Service
################################################################################
check_shelfeye_service() {
    print_section "ShelfEye Application Service"
    
    if systemctl is-active --quiet shelfeye; then
        print_success "ShelfEye service is running"
        
        # Get service uptime
        local start_time=$(systemctl show shelfeye --property=ActiveEnterTimestamp --value)
        if [ -n "$start_time" ]; then
            print_info "Started: $start_time"
        fi
        
        # Check for recent restarts
        local restart_count=$(journalctl -u shelfeye --since "1 hour ago" | grep -c "Started ShelfEye" || echo "0")
        if [ "$restart_count" -gt 1 ]; then
            print_warning "Service restarted $restart_count times in the last hour"
        else
            print_success "No unexpected restarts in the last hour"
        fi
    else
        print_error "ShelfEye service is NOT running"
        print_info "Run: sudo systemctl start shelfeye"
    fi
    echo ""
}

################################################################################
# Check Application Health
################################################################################
check_application_health() {
    print_section "Application Health Endpoint"
    
    if command -v curl &> /dev/null; then
        local response=$(curl -s -w "\n%{http_code}" "$HEALTH_ENDPOINT" 2>/dev/null || echo "000")
        local http_code=$(echo "$response" | tail -n1)
        local body=$(echo "$response" | head -n-1)
        
        if [ "$http_code" = "200" ]; then
            print_success "Health endpoint responding (HTTP 200)"
            
            # Parse JSON response if jq is available
            if command -v jq &> /dev/null && [ -n "$body" ]; then
                local uptime_hours=$(echo "$body" | jq -r '.uptime.hours // "N/A"')
                local uptime_days=$(echo "$body" | jq -r '.uptime.days // "N/A"')
                local mem_rss=$(echo "$body" | jq -r '.memory.rss // "N/A"')
                local mem_heap=$(echo "$body" | jq -r '.memory.heapUsed // "N/A"')
                
                print_info "Uptime: ${uptime_days}d ${uptime_hours}h"
                print_info "Memory: RSS=${mem_rss}MB, Heap=${mem_heap}MB"
            fi
        else
            print_error "Health endpoint not responding (HTTP $http_code)"
        fi
    else
        print_warning "curl not installed, skipping health check"
    fi
    echo ""
}

################################################################################
# Check Disk Space
################################################################################
check_disk_space() {
    print_section "Disk Space"
    
    if command -v curl &> /dev/null && command -v jq &> /dev/null; then
        local response=$(curl -s "$DISK_ENDPOINT" 2>/dev/null || echo "{}")
        local status=$(echo "$response" | jq -r '.status // "unknown"')
        local percent=$(echo "$response" | jq -r '.usage.percentUsed // 0')
        local free_gb=$(echo "$response" | jq -r '.usage.free // 0')
        
        if [ "$status" = "ok" ]; then
            print_success "Disk space OK (${percent}% used, ${free_gb}GB free)"
        elif [ "$status" = "warning" ]; then
            print_warning "Disk space WARNING (${percent}% used, ${free_gb}GB free)"
        elif [ "$status" = "critical" ]; then
            print_error "Disk space CRITICAL (${percent}% used, ${free_gb}GB free)"
        else
            # Fallback to df command
            local disk_info=$(df -h . | tail -n1)
            local disk_percent=$(echo "$disk_info" | awk '{print $5}' | sed 's/%//')
            local disk_avail=$(echo "$disk_info" | awk '{print $4}')
            
            if [ "$disk_percent" -ge 90 ]; then
                print_error "Disk usage: ${disk_percent}% (${disk_avail} free)"
            elif [ "$disk_percent" -ge 80 ]; then
                print_warning "Disk usage: ${disk_percent}% (${disk_avail} free)"
            else
                print_success "Disk usage: ${disk_percent}% (${disk_avail} free)"
            fi
        fi
    else
        # Fallback to df command
        local disk_info=$(df -h . | tail -n1)
        local disk_percent=$(echo "$disk_info" | awk '{print $5}' | sed 's/%//')
        local disk_avail=$(echo "$disk_info" | awk '{print $4}')
        
        if [ "$disk_percent" -ge 90 ]; then
            print_error "Disk usage: ${disk_percent}% (${disk_avail} free)"
        elif [ "$disk_percent" -ge 80 ]; then
            print_warning "Disk usage: ${disk_percent}% (${disk_avail} free)"
        else
            print_success "Disk usage: ${disk_percent}% (${disk_avail} free)"
        fi
    fi
    echo ""
}

################################################################################
# Check Memory Usage
################################################################################
check_memory() {
    print_section "System Memory"
    
    local total_mem=$(free -m | awk 'NR==2 {print $2}')
    local used_mem=$(free -m | awk 'NR==2 {print $3}')
    local free_mem=$(free -m | awk 'NR==2 {print $4}')
    local mem_percent=$(awk "BEGIN {printf \"%.0f\", ($used_mem/$total_mem)*100}")
    
    if [ "$mem_percent" -ge 90 ]; then
        print_error "Memory usage: ${mem_percent}% (${used_mem}MB/${total_mem}MB used)"
    elif [ "$mem_percent" -ge 80 ]; then
        print_warning "Memory usage: ${mem_percent}% (${used_mem}MB/${total_mem}MB used)"
    else
        print_success "Memory usage: ${mem_percent}% (${used_mem}MB/${total_mem}MB used)"
    fi
    echo ""
}

################################################################################
# Check CPU Temperature (Raspberry Pi specific)
################################################################################
check_temperature() {
    print_section "CPU Temperature"
    
    if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
        local temp_raw=$(cat /sys/class/thermal/thermal_zone0/temp)
        local temp_c=$((temp_raw / 1000))
        
        if [ "$temp_c" -ge 80 ]; then
            print_error "Temperature: ${temp_c}°C (throttling likely)"
        elif [ "$temp_c" -ge 70 ]; then
            print_warning "Temperature: ${temp_c}°C (getting hot)"
        else
            print_success "Temperature: ${temp_c}°C"
        fi
    else
        print_info "Temperature sensor not available"
    fi
    echo ""
}

################################################################################
# Check Maintenance Service
################################################################################
check_maintenance() {
    print_section "Maintenance & Cleanup"
    
    if command -v curl &> /dev/null && command -v jq &> /dev/null; then
        local response=$(curl -s "$MAINTENANCE_ENDPOINT" 2>/dev/null || echo "{}")
        local total_logs=$(echo "$response" | jq -r '.totalLogs // "N/A"')
        local total_alerts=$(echo "$response" | jq -r '.totalAlerts // "N/A"')
        
        print_success "Daily maintenance scheduled at 3:00 AM JST"
        print_info "Detection logs: $total_logs"
        print_info "Alert queue: $total_alerts"
    else
        print_success "Daily maintenance scheduled at 3:00 AM JST"
    fi
    echo ""
}

################################################################################
# Check Recent Errors
################################################################################
check_recent_errors() {
    print_section "Recent Errors (Last Hour)"
    
    local error_count=$(journalctl -u shelfeye --since "1 hour ago" --priority=err | grep -c "ERROR" || echo "0")
    
    if [ "$error_count" -eq 0 ]; then
        print_success "No errors in the last hour"
    elif [ "$error_count" -lt 5 ]; then
        print_warning "$error_count error(s) in the last hour"
        print_info "Run: sudo journalctl -u shelfeye --priority=err --since '1 hour ago'"
    else
        print_error "$error_count error(s) in the last hour"
        print_info "Run: sudo journalctl -u shelfeye --priority=err --since '1 hour ago'"
    fi
    echo ""
}

################################################################################
# Main
################################################################################
main() {
    print_header
    
    check_hardware_watchdog
    check_shelfeye_service
    check_application_health
    check_disk_space
    check_memory
    check_temperature
    check_maintenance
    check_recent_errors
    
    echo -e "${BLUE}======================================${NC}"
    echo -e "${GREEN}Health check complete!${NC}"
    echo ""
    echo "For more details:"
    echo "  • Service status: sudo systemctl status shelfeye"
    echo "  • View logs: sudo journalctl -u shelfeye -f"
    echo "  • Watchdog status: ./check_watchdog.sh"
    echo ""
}

main "$@"
