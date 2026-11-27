"""A device paired from the CLI must survive the running daemon's next save.

The daemon saves config.toml every few seconds. Each save wrote the device list
it had in memory, so a `divan pair` made while it ran was gone before the link
could be used (27 Nov 2026, pairing a second Mac as a peer).
"""
from pathlib import Path

from divan import config
from divan.config import Config


def _isolate(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(config, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.toml")
    monkeypatch.setattr(config, "LOG_DIR", tmp_path / "logs")
    Config().save()


def test_cli_pair_survives_daemon_save(tmp_path: Path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    daemon = Config.load()
    dev, token = Config.load().add_device("peer")

    daemon.pool = {"enabled": True}
    daemon.save()

    after = Config.load()
    assert dev.id in after.devices
    assert after.pool == {"enabled": True}
    assert daemon.find_device_by_token(token) is not None


def test_cli_revoke_survives_daemon_save(tmp_path: Path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    dev, token = Config.load().add_device("phone")
    daemon = Config.load()

    Config.load().revoke(dev.id)
    daemon.save()

    after = Config.load()
    assert dev.id not in after.devices
    assert after.was_revoked(token)
    assert daemon.find_device_by_token(token) is None


def test_daemon_revoke_is_not_undone_by_disk(tmp_path: Path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    dev, token = Config.load().add_device("phone")
    daemon = Config.load()
    other, _ = Config.load().add_device("cli")   # the file changes meanwhile

    daemon.revoke(dev.id)

    after = Config.load()
    assert dev.id not in after.devices
    assert other.id in after.devices
    assert after.was_revoked(token)
