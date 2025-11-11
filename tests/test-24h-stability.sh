#!/bin/bash
################################################################################
# 24-Hour Multi-Camera Stability Test
# Runs continuous capture cycles and monitors for memory leaks, crashes, errors
################################################################################

set -euo pipefail

# Configuration
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$TEST_DIR")"
LOG_DIR="$TEST_DIR/logs/stability"
METRICS_DIR="$TEST_DIR/metrics/stability"
START_TIME=$(date +%s)
DURATION_HOURS=${1:-24}
DURATION_SECONDS=$((DURATION_HOURS * 3600))
CHECK_INTERVAL_SECONDS=${2:-300}  # Check every 5 minutes

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Create directories
mkdir -p "$LOG_DIR" "$METRICS_DIR"

LOG_FILE="$LOG_DIR/stability_$(date +%Y%m%d_%H%M%S).log"
METRICS_FILE="$METRICS_DIR/metrics_$(date +%Y%m%d_%H%M%S).csv"

################################################################################
# Logging
################################################################################

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $*" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[✗]${NC} $*" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $*" | tee -a "$LOG_FILE"
}

################################################################################
# Monitoring Functions
################################################################################

collect_metrics() {
    local elapsed=$(($(date +%s) - START_TIME))
    local hours=$((elapsed / 3600))
    local minutes=$(((elapsed % 3600) / 60))
    
    # System memory
    local total_mem=$(free -m | awk 'NR==2 {print $2}')
    local used_mem=$(free -m | awk 'NR==2 {print $3}')
    local free_mem=$(free -m | awk 'NR==2 {print $4}')
    local mem_percent=$(awk "BEGIN {printf \"%.1f\", ($used_mem/$total_mem)*100}")
    
    # Process memory (sum all Python processes)
    local python_rss=0
    while read -r rss; do
        python_rss=$((python_rss + rss))
    done < <(ps aux | grep -E "python3.*aruco|python3.*process_cameras|python3.*camera" | grep -v grep | awk '{print $6}')
    local python_mb=$((python_rss / 1024))
    
    # Disk usage
    local disk_used=$(df -h "$PROJECT_ROOT/data" | awk 'NR==2 {print $5}' | sed 's/%//')
    
    # Count files in ROI directories
    local roi_files=$(find "$PROJECT_ROOT/data/rois" -type f 2>/dev/null | wc -l)
    
    # USB errors from dmesg
    local usb_errors=$(dmesg | grep -c "usb.*error\|input/output error" || echo 0)
    
    # Application errors from logs
    local app_errors=$(grep -c "ERROR\|CRITICAL" "$PROJECT_ROOT"/.logs/*.log 2>/dev/null || echo 0)
    
    # Write to CSV
    echo "$elapsed,$hours:$minutes,$used_mem,$free_mem,$mem_percent,$python_mb,$disk_used,$roi_files,$usb_errors,$app_errors" >> "$METRICS_FILE"
    
    # Log status
    log "Runtime: ${hours}h ${minutes}m | RAM: ${used_mem}MB/${total_mem}MB (${mem_percent}%) | Python: ${python_mb}MB | Disk: ${disk_used}% | ROI files: $roi_files | USB errors: $usb_errors"
    
    # Check for critical conditions
    if [ "$mem_percent" -gt 90 ]; then
        log_error "CRITICAL: Memory usage at ${mem_percent}%"
        return 1
    fi
    
    if [ "$python_mb" -gt 1500 ]; then
        log_error "CRITICAL: Python processes using ${python_mb}MB (limit: 1500MB)"
        return 1
    fi
    
    if [ "$usb_errors" -gt 10 ]; then
        log_warning "WARNING: ${usb_errors} USB errors detected"
    fi
    
    return 0
}

check_file_integrity() {
    # Check for file overwrites by comparing checksums
    local checksum_file="$METRICS_DIR/checksums_$(date +%Y%m%d_%H%M%S).txt"
    
    # Generate checksums for all ROI files
    find "$PROJECT_ROOT/data/rois" -type f -exec md5sum {} \; > "$checksum_file" 2>/dev/null
    
    # Compare with previous checksums
    local prev_checksum=$(ls -t "$METRICS_DIR"/checksums_*.txt 2>/dev/null | sed -n '2p')
    
    if [ -n "$prev_checksum" ]; then
        # Check for duplicate checksums (file overwrites)
        local duplicates=$(diff "$prev_checksum" "$checksum_file" | grep -c "^>" || echo 0)
        if [ "$duplicates" -gt 0 ]; then
            log_warning "Detected $duplicates new/changed ROI files"
        fi
    fi
}

check_memory_leak() {
    # Analyze trend in Python memory usage
    if [ ! -f "$METRICS_FILE" ]; then
        return 0
    fi
    
    # Get first and last Python memory measurements
    local first_mem=$(awk -F, 'NR==2 {print $6}' "$METRICS_FILE")
    local last_mem=$(tail -1 "$METRICS_FILE" | awk -F, '{print $6}')
    
    if [ -z "$first_mem" ] || [ -z "$last_mem" ]; then
        return 0
    fi
    
    # Calculate growth
    local growth=$((last_mem - first_mem))
    local growth_percent=$(awk "BEGIN {if ($first_mem > 0) printf \"%.1f\", ($growth/$first_mem)*100; else print 0}")
    
    log "Memory growth: ${growth}MB (${growth_percent}%)"
    
    # Alert if memory grew more than 50%
    if (( $(echo "$growth_percent > 50" | bc -l) )); then
        log_error "Potential memory leak detected: ${growth_percent}% growth"
        return 1
    fi
    
    return 0
}

################################################################################
# Test Execution
################################################################################

run_stability_test() {
    log "===================================================================="
    log "Starting ${DURATION_HOURS}-Hour Stability Test"
    log "===================================================================="
    log "Check interval: ${CHECK_INTERVAL_SECONDS}s"
    log "Log file: $LOG_FILE"
    log "Metrics file: $METRICS_FILE"
    log ""
    
    # Initialize metrics CSV
    echo "elapsed_sec,runtime,used_mb,free_mb,mem_percent,python_mb,disk_used_percent,roi_files,usb_errors,app_errors" > "$METRICS_FILE"
    
    # Collect initial baseline
    log "Collecting baseline metrics..."
    collect_metrics || log_error "Failed to collect initial metrics"
    
    # Main monitoring loop
    local check_count=0
    while true; do
        local elapsed=$(($(date +%s) - START_TIME))
        
        # Check if test duration exceeded
        if [ $elapsed -ge $DURATION_SECONDS ]; then
            log_success "Stability test completed after ${DURATION_HOURS} hours"
            break
        fi
        
        # Sleep until next check
        sleep $CHECK_INTERVAL_SECONDS
        
        ((check_count++))
        log ""
        log "==== Check #$check_count ===="
        
        # Collect metrics
        if ! collect_metrics; then
            log_error "Critical condition detected. Stopping test."
            return 1
        fi
        
        # Check file integrity every hour
        if [ $((check_count % 12)) -eq 0 ]; then
            log "Checking file integrity..."
            check_file_integrity
        fi
        
        # Check for memory leaks every 2 hours
        if [ $((check_count % 24)) -eq 0 ]; then
            log "Checking for memory leaks..."
            check_memory_leak
        fi
    done
    
    # Final analysis
    log ""
    log "===================================================================="
    log "Stability Test Complete - Final Analysis"
    log "===================================================================="
    
    collect_metrics
    check_memory_leak
    
    # Generate summary report
    local total_checks=$(wc -l < "$METRICS_FILE")
    local avg_mem=$(awk -F, 'NR>1 {sum+=$3; count++} END {if (count>0) printf "%.0f", sum/count}' "$METRICS_FILE")
    local max_mem=$(awk -F, 'NR>1 {if ($3>max) max=$3} END {print max}' "$METRICS_FILE")
    local final_usb_errors=$(tail -1 "$METRICS_FILE" | awk -F, '{print $9}')
    local final_app_errors=$(tail -1 "$METRICS_FILE" | awk -F, '{print $10}')
    
    log ""
    log "Summary:"
    log "  Duration: ${DURATION_HOURS} hours"
    log "  Checks: $total_checks"
    log "  Avg RAM: ${avg_mem}MB"
    log "  Peak RAM: ${max_mem}MB"
    log "  USB errors: $final_usb_errors"
    log "  App errors: $final_app_errors"
    log ""
    
    # Check pass/fail criteria
    local passed=true
    
    if [ "$max_mem" -gt 1500 ]; then
        log_error "FAIL: Peak memory exceeded 1500MB limit"
        passed=false
    else
        log_success "PASS: Memory stayed within limits"
    fi
    
    if [ "$final_usb_errors" -gt 0 ]; then
        log_warning "WARNING: USB errors detected during test"
    else
        log_success "PASS: No USB errors"
    fi
    
    # Final verdict
    if [ "$passed" = true ]; then
        log_success "24-hour stability test PASSED"
        return 0
    else
        log_error "24-hour stability test FAILED"
        return 1
    fi
}

################################################################################
# Signal Handlers
################################################################################

cleanup() {
    log ""
    log "Cleaning up and generating final report..."
    collect_metrics || true
    log "Test interrupted. Partial results saved to: $LOG_FILE"
    exit 130
}

trap cleanup SIGINT SIGTERM

################################################################################
# Main
################################################################################

main() {
    # Check if running on hardware
    if [ ! -d "$PROJECT_ROOT/data" ]; then
        log_error "Data directory not found. Are you in the correct project directory?"
        exit 1
    fi
    
    # Run stability test
    run_stability_test
    exit $?
}

main "$@"
