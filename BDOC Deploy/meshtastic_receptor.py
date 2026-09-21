#!/usr/bin/env python3
"""
Meshtastic Receptor — catches mesh messages and relays to BDOC
Usage: python meshtastic_receptor.py --ws ws://localhost:8080/mesh
        python meshtastic_receptor.py --test # fake data, no hardware needed
"""

import asyncio
import json
import argparse
import logging
import random
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger("meshtastic-receptor")

class MeshReceptor:
    def __init__(self, ws_url, serial_port=None, tcp_host=None):
        self.ws_url = ws_url
        self.serial_port = serial_port
        self.tcp_host = tcp_host
        self.interface = None
        self.ws = None
        self.connected = False

    async def connect_websocket(self):
        import websockets
        try:
            self.ws = await websockets.connect(self.ws_url)
            self.connected = True
            log.info(f"WebSocket connected: {self.ws_url}")
        except Exception as e:
            log.error(f"WebSocket connection failed: {e}")
            self.connected = False

    async def emit(self, event_type, data):
        import aiohttp
        payload = {
            "source": "meshtastic",
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data
        }
        
        # If ws_url is HTTP, POST to it; otherwise use WebSocket
        if self.ws_url.startswith('http'):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(self.ws_url, json=payload, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                        if resp.status == 200:
                            log.debug(f"Emitted {event_type}")
                        else:
                            log.warning(f"Emit HTTP {resp.status}: {await resp.text()}")
            except Exception as e:
                log.error(f"Emit HTTP failed: {e}")
        elif self.ws and self.connected:
            try:
                await self.ws.send(json.dumps(payload))
                log.debug(f"Emitted {event_type}: {data}")
            except Exception as e:
                log.error(f"Emit failed: {e}")
                self.connected = False
                await self.reconnect_websocket()
        else:
            print(json.dumps(payload))

    async def reconnect_websocket(self):
        log.info("Attempting WebSocket reconnect...")
        await asyncio.sleep(3)
        await self.connect_websocket()

    def on_receive(self, packet, interface):
        """Callback fired by meshtastic library when a packet arrives."""
        try:
            decoded = packet.get('decoded', {})
            portnum = decoded.get('portnum', 'unknown')
            sender = packet.get('from', 'unknown')
            to = packet.get('to', 'unknown')
            hop_limit = packet.get('hop_limit', 0)
            rx_rssi = packet.get('rx_rssi')
            rx_snr = packet.get('rx_snr')

            base_data = {
                "sender": str(sender),
                "to": str(to),
                "hop_limit": hop_limit,
                "rssi": rx_rssi,
                "snr": rx_snr
            }

            if portnum == 'TEXT_MESSAGE_APP':
                text = decoded.get('text', '')
                base_data['text'] = text
                asyncio.run_coroutine_threadsafe(
                    self.emit('text_message', base_data),
                    self.loop
                )

            elif portnum == 'POSITION_APP':
                position = decoded.get('position', {})
                lat = position.get('latitude')
                lon = position.get('longitude')
                alt = position.get('altitude')
                if lat is not None and lon is not None:
                    base_data['latitude'] = lat
                    base_data['longitude'] = lon
                    base_data['altitude'] = alt
                    asyncio.run_coroutine_threadsafe(
                        self.emit('position', base_data),
                        self.loop
                    )

            elif portnum == 'TELEMETRY_APP':
                telemetry = decoded.get('telemetry', {})
                base_data['battery_level'] = telemetry.get('battery_level')
                base_data['voltage'] = telemetry.get('voltage')
                base_data['channel_utilization'] = telemetry.get('channel_utilization')
                base_data['air_util_tx'] = telemetry.get('air_util_tx')
                asyncio.run_coroutine_threadsafe(
                    self.emit('telemetry', base_data),
                    self.loop
                )

            elif portnum == 'NODEINFO_APP':
                nodeinfo = decoded.get('user', {})
                base_data['node_id'] = nodeinfo.get('id')
                base_data['long_name'] = nodeinfo.get('longName')
                base_data['short_name'] = nodeinfo.get('shortName')
                base_data['hw_model'] = nodeinfo.get('hwModel')
                asyncio.run_coroutine_threadsafe(
                    self.emit('node_info', base_data),
                    self.loop
                )

            else:
                base_data['portnum'] = portnum
                asyncio.run_coroutine_threadsafe(
                    self.emit('raw_packet', base_data),
                    self.loop
                )

        except Exception as e:
            log.error(f"Packet parse error: {e}")

    def connect_node(self):
        """Connect to the Meshtastic node."""
        try:
            from meshtastic.serial_interface import SerialInterface
            from meshtastic.tcp_interface import TCPInterface

            if self.tcp_host:
                self.interface = TCPInterface(
                    hostName=self.tcp_host,
                    callback=self.on_receive
                )
                log.info(f"Connected to Meshtastic node via TCP: {self.tcp_host}")
            else:
                self.interface = SerialInterface(
                    devPath=self.serial_port,
                    callback=self.on_receive
                )
                log.info(f"Connected to Meshtastic node via serial: {self.serial_port or 'auto'}")

            # Grab current node list on connect
            nodes = self.interface.nodesByNum
            for node_id, node_data in nodes.items():
                user = node_data.get('user', {})
                pos = node_data.get('position', {})
                asyncio.run_coroutine_threadsafe(
                    self.emit('node_info', {
                        "sender": str(node_id),
                        "node_id": user.get('id'),
                        "long_name": user.get('longName'),
                        "short_name": user.get('shortName'),
                        "hw_model": user.get('hwModel'),
                        "latitude": pos.get('latitude'),
                        "longitude": pos.get('longitude'),
                        "battery_level": node_data.get('deviceMetrics', {}).get('batteryLevel')
                    }),
                    self.loop
                )
                log.info(f"Discovered node: {user.get('longName', node_id)}")

        except ImportError:
            log.error("meshtastic library not installed. Run: pip install meshtastic")
            raise
        except Exception as e:
            log.error(f"Node connection failed: {e}")
            raise

    async def run_test_mode(self, duration=60):
        """Fake data mode for testing without hardware."""
        log.info("Running in TEST MODE — generating fake mesh data")

        fake_nodes = [
            {"node_id": "!deadbeef", "long_name": "Alpha Node", "short_name": "ALPH", "hw_model": "TBEAM"},
            {"node_id": "!cafebabe", "long_name": "Bravo Base", "short_name": "BRAV", "hw_model": "HELTEC"},
            {"node_id": "!feedface", "long_name": "Charlie Relay", "short_name": "CHAR", "hw_model": "RAK4631"},
        ]

        # Emit fake nodes
        for node in fake_nodes:
            await self.emit('node_info', {
                "sender": node['node_id'],
                "node_id": node['node_id'],
                "long_name": node['long_name'],
                "short_name": node['short_name'],
                "hw_model": node['hw_model'],
                "latitude": random.uniform(30.0, 35.0),
                "longitude": random.uniform(-85.0, -80.0),
                "battery_level": random.randint(40, 100)
            })
            await asyncio.sleep(0.5)

        # Emit fake messages for duration seconds
        start = datetime.now()
        messages = [
            "Sector 4 clear",
            "Relay up, signal strong",
            "Need resupply at grid 7",
            "Movement detected north",
            "Standby for orders",
        ]

        while (datetime.now() - start).total_seconds() < duration:
            await self.emit('text_message', {
                "sender": random.choice(fake_nodes)['node_id'],
                "to": "^all",
                "hop_limit": 3,
                "rssi": random.randint(-120, -70),
                "snr": round(random.uniform(2.0, 12.0), 2),
                "text": random.choice(messages)
            })

            await self.emit('telemetry', {
                "sender": random.choice(fake_nodes)['node_id'],
                "to": "^all",
                "battery_level": random.randint(40, 100),
                "voltage": round(random.uniform(3.3, 4.2), 2),
                "channel_utilization": round(random.uniform(5.0, 25.0), 2)
            })

            await self.emit('position', {
                "sender": random.choice(fake_nodes)['node_id'],
                "to": "^all",
                "latitude": random.uniform(30.0, 35.0),
                "longitude": random.uniform(-85.0, -80.0),
                "altitude": random.randint(0, 300),
                "rssi": random.randint(-120, -70)
            })

            await asyncio.sleep(random.uniform(2.0, 5.0))

    async def run(self, test_mode=False, test_duration=60):
        self.loop = asyncio.get_event_loop()

        await self.connect_websocket()

        if test_mode:
            await self.run_test_mode(test_duration)
            return

        try:
            self.connect_node()
            log.info("Listening for mesh traffic. Ctrl+C to stop.")
            while True:
                await asyncio.sleep(1)
                if not self.connected:
                    await self.reconnect_websocket()
        except KeyboardInterrupt:
            log.info("Shutting down...")
        finally:
            if self.interface:
                self.interface.close()
            if self.ws:
                await self.ws.close()

def main():
    parser = argparse.ArgumentParser(description="Meshtastic receptor for BDOC")
    parser.add_argument("--http", default="https://kgsbdoc.netlify.app/.netlify/functions/mesh-ingest",
                        help="HTTP endpoint for mesh ingestion (default: live BDOC)")
    parser.add_argument("--port", default=None,
                        help="Serial port (e.g., /dev/ttyUSB0 on Linux, COM3 on Windows). Auto-detects if omitted.")
    parser.add_argument("--tcp", default=None,
                        help="TCP host for network-connected node (e.g., 192.168.1.100)")
    parser.add_argument("--test", action="store_true",
                        help="Test mode — fake data, no hardware needed")
    parser.add_argument("--duration", type=int, default=60,
                        help="Test mode duration in seconds (default: 60)")
    args = parser.parse_args()

    # For HTTP POST, we'll convert ws_url to http_url; MeshReceptor.emit() will POST instead of WebSocket
    receptor = MeshReceptor(
        ws_url=args.http,  # Will be used as HTTP endpoint
        serial_port=args.port,
        tcp_host=args.tcp
    )

    asyncio.run(receptor.run(test_mode=args.test, test_duration=args.duration))

if __name__ == "__main__":
    main()
