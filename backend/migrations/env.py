from alembic import context
from app.database import configured_url, database_engine, metadata


def run(connection):
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get('connection')
if connection is not None:
    run(connection)
else:
    engine = database_engine(configured_url())
    try:
        with engine.connect() as connection:
            run(connection)
    finally:
        engine.dispose()
