#!/usr/bin/python3
"""Run a fixture child and attest its raw wait status with a parent-only secret."""

import hashlib
import hmac
import json
import os
import subprocess
import sys


PREFIX = "MASTHEAD_REHEARSAL_WAIT:"


def main():
    request = json.loads(sys.stdin.readline())
    secret = request["secret"]
    argv = request["argv"]
    environment = request["environment"]
    if not isinstance(secret, str) or len(secret) < 32:
        raise ValueError("invalid wait-attestation secret")
    if not isinstance(argv, list) or not argv or not all(isinstance(value, str) for value in argv):
        raise ValueError("invalid fixture argv")
    if not isinstance(environment, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in environment.items()
    ):
        raise ValueError("invalid fixture environment")
    try:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, close_fds=True, env=environment)
    except OSError as error:
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        returncode = 1
    else:
        returncode = child.wait()
    payload = json.dumps(
        {"code": returncode if returncode >= 0 else None, "signal": -returncode if returncode < 0 else None},
        separators=(",", ":"),
    )
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    sys.stderr.write(f"\n{PREFIX}{payload}:{signature}\n")
    sys.stderr.flush()
    if returncode < 0:
        return 128 + (-returncode)
    return returncode


try:
    exit_code = main()
except Exception as error:
    sys.stderr.write(f"\n{PREFIX}error:{type(error).__name__}:{error}\n")
    sys.exit(125)
sys.exit(exit_code)
