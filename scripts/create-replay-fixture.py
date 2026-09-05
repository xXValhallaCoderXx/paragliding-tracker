#!/usr/bin/env python3
"""Write a synthetic 12-hour recording as SQL for a disposable device database.

This only creates a new file. It never connects to a phone or changes an app database.
Import after stopping the app, on a backed-up/disposable test installation. The logbook
derives metrics and the thumbnail on first open; then replay reads the raw GPS data.
"""
import argparse
import math
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
started = 1788566400000
ended = started + 43_200_000
identity = 'synthetic-replay-12h-v1'
fixes = []
for second in range(43_201):
    if 10_000 <= second <= 10_300:
        continue
    latitude = 46 + second / 800_000 + math.sin(second / 15) / 1000
    longitude = 8 + second / 600_000 + math.cos(second / 15) / 1000
    altitude = 'NULL' if 15_000 <= second <= 15_030 else str(9876 if second == 12345 else -99 if second == 23456 else 1000 + math.sin(second / 400) * 300)
    speed = 'NULL' if 20_000 <= second <= 20_030 else '10'
    fixes.append(f"('{identity}',{second + 1},'synthetic',{second},{started + second * 1000},{started + second * 1000},{latitude},{longitude},{altitude},{speed},0)")

with args.output.open('x') as output:
    output.write('-- SYNTHETIC TEST DATA, not a flown route. No existing rows are replaced.\nBEGIN IMMEDIATE;\n')
    output.write(f"INSERT INTO sessions (id,status,completion_reason,started_at,ended_at,updated_at,last_fix_at,location_sequence,pressure_sequence,platform,device_metadata_json,app_metadata_json,start_power_json,end_power_json,manual_stop_at) VALUES ('{identity}','completed','stopped',{started},{ended},{ended},{ended},43201,0,'android','{{}}','{{}}','{{}}','{{}}',{ended});\n")
    output.write(f"INSERT INTO flights (id,recording_session_id,status,started_at,ended_at,timezone_offset_minutes,title,notes,created_at,updated_at) VALUES ('{identity}','{identity}','processing',{started},{ended},0,'Synthetic twelve-hour replay','Synthetic test recording: timing gap, missing altitude/speed, narrow peak and trough. Not a flown route.',{started},{ended});\n")
    for start in range(0, len(fixes), 500):
        output.write('INSERT INTO location_fixes (session_id,sequence,callback_id,batch_index,source_timestamp,receipt_timestamp,latitude,longitude,gps_altitude,speed,mocked) VALUES\n' + ',\n'.join(fixes[start:start + 500]) + ';\n')
    output.write('COMMIT;\n')
print(f'Wrote {len(fixes)} synthetic fixes to {args.output}. No device database was changed.')
