#!/usr/bin/env python3
"""
Surveille le branchement d'une clé USB et envoie un signal WebSocket à etat.html.
Lancer avec : python3 usb_watcher.py
"""

import asyncio
import os
import subprocess
import websockets

POLL_INTERVAL = 1.0  # secondes entre chaque vérification

def get_mounted_volumes():
    """Retourne l'ensemble des volumes montés dans /Volumes/ (excl. Macintosh HD)."""
    try:
        entries = set(os.listdir("/Volumes"))
        # On ignore les volumes système courants
        system_vols = {"Macintosh HD", "Preboot", "Recovery", "VM", "Update", "Data"}
        return entries - system_vols
    except Exception:
        return set()

connected_clients = set()

async def handler(websocket):
    connected_clients.add(websocket)
    print(f"[WS] Client connecté ({len(connected_clients)} total)")
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Client déconnecté ({len(connected_clients)} total)")

async def usb_watcher():
    """Surveille les changements de volumes montés et notifie les clients."""
    previous_vols = get_mounted_volumes()
    print(f"[USB] Surveillance démarrée — volumes: {previous_vols}")
    usb_triggered = False

    while True:
        await asyncio.sleep(POLL_INTERVAL)
        current_vols = get_mounted_volumes()

        new_vols = current_vols - previous_vols
        removed_vols = previous_vols - current_vols

        if new_vols and not usb_triggered:
            print(f"[USB] Nouveau volume détecté : {new_vols} — Envoi du signal aux clients...")
            usb_triggered = True
            if connected_clients:
                await asyncio.gather(
                    *[ws.send("USB_CONNECTED") for ws in connected_clients],
                    return_exceptions=True
                )
        elif removed_vols:
            print(f"[USB] Volume retiré : {removed_vols}")
            usb_triggered = False

        previous_vols = current_vols

async def main():
    print("[WS] Serveur WebSocket démarré sur ws://localhost:8765")
    async with websockets.serve(handler, "localhost", 8765):
        await usb_watcher()

if __name__ == "__main__":
    asyncio.run(main())
