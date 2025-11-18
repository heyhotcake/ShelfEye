#!/bin/bash
################################################################################
# Multi-Camera E2E Test Suite
# Tests sequential calibration, detection, alerts, and resource usage
################################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$TEST_DIR")"
LOG_DIR="$TEST_DIR/logs"
ARTIFACTS_DIR="$TEST_DIR/artifacts"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TEST_LOG="$LOG_DIR/e2e_test_$TIMESTAMP.log"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Create directories
mkdir -p "$LOG_DIR" "$ARTIFACTS_DIR"

################################################################################
# Logging Functions
################################################################################

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*" | tee -a "$TEST_LOG"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $*" | tee -a "$TEST_LOG"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[✗]${NC} $*" | tee -a "$TEST_LOG"
    ((TESTS_FAILED++))
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $*" | tee -a "$TEST_LOG"
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $*" | tee -a "$TEST_LOG"
    ((TESTS_SKIPPED++))
}

################################################################################
# Test Helper Functions
################################################################################

# Check if running on Raspberry Pi with cameras
check_hardware() {
    log "Checking hardware requirements..."
    
    # Check if v4l2-ctl is available
    if ! command -v v4l2-ctl &> /dev/null; then
        log_error "v4l2-ctl not found. Install with: sudo apt-get install v4l-utils"
        return 1
    fi
    
    # Check for available cameras
    local camera_count=0
    for device in /dev/video*; do
        if [ -c "$device" ]; then
            ((camera_count++))
        fi
    done
    
    if [ $camera_count -lt 2 ]; then
        log_warning "Found only $camera_count camera(s). Multi-camera tests require 2+."
        log_warning "Will run in simulation mode."
        export SIMULATE_CAMERAS=1
        return 0
    fi
    
    log_success "Found $camera_count cameras. Hardware check passed."
    export SIMULATE_CAMERAS=0
    return 0
}

# Monitor resource usage
monitor_resources() {
    local duration=$1
    local output_file="$ARTIFACTS_DIR/resources_$TIMESTAMP.log"
    
    log "Monitoring resources for ${duration}s..."
    
    # Start background monitoring
    {
        echo "Timestamp,RSS_MB,VSZ_MB,CPU_PCT" > "$output_file"
        for ((i=0; i<duration; i++)); do
            # Get process stats for all python3 processes
            ps aux | grep -E "python3.*aruco|python3.*process_cameras|python3.*camera" | grep -v grep | \
            awk -v ts="$(date +%s)" '{print ts","$6/1024","$5/1024","$3}' >> "$output_file"
            sleep 1
        done
    } &
    
    local monitor_pid=$!
    echo $monitor_pid > "$ARTIFACTS_DIR/monitor.pid"
}

stop_monitoring() {
    if [ -f "$ARTIFACTS_DIR/monitor.pid" ]; then
        local pid=$(cat "$ARTIFACTS_DIR/monitor.pid")
        kill $pid 2>/dev/null || true
        rm "$ARTIFACTS_DIR/monitor.pid"
    fi
}

# Check RAM usage
check_ram_usage() {
    local max_mb=${1:-1500}
    local resources_file="$ARTIFACTS_DIR/resources_$TIMESTAMP.log"
    
    if [ ! -f "$resources_file" ]; then
        log_warning "No resource data found"
        return 0
    fi
    
    # Get max RSS from log
    local max_rss=$(awk -F, 'NR>1 {print $2}' "$resources_file" | sort -rn | head -1)
    
    if [ -z "$max_rss" ]; then
        log_warning "No RAM usage data collected"
        return 0
    fi
    
    log "Peak RAM usage: ${max_rss}MB (limit: ${max_mb}MB)"
    
    if (( $(echo "$max_rss > $max_mb" | bc -l) )); then
        log_error "RAM usage exceeded limit: ${max_rss}MB > ${max_mb}MB"
        return 1
    fi
    
    log_success "RAM usage within limits: ${max_rss}MB <= ${max_mb}MB"
    return 0
}

