"""
Shared fixtures.

The suite runs against SQLite by default. Set DATABASE_URL to point it at a
Postgres instance instead - both paths must pass before a release, because
serverless deployments use Postgres while local development uses SQLite.
"""

import os
import tempfile

import pytest


@pytest.fixture()
def client():
    using_postgres = os.environ.get("DATABASE_URL", "").startswith(("postgres://", "postgresql://"))

    path = None
    if not using_postgres:
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.environ["POSTUREGUARD_DB"] = path

    import importlib

    import db as db_module

    importlib.reload(db_module)

    if using_postgres:
        # A fresh schema per test keeps them independent on a shared database.
        with db_module.connection() as conn:
            conn.execute("DROP TABLE IF EXISTS events")
            conn.execute("DROP TABLE IF EXISTS sessions")
            conn.commit()

    import app as app_module

    importlib.reload(app_module)
    application = app_module.create_app()
    application.config["TESTING"] = True

    with application.test_client() as c:
        yield c

    if path:
        os.unlink(path)
