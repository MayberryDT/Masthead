#!/usr/bin/python3
"""Signal one exact Linux process identity through a pidfd."""

import json
import os
import signal
import sys


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")


def read_starttime(pid):
    with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as handle:
        stat_line = handle.read()
    close = stat_line.rfind(")")
    fields = stat_line[close + 2 :].strip().split() if close >= 0 else []
    if len(fields) <= 19:
        raise RuntimeError("process starttime is unavailable")
    return fields[19]


def main():
    signal.alarm(2)
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("Python pidfd signaling is unavailable")
    request = json.loads(sys.argv[1])
    operation = request.get("operation")
    if operation == "probe":
        pidfd = os.pidfd_open(os.getpid(), 0)
        try:
            signal.pidfd_send_signal(pidfd, 0, None, 0)
        finally:
            os.close(pidfd)
        emit({"status": "available"})
        return
    if operation != "signal":
        raise ValueError("unsupported pidfd helper operation")
    pid = request.get("pid")
    expected_starttime = request.get("starttime")
    signal_name = request.get("signal")
    if not isinstance(pid, int) or pid < 1 or not isinstance(expected_starttime, str) or not expected_starttime:
        raise ValueError("invalid process identity")
    if signal_name not in ("SIGTERM", "SIGKILL"):
        raise ValueError("unsupported signal")
    try:
        pidfd = os.pidfd_open(pid, 0)
    except ProcessLookupError:
        emit({"status": "already-exited"})
        return
    try:
        try:
            observed_starttime = read_starttime(pid)
        except (FileNotFoundError, ProcessLookupError):
            emit({"status": "already-exited"})
            return
        if observed_starttime != expected_starttime:
            emit({"status": "reused", "observedStarttime": observed_starttime})
            return
        try:
            signal.pidfd_send_signal(pidfd, getattr(signal, signal_name), None, 0)
        except ProcessLookupError:
            emit({"status": "already-exited"})
            return
        emit({"status": "signaled"})
    finally:
        os.close(pidfd)


try:
    main()
except BaseException as error:  # The caller must fail closed on every uncertain helper failure.
    emit({"status": "error", "message": f"{type(error).__name__}: {error}"})
    sys.exit(1)