# Check for USB errors in dmesg (diff from baseline)
check_usb_errors() {
    log "Checking for new USB errors..."
    
    local baseline_file="$ARTIFACTS_DIR/dmesg_baseline.txt"
    local current_file="$ARTIFACTS_DIR/dmesg_current.txt"
    
    # If no baseline exists, create one
    if [ ! -f "$baseline_file" ]; then
        dmesg > "$baseline_file"
        log "Created dmesg baseline"
        return 0
    fi
    
    # Capture current dmesg
    dmesg > "$current_file"
    
    # Find new USB errors
    local new_errors=$(diff "$baseline_file" "$current_file" | grep -i "^> .*usb.*error\|^> .*input/output error" | wc -l)
    
    if [ $new_errors -gt 0 ]; then
        log_error "Found $new_errors NEW USB errors since baseline"
        diff "$baseline_file" "$current_file" | grep -i "^> .*usb.*error\|^> .*input/output error" | head -10 >> "$TEST_LOG"
        return 1
    fi
    
    log_success "No new USB errors detected"
    return 0
}

# Check for file collisions (strict check with checksums)
check_file_collisions() {
    log "Checking for file collisions with strict validation..."
    
    # Check ROI subdirectories exist
    local roi_dirs=$(find "$PROJECT_ROOT/data/rois" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
    
    if [ $roi_dirs -lt 2 ] && [ "$SIMULATE_CAMERAS" -eq 0 ]; then
        log_error "Expected camera-specific ROI subdirectories, found $roi_dirs"
        return 1
    fi
    
    # Generate checksums for all ROI files, grouped by camera directory
    local checksum_file="$ARTIFACTS_DIR/roi_checksums.txt"
    find "$PROJECT_ROOT/data/rois" -type f -exec md5sum {} \; > "$checksum_file" 2>/dev/null
    
    # Check if same filename exists in different camera directories with DIFFERENT checksums
    # This would indicate file overwrites between cameras
    local collision_count=0
    while IFS= read -r camera_dir; do
        local camera_id=$(basename "$camera_dir")
        
        # Get all filenames in this camera's directory
        find "$camera_dir" -type f -printf "%f\n" | while read -r filename; do
            # Check if this filename exists in OTHER camera directories
            find "$PROJECT_ROOT/data/rois" -mindepth 2 -maxdepth 2 -name "$filename" ! -path "$camera_dir/*" | while read -r other_file; do
                # Compare checksums
                local hash1=$(md5sum "$camera_dir/$filename" 2>/dev/null | awk '{print $1}')
                local hash2=$(md5sum "$other_file" 2>/dev/null | awk '{print $1}')
                
                if [ "$hash1" == "$hash2" ]; then
                    log_error "COLLISION: Same file $filename in multiple cameras with identical content!"
                    ((collision_count++))
                fi
            done
        done
    done < <(find "$PROJECT_ROOT/data/rois" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
    
    if [ $collision_count -gt 0 ]; then
        log_error "Found $collision_count file collisions (same content across cameras)"
        return 1
    fi
    
    log_success "No file collisions detected (camera-scoped directories properly isolated)"
    return 0
}

################################################################################
# Test Cases
################################################################################

test_sequential_timing() {
    log "TEST: Sequential camera processing with 30s delays"
    
    if [ "$SIMULATE_CAMERAS" -eq 1 ]; then
        log_skip "Skipping (no hardware)"
        return 0
    fi
    
    # Check if API server is running
    if ! curl -s -f http://localhost:5000/api/health > /dev/null 2>&1; then
        log_warning "API server not running on localhost:5000"
        log_skip "Sequential timing test (requires running server)"
        return 0
    fi
    
    local server_log="$PROJECT_ROOT/.logs/server.log"
    
    # Snapshot log position BEFORE trigger
    local log_baseline_line=0
    if [ -f "$server_log" ]; then
        log_baseline_line=$(wc -l < "$server_log")
    fi
    log "Baseline log position: line $log_baseline_line"
    
    # Start monitoring
    monitor_resources 180
    
    local start_time=$(date +%s)
    log "Triggering multi-camera capture via API..."
    
    # Trigger capture
    local response=$(curl -s -X POST http://localhost:5000/api/scheduler/trigger 2>&1)
    local trigger_result=$?
    
    if [ $trigger_result -ne 0 ]; then
        log_error "Failed to trigger capture via API: $response"
        stop_monitoring
        return 1
    fi
    
    log "Capture triggered, waiting for completion (max 180s)..."
    
    # Wait for capture to complete (check NEW logs only)
    local max_wait=180
    local elapsed=0
    local found_completion=false
    while [ $elapsed -lt $max_wait ]; do
        # Check only lines AFTER baseline
        if tail -n +$((log_baseline_line + 1)) "$server_log" 2>/dev/null | grep -q "Capture complete"; then
            found_completion=true
            break
        fi
        sleep 5
        ((elapsed+=5))
    done
    
    stop_monitoring
    
    # FAIL if completion not found
    if [ "$found_completion" = false ]; then
        log_error "Capture did not complete within ${max_wait}s timeout"
        return 1
    fi
    
    log "Capture completed after ${elapsed}s"
    
    # Extract NEW log entries only
    local new_log_file="$ARTIFACTS_DIR/capture_logs_new.txt"
    tail -n +$((log_baseline_line + 1)) "$server_log" > "$new_log_file"
    
    # Verify sequential processing in NEW logs only
    local sequential_logs=$(grep -c "\[SEQUENTIAL\]" "$new_log_file" || echo 0)
    
    if [ $sequential_logs -eq 0 ]; then
        log_error "No [SEQUENTIAL] markers found in NEW capture logs"
        return 1
    fi
    
    log_success "Found $sequential_logs sequential processing log entries in this run"
    
    # Check for expected sequential markers per camera
    local camera_start_count=$(grep -c "\[SEQUENTIAL\] Processing camera" "$new_log_file" || echo 0)
    local camera_complete_count=$(grep -c "\[SEQUENTIAL\] Completed camera" "$new_log_file" || echo 0)
    
    log "Cameras processed: start=$camera_start_count, complete=$camera_complete_count"
    
    if [ $camera_start_count -ne $camera_complete_count ]; then
        log_error "Mismatch: $camera_start_count cameras started, $camera_complete_count completed"
        return 1
    fi
    
    # Check for 30-second delay messages (expect N-1 delays for N cameras)
    local delay_count=$(grep -c "Waiting 30 seconds before processing next camera" "$new_log_file" || echo 0)
    local expected_delays=$((camera_start_count - 1))
    
    if [ $camera_start_count -gt 1 ]; then
        if [ $delay_count -eq $expected_delays ]; then
            log_success "30-second delays enforced: $delay_count delays for $camera_start_count cameras"
        else
            log_error "Expected $expected_delays delays, found $delay_count"
            return 1
        fi
    else
        log_warning "Single camera detected, no delays expected"
    fi
    
    # Verify completion time makes sense
    local end_time=$(date +%s)
    local total_time=$((end_time - start_time))
    log "Total capture time: ${total_time}s"
    
    # With N cameras and 30s delay, expect at least (N-1)*30 seconds
    local min_expected_time=$((expected_delays * 30))
    if [ $camera_start_count -gt 1 ] && [ $total_time -lt $min_expected_time ]; then
        log_error "Capture too fast: ${total_time}s < expected ${min_expected_time}s"
        return 1
    fi
    
    log_success "Sequential timing test passed"
    return 0
}

test_calibration_sequential() {
    log "TEST: Sequential calibration without crashes"
    
    if [ "$SIMULATE_CAMERAS" -eq 1 ]; then
        log_skip "Skipping (no hardware)"
        return 0
    fi
    
    log_warning "Calibration test requires manual execution via UI"
    log_warning "Verify: 1) Only one camera calibrates at a time"
    log_warning "         2) Global calibration lock prevents concurrent calibration"
    log_warning "         3) Each camera saves paperSize to database"
    
    log_skip "Calibration test (requires UI interaction)"
    return 0
}

test_alert_camera_names() {
    log "TEST: Alerts include correct camera names"
    
    # Check if email-alerts.ts includes camera name
    if grep -q "cameraName" "$PROJECT_ROOT/server/services/email-alerts.ts"; then
        log_success "email-alerts.ts includes cameraName field"
    else
        log_error "email-alerts.ts missing cameraName field"
        return 1
    fi
    
    # Check if sheets-logger.ts includes camera name
    if grep -q "cameraName" "$PROJECT_ROOT/server/services/sheets-logger.ts"; then
        log_success "sheets-logger.ts includes cameraName column"
    else
        log_error "sheets-logger.ts missing cameraName column"
        return 1
    fi
    
    # Check if scheduler passes camera info
    if grep -q "cameraName" "$PROJECT_ROOT/server/scheduler.ts"; then
        log_success "scheduler.ts passes cameraName to alerts"
    else
        log_error "scheduler.ts doesn't pass cameraName to alerts"
        return 1
    fi
    
    return 0
}

test_schema_validation() {
    log "TEST: Database schema includes multi-camera fields"
    
    # Check cameras.paperSize field
    if grep -q 'paperSize.*text("paper_size")' "$PROJECT_ROOT/shared/schema.ts"; then
        log_success "cameras table has paperSize field"
    else
        log_error "cameras table missing paperSize field"
        return 1
    fi
    
    # Check slots.cameraId foreign key
    if grep -q 'cameraId.*references.*cameras' "$PROJECT_ROOT/shared/schema.ts"; then
        log_success "slots table has cameraId foreign key"
    else
        log_error "slots table missing cameraId foreign key"
        return 1
    fi
    
    return 0
}

test_python_camera_id_args() {
    log "TEST: Python scripts accept --camera-id parameter"
    
    local scripts=(
        "python/aruco_calibrator.py"
        "python/validate_slot_qrs.py"
        "python/diagnose_all_aruco.py"
    )
    
    for script in "${scripts[@]}"; do
        local full_path="$PROJECT_ROOT/$script"
        if [ -f "$full_path" ]; then
            if grep -q -- "--camera-id" "$full_path"; then
                log_success "$script accepts --camera-id parameter"
            else
                log_error "$script missing --camera-id parameter"
                return 1
            fi
        else
            log_warning "$script not found"
        fi
    done
    
    return 0
}

test_roi_subdirectories() {
    log "TEST: ROI files use camera-scoped subdirectories"
    
    # Check validate_slot_qrs.py uses camera-scoped paths
    if grep -q "rois/{cameraId}" "$PROJECT_ROOT/python/validate_slot_qrs.py" || \
       grep -q 'rois.*camera.*id' "$PROJECT_ROOT/python/validate_slot_qrs.py"; then
        log_success "validate_slot_qrs.py uses camera-scoped ROI directories"
    else
        log_error "validate_slot_qrs.py doesn't use camera-scoped ROI paths"
        return 1
    fi
    
    return 0
}

test_sequential_processing() {
    log "TEST: process_cameras.py enforces sequential processing"
    
    # Check for time.sleep(30) between cameras
    if grep -q "time.sleep(30)" "$PROJECT_ROOT/python/process_cameras.py"; then
        log_success "process_cameras.py has 30-second delay between cameras"
    else
        log_error "process_cameras.py missing 30-second delay"
        return 1
    fi
    
    # Check for garbage collection
    if grep -q "gc.collect()" "$PROJECT_ROOT/python/process_cameras.py"; then
        log_success "process_cameras.py includes garbage collection"
    else
        log_error "process_cameras.py missing garbage collection"
        return 1
    fi
    
    # Check for [SEQUENTIAL] logging
    if grep -q "\[SEQUENTIAL\]" "$PROJECT_ROOT/python/process_cameras.py"; then
        log_success "process_cameras.py has sequential logging markers"
    else
        log_warning "process_cameras.py missing [SEQUENTIAL] log markers"
    fi
    
    return 0
}

################################################################################
# Test Suite Runner
################################################################################

run_quick_tests() {
    log "===================================================================="
    log "Running Quick Multi-Camera Tests"
    log "===================================================================="
    
    test_schema_validation
    test_python_camera_id_args
    test_roi_subdirectories
    test_sequential_processing
    test_alert_camera_names
    check_file_collisions
}

run_hardware_tests() {
    log "===================================================================="
    log "Running Hardware-Dependent Tests"
    log "===================================================================="
    
    test_sequential_timing
    test_calibration_sequential
    check_usb_errors
}

print_summary() {
    log "===================================================================="
    log "Test Summary"
    log "===================================================================="
    log "Passed:  $TESTS_PASSED"
    log "Failed:  $TESTS_FAILED"
    log "Skipped: $TESTS_SKIPPED"
    log "===================================================================="
    
    if [ $TESTS_FAILED -gt 0 ]; then
        log_error "Some tests failed. Check logs at: $TEST_LOG"
        return 1
    else
        log_success "All tests passed!"
        return 0
    fi
}

################################################################################
# Main Entry Point
################################################################################

main() {
    log "Multi-Camera E2E Test Suite Started"
    log "Timestamp: $TIMESTAMP"
    log "Log file: $TEST_LOG"
    log ""
    
    # Check hardware
    check_hardware || true
    
    # Run test suites
    run_quick_tests
    
    if [ "$SIMULATE_CAMERAS" -eq 0 ]; then
        run_hardware_tests
    else
        log_warning "Skipping hardware tests (no cameras detected)"
    fi
    
    # Print summary
    print_summary
    exit $?
}

# Run main function
main "$@"
