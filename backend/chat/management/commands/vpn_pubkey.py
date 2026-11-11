"""Публичный ключ подписи «Сети WYX» — зашивается в клиент (Pinned.publicKey).

    python manage.py vpn_pubkey            # base64 публичного ключа из VPN_SIGN_KEY
    python manage.py vpn_pubkey --new      # напечатать новый случайный seed для .env
"""
import base64
import os

from django.core.management.base import BaseCommand

from chat.vpn import _signer


class Command(BaseCommand):
    help = "Публичный ключ подписи Сети WYX"

    def add_arguments(self, parser):
        parser.add_argument("--new", action="store_true", help="сгенерировать новый seed (VPN_SIGN_KEY)")

    def handle(self, *args, **opts):
        if opts["new"]:
            self.stdout.write("VPN_SIGN_KEY=" + base64.b64encode(os.urandom(32)).decode())
            return
        key, pub = _signer()
        if not key:
            raise SystemExit("VPN_SIGN_KEY не задан")
        self.stdout.write(pub)
