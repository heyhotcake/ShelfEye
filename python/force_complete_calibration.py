#!/usr/bin/env python3
"""
Force complete calibration by marking it as done in config
"""

import requests
import json

def force_complete():
    # Update config to mark calibration complete
    config_data = {
        "last_calibration_camera_id": "f0302a62-d361-4134-86cc-f8c8558226c0",
        "last_calibration_template_id": "OK",  # Your template name
        "last_calibration_paper_size_format": "6-page-3x2"
    }
    
    try:
        # Update config
        response = requests.patch(
            "http://localhost:5000/api/config",
            json=config_data
        )
        
        if response.ok:
            print("✓ Calibration marked as complete!")
            print("The system will now start monitoring.")
            print("\nNOTE: Only 3/7 slots will work properly:")
            print("  - 5x5-002")
            print("  - 5x5-003")
            print("  - pen-002")
            print("\nThe other slots won't detect properly until you fix the QR codes.")
        else:
            print(f"✗ Failed to update config: {response.text}")
            
    except Exception as e:
        print(f"✗ Error: {e}")
        print("\nAlternative: Run this SQL directly:")
        print("UPDATE config SET ")
        print("  last_calibration_camera_id = 'f0302a62-d361-4134-86cc-f8c8558226c0',")
        print("  last_calibration_paper_size_format = '6-page-3x2'")
        print("WHERE TRUE;")

if __name__ == "__main__":
    force_complete()