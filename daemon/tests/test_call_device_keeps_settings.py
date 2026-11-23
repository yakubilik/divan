"""A command's throwaway device must not put back settings the daemon wrote meanwhile.

`divan captcha` and friends load config.toml, mint a device, talk to the daemon
for as long as the call takes, then drop the device. Saving their own copy at
the end undid whatever the daemon had saved in between — on 23 Nov 2026 the
account pool, switched on from the phone, was off on disk again.
"""
from pathlib import Path

from divan import config
from divan.config import Config


def test_dropping_call_device_keeps_daemon_writes(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(config, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.toml")
    monkeypatch.setattr(config, "LOG_DIR", tmp_path / "logs")
    Config().save()

    command = Config.load()
    dev, _ = command.add_device("cli")

    # The daemon, during the call: the phone switches the pool on.
    daemon = Config.load()
    daemon.pool = {"enabled": True}
    daemon.save()

    command.drop_call_device(dev.id)

    after = Config.load()
    assert after.pool == {"enabled": True}
    assert dev.id not in after.devices
    assert dev.id not in command.devices
