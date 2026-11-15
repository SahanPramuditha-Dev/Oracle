"""Verified TLS contexts for Oracle's outbound providers."""
import os
import ssl

import certifi


def verified_tls(*, system_trust: bool = False, trust_env: bool = True) -> ssl.SSLContext:
    # Construct directly so a host SSLKEYLOGFILE setting cannot affect Oracle.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if system_trust:
        context.load_default_certs()
    elif trust_env and (ca_file := os.environ.get('SSL_CERT_FILE')):
        context.load_verify_locations(cafile=ca_file)
    elif trust_env and (ca_dir := os.environ.get('SSL_CERT_DIR')):
        context.load_verify_locations(capath=ca_dir)
    else:
        context.load_verify_locations(cafile=certifi.where())
    return context
